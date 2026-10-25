# Copyright 2025 FARA CRM
# Attachments module - base storage strategy

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any
import logging

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
