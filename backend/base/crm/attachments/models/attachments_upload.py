# Copyright 2025 FARA CRM
# Attachments module - загрузка файла частями до создания вложения

import contextlib
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Any, Self

import aiofiles
import aiofiles.os
from pydantic import BeforeValidator

from backend.base.system.dotorm.dotorm.access import get_access_session
from backend.base.system.dotorm.dotorm.fields import (
    Char,
    Datetime,
    Integer,
    Many2one,
)
from backend.base.system.dotorm.dotorm.model import DotModel
from backend.base.system.core.enviroment import env
from backend.base.system.core.exceptions.environment import FaraException
from backend.base.crm.attachments.strategies import get_strategy

if TYPE_CHECKING:
    from backend.base.crm.users.models.users import User
    from backend.base.crm.security.models.sessions import Session

logger = logging.getLogger(__name__)

# Размер части: каждый запрос меньше лимитов nginx и внешних прокси
PART_SIZE = 8 * 1024 * 1024
# Сколько живёт загрузка без новых частей: брошенную, недогруженную или
# неиспользованную удаляет cron_cleanup
UPLOAD_TTL = timedelta(hours=24)
# Предел размера файла, если настройка attachments.max_upload_size пуста
DEFAULT_MAX_UPLOAD_SIZE = 1024 * 1024 * 1024


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _reject_content(value: Any) -> None:
    """Файл в content (base64) API не принимает: без этой проверки схема
    молча отбросила бы поле, и вложение создалось бы без файла. Исключение
    не ValueError — pydantic его пропускает, ответ 400 без эха base64."""
    if value is not None:
        raise FaraException(
            {
                "content": "CONTENT_NOT_SUPPORTED",
                "detail": "Файл в content не принимается: загрузите его "
                "частями (POST /attachments/uploads) и передайте upload_id",
                "status_code": 400,
            }
        )


# Тип content в схемах API (вложение, сообщение чата): только «не передан»
ContentNotSupported = Annotated[Any, BeforeValidator(_reject_content)]


class AttachmentUpload(DotModel):
    """
    Файл, загружаемый частями, до создания вложения.

    Части приходят по порядку (PATCH /attachments/uploads/{id}) и
    дописываются во временный файл <filestore>/.uploads/<id>. Готовая
    загрузка передаётся вместо content — upload_id вложения: fill читает
    файл в content, после записи вложения release удаляет загрузку.

    Загрузка принадлежит создавшему её пользователю: чужая не найдётся.
    CRUD наружу не нужен — только роуты загрузки.
    """

    __table__ = "attachments_upload"
    __auto_crud__ = False

    id: int = Integer(primary_key=True)

    user_id: "User" = Many2one(
        relation_table=lambda: env.models.user,
        ondelete="cascade",
        index=True,
    )

    name: str | None = Char()
    mimetype: str | None = Char()
    size: int = Integer()

    # Сколько байт уже получено — offset протокола загрузки
    received: int = Integer(default=0)

    # Когда пришла последняя часть (или начата загрузка): от неё — срок
    write_datetime: datetime = Datetime(
        default=lambda: datetime.now(timezone.utc)
    )

    @staticmethod
    async def _dir() -> Path:
        """Папка временных файлов — внутри файлстора, на его томе."""
        base = await get_strategy("file")._get_base_path(None)
        return Path(base) / ".uploads"

    async def path(self) -> Path:
        """Временный файл загрузки."""
        return await self._dir() / str(self.id)

    @classmethod
    async def start(cls, name: str, mimetype: str | None, size: int) -> Self:
        """Новая загрузка текущего пользователя с пустым временным файлом:
        append дописывает части в существующий, а у пустого файла частей
        нет вовсе."""
        session: "Session" = get_access_session()
        max_size = await env.models.system_settings.get_value(
            "attachments.max_upload_size", DEFAULT_MAX_UPLOAD_SIZE
        )
        if size > int(max_size):
            raise FaraException(
                {"content": "UPLOAD_TOO_LARGE", "status_code": 413}
            )

        upload = cls(
            user_id=session.user_id,
            name=name,
            mimetype=mimetype,
            size=size,
            received=0,
        )
        upload.id = await cls.create(payload=upload)

        # "wb", а не "xb": от пересозданной базы (id снова с 1, файлстор
        # прежний) мог остаться файл с этим id — обнулить его, а не упасть
        directory = await cls._dir()
        await aiofiles.os.makedirs(directory, exist_ok=True)
        async with aiofiles.open(await upload.path(), mode="wb"):
            pass
        return upload

    @classmethod
    async def get_own(cls, upload_id: int) -> Self | None:
        """Загрузка текущего пользователя по id."""
        session: "Session" = get_access_session()
        return await cls.search_one(
            filter=[
                ("id", "=", upload_id),
                ("user_id", "=", session.user_id.id),
            ],
            fields=["id", "name", "mimetype", "size", "received"],
        )

    @classmethod
    async def take(cls, upload_ids: list[int]) -> list[Self]:
        """
        Загрузки текущего пользователя, все части которых получены, —
        одним запросом, в транзакции вызывающего.

        Строки блокируются до конца транзакции: cron_cleanup не удалит
        загрузку, пока из неё создаётся вложение, — дождётся.

        Raises:
            FaraException: UPLOAD_NOT_FOUND — какой-то нет (устарела,
                отменена, чужая); UPLOAD_NOT_COMPLETE — получены не все части
        """
        session: "Session" = get_access_session()
        rows = await cls._get_db_session().execute(
            f"""
            SELECT id, size, received FROM {cls.__table__}
             WHERE id = ANY(%s::int[]) AND user_id = %s
               FOR UPDATE
            """,
            (upload_ids, session.user_id.id),
        )
        if len(rows) != len(set(upload_ids)):
            raise FaraException(
                {"content": "UPLOAD_NOT_FOUND", "status_code": 400}
            )
        uploads = [cls(**row) for row in rows]
        if any(upload.received != upload.size for upload in uploads):
            raise FaraException(
                {"content": "UPLOAD_NOT_COMPLETE", "status_code": 400}
            )
        return uploads

    async def read_file(self) -> bytes:
        """Содержимое собранного файла."""
        async with aiofiles.open(await self.path(), mode="rb") as f:
            return await f.read()

    @classmethod
    async def read(cls, upload_id: int) -> tuple[Self, bytes]:
        """
        Загрузка и её содержимое — для импорта Excel. Загрузка остаётся,
        удаляет её импорт (discard) или cron_cleanup: импорт читает один
        файл дважды — превью колонок, затем импорт. Проверки и ошибки —
        как у take.
        """
        (upload,) = await cls.take([upload_id])
        return upload, await upload.read_file()

    @classmethod
    async def fill(cls, payloads: list) -> list[Self]:
        """
        upload_id вложений → content (байты собранного файла): дальше
        запись вложения и стратегии хранилищ работают с content, как
        раньше. Загрузки — одним запросом; вложения записаны — убрать их
        release.
        """
        with_upload = [p for p in payloads if p and p.upload_id]
        if not with_upload:
            return []

        uploads = {
            upload.id: upload
            for upload in await cls.sudo().take(
                [p.upload_id for p in with_upload]
            )
        }
        for payload in with_upload:
            payload.content = await uploads[payload.upload_id].read_file()
        return list(uploads.values())

    @classmethod
    async def release(cls, uploads: list[Self]) -> None:
        """Вложения записаны — удалить их загрузки: строки одним запросом,
        временные файлы."""
        if not uploads:
            return
        await cls._get_db_session().execute(
            f"DELETE FROM {cls.__table__} WHERE id = ANY(%s::int[])",
            ([upload.id for upload in uploads],),
            cursor="void",
        )
        for upload in uploads:
            with contextlib.suppress(FileNotFoundError):
                await aiofiles.os.remove(await upload.path())

    async def append(self, offset: int, chunk: bytes) -> int | None:
        """
        Дописать часть с позиции offset — в транзакции вызывающего.

        Returns:
            Сколько байт получено теперь; None — offset не совпал с
            полученным (повтор части, вторая вкладка): клиент спросит
            текущий offset и продолжит с него
        """
        if offset + len(chunk) > self.size:
            raise FaraException(
                {"content": "UPLOAD_SIZE_EXCEEDED", "status_code": 400}
            )

        # UPDATE по received берёт блокировку строки: часть с той же
        # позицией из другого запроса ждёт коммита этой и не находит строку
        rows = await self._get_db_session().execute(
            f"""
            UPDATE {self.__table__}
               SET received = %s, write_datetime = %s
             WHERE id = %s AND received = %s
            RETURNING id
            """,
            (offset + len(chunk), _now(), self.id, offset),
        )
        if not rows:
            return None

        # Позиция из БД — источник правды: хвост попытки, записанный до
        # обрыва, но не закоммиченный, перезаписывается и обрезается
        async with aiofiles.open(await self.path(), mode="r+b") as f:
            await f.seek(offset)
            await f.write(chunk)
            await f.truncate()
        return offset + len(chunk)

    async def discard(self) -> None:
        """Удалить загрузку: строку и временный файл."""
        with contextlib.suppress(FileNotFoundError):
            await aiofiles.os.remove(await self.path())
        await self.delete()

    @classmethod
    async def cron_cleanup(cls) -> dict:
        """
        Крон: удалить загрузки без новых частей дольше UPLOAD_TTL и
        временные файлы старше срока — их и оставшиеся без строки
        (пользователь удалён, транзакция загрузки откатилась).

        Загрузку, из которой сейчас создаётся вложение, DELETE не тронет:
        take держит её строку до конца транзакции.

        Returns:
            {"uploads": N, "files": M} — сколько удалено
        """
        deadline = _now() - UPLOAD_TTL
        rows = await cls._get_db_session().execute(
            f"DELETE FROM {cls.__table__} WHERE write_datetime < %s "
            "RETURNING id",
            (deadline,),
        )

        # Время изменения файла — время последней части, как write_datetime
        directory = await cls._dir()
        files = 0
        with contextlib.suppress(FileNotFoundError):
            for entry in await aiofiles.os.scandir(directory):
                if (
                    entry.is_file()
                    and entry.stat().st_mtime < deadline.timestamp()
                ):
                    await aiofiles.os.remove(entry.path)
                    files += 1

        return {"uploads": len(rows or []), "files": files}
