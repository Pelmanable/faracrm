# Copyright 2025 FARA CRM
# Attachments module - base storage strategy

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any
import logging
import os
import re
import unicodedata

import httpx
from starlette.background import BackgroundTask
from starlette.datastructures import Headers
from starlette.responses import Response, StreamingResponse

if TYPE_CHECKING:
    from backend.base.crm.attachments.models.attachments_storage import (
        AttachmentStorage,
    )
    from backend.base.crm.attachments.models.attachments import Attachment

logger = logging.getLogger(__name__)

# Таймаут ожидания данных от провайдера при потоковой отдаче (секунды)
STREAM_TIMEOUT = 60.0

# Символы, которые ВСЕГДА удаляем из имени файла:
# - \x00..\x1F и \x7F — control chars (включая NULL, \n, \t, \r),
#   ломают open(), шеллы, логи, заголовки HTTP.
# - / и \ — path separators, иначе path traversal.
# - <>:"|?* — Windows-reserved символы (для кросс-платформенности).
_FORBIDDEN_FILENAME_CHARS = re.compile(r'[\x00-\x1f\x7f<>:"/\\|?*]')

# Windows-reserved базовые имена (без расширения, регистронезависимо).
_WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}

# Максимальная длина имени файла в БАЙТАХ для большинства FS
# (ext4, NTFS, APFS, XFS — все 255).
_MAX_FILENAME_BYTES = 255


def sanitize_filename(filename: str, fallback: str = "file") -> str:
    """
    Минимальная очистка имени файла под современные best practices.

    Принципы (state of the art 2024-2026; см. pathvalidate, npm
    sanitize-filename, S3/GDrive guidelines):
    - Удаляем ТОЛЬКО то, что реально опасно или невалидно для FS:
      control chars, path separators, Windows-reserved символы.
    - Сохраняем максимум исходного: кириллицу, любой Unicode,
      эмодзи, пробелы, скобки, точки внутри имени.
    - Нормализуем в NFC (каноничная форма для FS, рекомендация W3C).
      NFKD — НЕ годится: разваливает символы и в паре с
      .encode("ascii", "ignore") убивает кириллицу полностью.
    - Защита от path traversal через os.path.basename.
    - Лимит длины — в БАЙТАХ (255), а не символах: один UTF-8 символ
      может занимать до 4 байт, обрезка по символам некорректна.
    - Fallback для пустого результата, ".", "..", только-точек/пробелов.
    - Windows-reserved имена (CON, PRN, NUL, COM1..LPT9) префиксуем
      подчёркиванием, чтобы файл создавался корректно везде.

    Args:
        filename: исходное имя (может содержать что угодно от пользователя).
        fallback: что подставить, если после очистки ничего не осталось.

    Returns:
        Безопасное имя файла, валидное на ext4/NTFS/APFS.
    """
    # 1. Path traversal: оставляем только базовое имя
    filename = os.path.basename(filename or "")

    # 2. NFC: каноничная форма (НЕ NFKD — тот разваливает символы)
    filename = unicodedata.normalize("NFC", filename)

    # 3. Удаляем только реально опасные символы
    filename = _FORBIDDEN_FILENAME_CHARS.sub("", filename)

    # 4. Trailing/leading whitespace и точки на конце ломают Windows
    filename = filename.strip().rstrip(".")

    # 5. Спецслучаи "." / ".." / пусто
    if filename in ("", ".", ".."):
        return fallback

    # 6. Windows-reserved (CON, PRN, NUL, LPT1...) — префикс
    name, ext = os.path.splitext(filename)
    if name.upper() in _WINDOWS_RESERVED_NAMES:
        name = f"_{name}"
        filename = f"{name}{ext}"

    # 7. Обрезка до 255 байт с сохранением расширения и валидного UTF-8
    encoded = filename.encode("utf-8")
    if len(encoded) > _MAX_FILENAME_BYTES:
        ext_bytes = ext.encode("utf-8")
        max_name_bytes = _MAX_FILENAME_BYTES - len(ext_bytes)
        if max_name_bytes <= 0:
            # Экзотика: расширение само длиннее лимита — режем целиком
            filename = encoded[:_MAX_FILENAME_BYTES].decode(
                "utf-8", errors="ignore"
            )
        else:
            name_bytes = name.encode("utf-8")[:max_name_bytes]
            # errors="ignore" срежет хвостовой битый UTF-8
            name = name_bytes.decode("utf-8", errors="ignore")
            filename = f"{name}{ext}"

    # 8. После всех манипуляций имя могло опять стать пустым
    return filename or fallback


class StorageStrategyBase(ABC):
    """
    Базовый класс стратегии хранения файлов.

    Реализует паттерн Strategy для легкого добавления новых провайдеров
    хранения (filestore, Google Drive, OneDrive и т.д.) без изменения
    основного кода.

    Каждый провайдер реализует свой класс стратегии, наследуя от этого.

    Attributes:
        strategy_type: Уникальный тип стратегии (должен совпадать с storage.type)
    """

    # Уникальный тип стратегии (должен совпадать с storage.type)
    strategy_type: str = ""

    # Стратегия отдаёт файл потоком (read_range: кусками, с Range), не
    # читая целиком в память — роут вызывает read_range вместо read_file
    supports_streaming: bool = False

    # ========================================================================
    # Абстрактные методы - должны быть реализованы в каждой стратегии
    # ========================================================================

    @abstractmethod
    async def create_file(
        self,
        storage: "AttachmentStorage",
        attachment: "Attachment",
        content: bytes,
        filename: str,
        mimetype: str | None = None,
        parent_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Создать файл в хранилище.

        Args:
            storage: Экземпляр хранилища
            attachment: Экземпляр вложения (для получения res_model, res_id и т.д.)
            content: Содержимое файла в байтах
            filename: Имя файла
            mimetype: MIME-тип файла
            parent_id: ID родительской папки (для облачных хранилищ)

        Returns:
            Словарь с ключами:
            - storage_file_id: ID файла в хранилище (для облачных)
            - storage_file_url: URL/путь к файлу
            - storage_parent_id: ID родительской папки (для облачных)
            - storage_parent_name: Имя родительской папки
        """

    @abstractmethod
    async def read_file(
        self,
        storage: "AttachmentStorage",
        attachment: "Attachment",
    ) -> bytes | None:
        """
        Прочитать содержимое файла из хранилища.

        Args:
            storage: Экземпляр хранилища
            attachment: Экземпляр вложения

        Returns:
            Содержимое файла в байтах или None если файл не найден
        """

    @abstractmethod
    async def update_file(
        self,
        storage: "AttachmentStorage",
        attachment: "Attachment",
        content: bytes | None = None,
        filename: str | None = None,
        mimetype: str | None = None,
    ) -> dict[str, Any]:
        """
        Обновить файл в хранилище.

        Args:
            storage: Экземпляр хранилища
            attachment: Экземпляр вложения
            content: Новое содержимое файла (если нужно обновить)
            filename: Новое имя файла (если нужно переименовать)
            mimetype: Новый MIME-тип

        Returns:
            Словарь с обновленными данными хранилища
        """

    @abstractmethod
    async def delete_file(
        self,
        storage: "AttachmentStorage",
        attachment: "Attachment",
    ) -> bool:
        """
        Удалить файл из хранилища.

        Args:
            storage: Экземпляр хранилища
            attachment: Экземпляр вложения

        Returns:
            True если файл успешно удален, иначе False
        """

    # ========================================================================
    # Опциональные методы - могут быть переопределены в стратегиях
    # ========================================================================

    async def create_folder(
        self,
        storage: "AttachmentStorage",
        folder_name: str,
        parent_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """
        Создать папку в хранилище (для облачных хранилищ).

        Args:
            storage: Экземпляр хранилища
            folder_name: Имя папки
            parent_id: ID родительской папки
            metadata: Дополнительные метаданные

        Returns:
            ID созданной папки или None если не поддерживается
        """
        logger.debug(
            "[%s] create_folder not implemented, returning None",
            self.strategy_type,
        )
        return ""

    async def get_folder_path(
        self,
        storage: "AttachmentStorage",
        res_model: str | None,
        res_id: int | None,
        route_id: int | None = None,
    ) -> str | None:
        """
        Получить или создать путь к папке для файла.

        Используется для организации файлов по папкам на основе модели и записи.

        Args:
            storage: Экземпляр хранилища
            res_model: Название модели
            res_id: ID записи
            route_id: ID маршрута (для сложной маршрутизации)

        Returns:
            ID или путь к папке
        """
        return None

    async def get_credentials(
        self, storage: "AttachmentStorage"
    ) -> Any | None:
        """
        Получить или обновить credentials для API.

        Для хранилищ с OAuth или API ключами.

        Args:
            storage: Экземпляр хранилища

        Returns:
            Credentials объект или None
        """
        return None

    async def validate_connection(self, storage: "AttachmentStorage") -> bool:
        """
        Проверить соединение с хранилищем.

        Args:
            storage: Экземпляр хранилища

        Returns:
            True если соединение успешно, иначе False
        """
        return True

    async def get_file_url(
        self,
        storage: "AttachmentStorage",
        attachment: "Attachment",
    ) -> str | None:
        """
        Получить публичный URL файла для просмотра/скачивания.

        Args:
            storage: Экземпляр хранилища
            attachment: Экземпляр вложения

        Returns:
            URL файла или None
        """
        return attachment.storage_file_url

    async def read_range(
        self,
        storage: "AttachmentStorage",
        attachment: "Attachment",
        headers: dict[str, str],
        request_headers: Headers,
    ) -> Response:
        """
        Ответ с файлом, который читается по кускам (Range) — только у
        стратегий с supports_streaming.

        Args:
            storage: Экземпляр хранилища
            attachment: Экземпляр вложения
            headers: Заголовки ответа (Content-Disposition, ETag и т.д.)
            request_headers: Заголовки запроса: Range браузера,
                X-Accel-Mapping от nginx

        Returns:
            HTTP-ответ с файлом
        """
        raise NotImplementedError(
            f"read_range not supported for {self.strategy_type}"
        )

    async def move_file(
        self,
        storage: "AttachmentStorage",
        attachment: "Attachment",
        new_parent_id: str,
    ) -> dict[str, Any]:
        """
        Переместить файл в другую папку (для облачных хранилищ).

        Args:
            storage: Экземпляр хранилища
            attachment: Экземпляр вложения
            new_parent_id: ID новой родительской папки

        Returns:
            Словарь с обновленными данными
        """
        raise NotImplementedError(
            f"move_file not supported for {self.strategy_type}"
        )

    # ========================================================================
    # Вспомогательные методы
    # ========================================================================

    @staticmethod
    def storage_name(attachment: "Attachment", filename: str) -> str:
        """Имя файла в хранилище: <id записи>-<очищенное имя>. Префикс id
        делает имя уникальным по построению — имя задаёт отправитель
        («Договор.pdf» шлют все подряд), и без префикса второй файл затёр
        бы первый. Пользователю имя отдаётся из базы (attachment.name).
        Хранилищам с id файлов (Google Drive) префикс не нужен."""
        return f"{attachment.id}-{sanitize_filename(filename)}"

    async def _stream_url(
        self,
        url: str,
        request_headers: dict[str, str],
        range_header: str | None,
        headers: dict[str, str],
        media_type: str | None,
    ) -> Response:
        """
        Отдать файл по ссылке провайдера потоком (read_range облачных
        хранилищ): Range браузера уходит провайдеру, его ответ (200 или
        206 с куском) идёт браузеру по мере получения — сервер файл целиком
        не скачивает и в памяти не держит.

        Args:
            url: Ссылка на содержимое файла у провайдера
            request_headers: Заголовки запроса к провайдеру (авторизация)
            range_header: Заголовок Range запроса браузера (или None)
            headers: Заголовки ответа (Content-Disposition, ETag и т.д.)
            media_type: MIME-тип файла

        Returns:
            Потоковый ответ; 502 — если провайдер не отдал файл
        """
        # identity — без сжатия: длина и куски у провайдера те же, что
        # уйдут браузеру
        request_headers = {**request_headers, "Accept-Encoding": "identity"}
        if range_header:
            request_headers["Range"] = range_header

        client = httpx.AsyncClient(
            timeout=STREAM_TIMEOUT, follow_redirects=True
        )
        try:
            upstream = await client.send(
                client.build_request("GET", url, headers=request_headers),
                stream=True,
            )
        except Exception:
            await client.aclose()
            raise

        async def close() -> None:
            await upstream.aclose()
            await client.aclose()

        if upstream.status_code not in (200, 206):
            await close()
            logger.error(
                "[%s] stream failed: %s %s",
                self.strategy_type,
                upstream.status_code,
                url,
            )
            return Response(status_code=502)

        passed = {
            name: upstream.headers[name]
            for name in ("Content-Length", "Content-Range", "Accept-Ranges")
            if name in upstream.headers
        }
        return StreamingResponse(
            upstream.aiter_bytes(),
            status_code=upstream.status_code,
            media_type=media_type,
            headers={**headers, **passed},
            background=BackgroundTask(close),
        )

    def _log_operation(
        self, operation: str, attachment: "Attachment", **kwargs
    ) -> None:
        """Логирование операции."""
        extra = ", ".join(f"{k}={v}" for k, v in kwargs.items() if v)
        logger.debug(
            "[%s] %s: attachment_id=%s, name=%s%s",
            self.strategy_type,
            operation,
            attachment.id,
            attachment.name,
            ", " + extra if extra else "",
        )

    def _build_file_path(
        self,
        base_path: str,
        res_model: str | None,
        res_id: int | None,
        filename: str,
    ) -> str:
        """
        Построить путь к файлу.

        Args:
            base_path: Базовый путь хранилища
            res_model: Название модели
            res_id: ID записи
            filename: Имя файла

        Returns:
            Полный путь к файлу
        """
        import os

        parts = [base_path]

        if res_model:
            # Заменяем точки на слеши для модулей (partner.contact -> partner/contact)
            parts.append(res_model.replace(".", "/"))

        if res_id:
            parts.append(str(res_id))

        parts.append(filename)

        return os.path.join(*parts)

    def _get_parent_id(self, storage: "AttachmentStorage") -> str | None:
        """
        Получить ID родительской папки для файлов.

        Args:
            storage: Хранилище

        Returns:
            ID папки или None для корня My Drive
        """
        return None
