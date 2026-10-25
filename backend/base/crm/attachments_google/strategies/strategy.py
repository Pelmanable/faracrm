# Copyright 2025 FARA CRM
# Attachments Google Drive module - storage strategy

import asyncio
from datetime import datetime, timezone, timedelta
import io
import json
import logging
from typing import TYPE_CHECKING, Any

from starlette.datastructures import Headers
from starlette.responses import Response

from backend.base.crm.attachments.strategies.strategy import (
    StorageStrategyBase,
)

if TYPE_CHECKING:
    from backend.project_setup import (
        AttachmentStorage,
    )
    from backend.base.crm.attachments.models.attachments import Attachment

logger = logging.getLogger(__name__)

# Google API scopes
SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/drive.file",
]

# Содержимое файла: GET {DRIVE_FILES_URL}/{id}?alt=media (понимает Range)
DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files"


async def _execute(request) -> Any:
    """Запрос Drive API — в потоке: клиент Google синхронный (httplib2), и
    загрузка файла целиком держала бы все запросы воркера."""
    return await asyncio.to_thread(request.execute)


class GoogleDriveStrategy(StorageStrategyBase):
    """
    Стратегия хранения файлов в Google Drive.

    Поддерживает:
    - Создание, чтение, обновление, удаление файлов
    - Создание папок
    - My Drive и Shared Drives (Team Drives)
    - OAuth2 авторизация

    Требует установки пакетов:
    - google-auth
    - google-auth-oauthlib
    - google-api-python-client
    """

    strategy_type = "google"
    supports_streaming = True

    # URL для просмотра папок в Google Drive
    folder_url = "https://drive.google.com/drive/folders/"
    file_url = "https://drive.google.com/file/d/"

    async def _get_service(self, storage: "AttachmentStorage"):
        """
        Создать Google Drive API service.

        Args:
            storage: Хранилище с credentials

        Returns:
            Google Drive API service object

        Raises:
            ValueError: Если credentials не настроены
        """
        from googleapiclient.discovery import build

        credentials = await self.get_credentials(storage)
        # Сборка клиента разбирает описание API (сотни КБ JSON) — тоже в потоке
        return await asyncio.to_thread(
            build, "drive", "v3", credentials=credentials
        )

    async def get_credentials(self, storage: "AttachmentStorage"):
        """
        Credentials Google с действующим access token: истёкший (или
        истекающий) обновляется и сохраняется в storage.

        Args:
            storage: Хранилище с credentials

        Returns:
            google.oauth2.credentials.Credentials

        Raises:
            ValueError: Если credentials не настроены или не читаются
        """
        import google.oauth2.credentials
        from google.auth.transport.requests import Request

        if not storage.google_credentials:
            raise ValueError(
                f"Google Drive credentials not configured for storage {storage.id}"
            )

        try:
            credentials_data = json.loads(storage.google_credentials)

            # Извлекаем expiry отдельно (не передаём в Credentials)
            expiry_value = credentials_data.pop("expiry", None)

            credentials = google.oauth2.credentials.Credentials(
                **credentials_data
            )

            # Проверяем нужно ли обновить токен
            needs_refresh = False
            now = datetime.now(timezone.utc)

            if expiry_value is None:
                needs_refresh = True
                logger.debug("Token expiry unknown, refreshing")
            else:
                # Парсим expiry (может быть timestamp или ISO строка)
                expiry = datetime.fromisoformat(
                    expiry_value.replace("Z", "+00:00")
                )

                if expiry <= now:
                    needs_refresh = True
                    logger.debug("Token expired")
                elif expiry < now + timedelta(minutes=5):
                    needs_refresh = True
                    logger.debug("Token expires soon, refreshing preventively")

            if needs_refresh and credentials.refresh_token:
                logger.debug("Refreshing access token...")
                # HTTP-запрос к Google — в потоке, как и _execute
                await asyncio.to_thread(credentials.refresh, Request())

                # Сохраняем обновлённые credentials обратно в storage
                await self._save_refreshed_credentials(storage, credentials)

            return credentials
        except Exception as e:
            logger.error("Failed to load Google credentials: %s", e)
            raise ValueError(f"Invalid Google credentials: {e}") from e

    async def _save_refreshed_credentials(
        self,
        storage: "AttachmentStorage",
        credentials,
    ) -> None:
        """
        Сохранить обновлённые credentials в storage.

        Args:
            storage: Хранилище
            credentials: Обновлённые Google credentials
        """
        from backend.base.system.core.enviroment import env

        # Обновляем в памяти
        storage.google_credentials = credentials.to_json()

        # Асинхронно сохраняем в БД
        updated_storage = env.models.attachment_storage()
        updated_storage.google_credentials = credentials.to_json()
        await storage.update(
            updated_storage,
        )
        logger.debug("Refreshed credentials saved to storage %s", storage.id)

    def _get_parent_id(self, storage: "AttachmentStorage") -> str | None:
        """
        Получить ID родительской папки для файлов.

        Args:
            storage: Хранилище

        Returns:
            ID папки или None для корня My Drive
        """
        # Приоритет: team drive -> folder_id -> None (root)
        if storage.google_team_enabled and storage.google_team_id:
            return storage.google_team_id
        return storage.google_folder_id

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
        Создать файл в Google Drive.

        Args:
            storage: Хранилище
            attachment: Вложение
            content: Содержимое файла
            filename: Имя файла
            mimetype: MIME-тип
            parent_id: ID родительской папки (опционально)

        Returns:
            Словарь с storage_file_id, storage_file_url, etc.
        """
        from googleapiclient.http import MediaIoBaseUpload

        self._log_operation("create_file", attachment, filename=filename)

        service = await self._get_service(storage)

        # Метаданные файла
        file_metadata = {"name": filename}

        # Устанавливаем родительскую папку
        # Приоритет: переданный parent_id -> настройки storage
        if parent_id:
            file_metadata["parents"] = [parent_id]
        else:
            default_parent_id = self._get_parent_id(storage)
            if default_parent_id:
                file_metadata["parents"] = [default_parent_id]

        # Для Shared Drive
        if storage.google_team_enabled and storage.google_team_id:
            file_metadata["driveId"] = storage.google_team_id

        # Загружаем файл
        media = MediaIoBaseUpload(
            io.BytesIO(content),
            mimetype=mimetype or "application/octet-stream",
            resumable=True,
        )

        try:
            file = await _execute(
                service.files().create(
                    body=file_metadata,
                    media_body=media,
                    fields="id, webViewLink, parents",
                    supportsTeamDrives=storage.google_team_enabled or None,
                )
            )

            logger.info(
                "File created in Google Drive: %s - %s",
                file.get("id"),
                filename,
            )

            return {
                "storage_file_id": file.get("id"),
                "storage_file_url": file.get("webViewLink"),
                "storage_parent_id": parent_id or self._get_parent_id(storage),
                "storage_parent_name": None,  # Можно получить отдельным запросом
            }

        except Exception as e:
            logger.error("Failed to create file in Google Drive: %s", e)
            raise

    async def read_file(
        self,
        storage: "AttachmentStorage",
        attachment: "Attachment",
    ) -> bytes | None:
        """
        Прочитать файл из Google Drive.

        Args:
            storage: Хранилище
            attachment: Вложение

        Returns:
            Содержимое файла или None
        """
        from googleapiclient.http import MediaIoBaseDownload

        if not attachment.storage_file_id:
            logger.warning(
                "No storage_file_id for attachment %s", attachment.id
            )
            return None

        self._log_operation(
            "read_file", attachment, file_id=attachment.storage_file_id
        )

        service = await self._get_service(storage)

        try:
            request = service.files().get_media(
                fileId=attachment.storage_file_id,
                supportsTeamDrives=storage.google_team_enabled or None,
            )

            # Скачивание кусками — синхронные запросы, в потоке (см. _execute)
            def download() -> bytes:
                buffer = io.BytesIO()
                downloader = MediaIoBaseDownload(buffer, request)
                done = False
                while not done:
                    _, done = downloader.next_chunk()
                return buffer.getvalue()

            content = await asyncio.to_thread(download)
            logger.debug(
                "File downloaded from Google Drive: %s bytes", len(content)
            )
            return content

        except Exception as e:
            logger.error(
                "Failed to read file %s from Google Drive: %s",
                attachment.storage_file_id,
                e,
            )
            return None

    async def read_range(
        self,
        storage: "AttachmentStorage",
        attachment: "Attachment",
        headers: dict[str, str],
        request_headers: Headers,
    ) -> Response:
        """
        Файл из Google Drive потоком: Drive API (alt=media) отдаёт куски
        по Range сам; supportsAllDrives — чтобы читались и общие диски.
        """
        self._log_operation(
            "read_range", attachment, file_id=attachment.storage_file_id
        )

        credentials = await self.get_credentials(storage)
        url = (
            f"{DRIVE_FILES_URL}/{attachment.storage_file_id}"
            "?alt=media&supportsAllDrives=true"
        )
        return await self._stream_url(
            url,
            {"Authorization": f"Bearer {credentials.token}"},
            request_headers.get("range"),
            headers,
            attachment.mimetype,
        )

    async def update_file(
        self,
        storage: "AttachmentStorage",
        attachment: "Attachment",
        content: bytes | None = None,
        filename: str | None = None,
        mimetype: str | None = None,
    ) -> dict[str, Any]:
        """
        Обновить файл в Google Drive.

        Args:
            storage: Хранилище
            attachment: Вложение
            content: Новое содержимое
            filename: Новое имя
            mimetype: Новый MIME-тип

        Returns:
            Словарь с обновленными данными
        """
        from googleapiclient.http import MediaIoBaseUpload

        if not attachment.storage_file_id:
            raise ValueError(
                f"No storage_file_id for attachment {attachment.id}"
            )

        self._log_operation(
            "update_file",
            attachment,
            file_id=attachment.storage_file_id,
            new_filename=filename,
        )

        service = await self._get_service(storage)

        try:
            file_metadata = {}
            if filename:
                file_metadata["name"] = filename

            if content:
                media = MediaIoBaseUpload(
                    io.BytesIO(content),
                    mimetype=mimetype
                    or attachment.mimetype
                    or "application/octet-stream",
                    resumable=True,
                )

                if file_metadata:
                    await _execute(
                        service.files().update(
                            fileId=attachment.storage_file_id,
                            body=file_metadata,
                            media_body=media,
                            supportsTeamDrives=storage.google_team_enabled
                            or None,
                        )
                    )
                else:
                    await _execute(
                        service.files().update(
                            fileId=attachment.storage_file_id,
                            media_body=media,
                            supportsTeamDrives=storage.google_team_enabled
                            or None,
                        )
                    )
            elif file_metadata:
                await _execute(
                    service.files().update(
                        fileId=attachment.storage_file_id,
                        body=file_metadata,
                        supportsTeamDrives=storage.google_team_enabled or None,
                    )
                )

            logger.info(
                "File updated in Google Drive: %s", attachment.storage_file_id
            )

            return {
                "storage_file_id": attachment.storage_file_id,
            }

        except Exception as e:
            logger.error(
                "Failed to update file %s in Google Drive: %s",
                attachment.storage_file_id,
                e,
            )
            raise

    async def delete_file(
        self,
        storage: "AttachmentStorage",
        attachment: "Attachment",
    ) -> bool:
        """
        Удалить файл из Google Drive.

        Args:
            storage: Хранилище
            attachment: Вложение

        Returns:
            True если файл удален
        """
        if not attachment.storage_file_id:
            logger.warning(
                "No storage_file_id for attachment %s", attachment.id
            )
            return False

        self._log_operation(
            "delete_file", attachment, file_id=attachment.storage_file_id
        )

        service = await self._get_service(storage)

        try:
            await _execute(
                service.files().delete(
                    fileId=attachment.storage_file_id,
                    supportsTeamDrives=storage.google_team_enabled or None,
                )
            )

            logger.info(
                "File deleted from Google Drive: %s",
                attachment.storage_file_id,
            )
            return True

        except Exception as e:
            logger.error(
                "Failed to delete file %s from Google Drive: %s",
                attachment.storage_file_id,
                e,
            )
            return False

    async def create_folder(
        self,
        storage: "AttachmentStorage",
        folder_name: str,
        parent_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str | None:
        """
        Создать папку в Google Drive.

        Если папка с таким именем уже существует в parent - возвращает её ID.

        Args:
            storage: Хранилище
            folder_name: Имя папки
            parent_id: ID родительской папки
            metadata: Дополнительные метаданные (properties)

        Returns:
            ID созданной/существующей папки
        """
        logger.debug(
            "[google] create_folder: %s, parent=%s", folder_name, parent_id
        )

        service = await self._get_service(storage)

        # Определяем родителя
        if not parent_id:
            parent_id = self._get_parent_id(storage)

        try:
            # Экранируем спецсимволы в имени
            escaped_name = folder_name.replace("\\", "\\\\").replace(
                "'", r"\'"
            )

            # Проверяем существует ли уже такая папка
            query = (
                f"mimeType='application/vnd.google-apps.folder' "
                f"and trashed=false and name='{escaped_name}'"
            )
            if parent_id:
                query += f" and parents='{parent_id}'"

            response = await _execute(
                service.files().list(
                    q=query,
                    supportsAllDrives=storage.google_team_enabled or None,
                    supportsTeamDrives=storage.google_team_enabled or None,
                    includeTeamDriveItems=storage.google_team_enabled or None,
                    includeItemsFromAllDrives=storage.google_team_enabled
                    or None,
                    corpora=(
                        "allDrives" if storage.google_team_enabled else "user"
                    ),
                )
            )

            # Если папка существует - возвращаем её ID
            if response.get("files"):
                folder_id = response["files"][0].get("id")
                logger.debug("Folder already exists: %s", folder_id)
                return folder_id

            # Создаем новую папку
            file_metadata = {
                "name": folder_name,
                "mimeType": "application/vnd.google-apps.folder",
            }

            if parent_id:
                file_metadata["parents"] = [parent_id]

            if metadata:
                file_metadata["properties"] = metadata

            if storage.google_team_enabled and storage.google_team_id:
                file_metadata["driveId"] = storage.google_team_id

            folder = await _execute(
                service.files().create(
                    body=file_metadata,
                    fields="id",
                    supportsTeamDrives=storage.google_team_enabled or None,
                )
            )

            folder_id = folder.get("id")
            logger.info("Folder created in Google Drive: %s", folder_id)
            return folder_id

        except Exception as e:
            logger.error("Failed to create folder in Google Drive: %s", e)
            return None

    async def validate_connection(self, storage: "AttachmentStorage") -> bool:
        """
        Проверить подключение к Google Drive.

        Args:
            storage: Хранилище

        Returns:
            True если подключение успешно
        """
        if not storage.google_credentials:
            return False

        try:
            service = await self._get_service(storage)

            # Пробуем получить информацию о пользователе
            about = await _execute(service.about().get(fields="user"))

            logger.info(
                "Google Drive connected as: %s",
                about.get("user", {}).get("emailAddress"),
            )
            return True

        except Exception as e:
            logger.error("Google Drive connection failed: %s", e)
            return False

    async def get_file_url(
        self,
        storage: "AttachmentStorage",
        attachment: "Attachment",
    ) -> str | None:
        """
        Получить URL файла в Google Drive.

        Args:
            storage: Хранилище
            attachment: Вложение

        Returns:
            URL для просмотра файла
        """
        if attachment.storage_file_url:
            return attachment.storage_file_url

        if attachment.storage_file_id:
            return f"{self.file_url}{attachment.storage_file_id}/view"

        return None

    async def move_file(
        self,
        storage: "AttachmentStorage",
        attachment: "Attachment",
        new_parent_id: str,
    ) -> dict[str, Any]:
        """
        Переместить файл в другую папку.

        Args:
            storage: Хранилище
            attachment: Вложение
            new_parent_id: ID новой родительской папки

        Returns:
            Словарь с обновленными данными
        """
        if not attachment.storage_file_id:
            raise ValueError(
                f"No storage_file_id for attachment {attachment.id}"
            )

        self._log_operation(
            "move_file",
            attachment,
            file_id=attachment.storage_file_id,
            new_parent=new_parent_id,
        )

        service = await self._get_service(storage)

        try:
            # Получаем текущих родителей
            file = await _execute(
                service.files().get(
                    fileId=attachment.storage_file_id,
                    fields="parents",
                    supportsTeamDrives=storage.google_team_enabled or None,
                )
            )

            current_parents = ",".join(file.get("parents", []))

            # Перемещаем файл
            updated_file = await _execute(
                service.files().update(
                    fileId=attachment.storage_file_id,
                    addParents=new_parent_id,
                    removeParents=current_parents,
                    fields="id, parents",
                    supportsTeamDrives=storage.google_team_enabled or None,
                )
            )

            logger.info(
                "File moved in Google Drive: %s -> %s",
                attachment.storage_file_id,
                new_parent_id,
            )

            return {
                "storage_parent_id": new_parent_id,
            }

        except Exception as e:
            logger.error(
                "Failed to move file %s: %s", attachment.storage_file_id, e
            )
            raise
