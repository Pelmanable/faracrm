# Copyright 2025 FARA CRM
# Attachments module - FileStore (local filesystem) strategy

import aiofiles
import aiofiles.os
import asyncio
import os
import hashlib
import logging
import uuid
from typing import TYPE_CHECKING, Any
from urllib.parse import quote

from starlette.datastructures import Headers
from starlette.responses import FileResponse, Response

from .strategy import StorageStrategyBase, sanitize_filename
from backend.base.system.core.enviroment import env

if TYPE_CHECKING:
    from backend.base.crm.attachments.models.attachments_storage import (
        AttachmentStorage,
    )
    from backend.base.crm.attachments.models.attachments import Attachment

logger = logging.getLogger(__name__)


# Backward-compatible alias: старое имя для импортов извне модуля.
# Сама функция — в strategy.py (общая для стратегий), отсюда её
# по-прежнему импортируют тесты.
slugify_filename = sanitize_filename


class FileStoreStrategy(StorageStrategyBase):
    """
    Стратегия хранения файлов в локальной файловой системе.

    Файлы сохраняются в структуре:
        filestore/
        └── <parent_id>/
            └── <filename>

    Attributes:
        strategy_type: "file"
    """

    strategy_type = "file"
    supports_streaming = True

    # Путь по умолчанию (fallback если system_settings недоступен)
    DEFAULT_FILESTORE_PATH = os.path.join(os.getcwd(), "filestore")

    # Кеш пути — чтобы не ходить в БД на каждый файл
    _cached_path: str | None = None

    async def _get_base_path(self, storage: "AttachmentStorage") -> str:
        """Get base path for file storage from system_settings."""
        if self._cached_path is not None:
            return self._cached_path
        try:
            path = await env.models.system_settings.get_value(
                "attachments.filestore_path", self.DEFAULT_FILESTORE_PATH
            )
            self._cached_path = str(path)
            return self._cached_path
        except Exception:
            return self.DEFAULT_FILESTORE_PATH

    def _compute_checksum(self, content: bytes) -> str:
        """Compute SHA1 checksum of content."""
        return hashlib.sha1(content).hexdigest()

    @staticmethod
    def _inside_base(base_path: str, path: str) -> str:
        """Путь, если он внутри файлстора, иначе ValueError. Папка записи
        приходит из кэша папок (attachment_cache), абсолютный путь в
        os.path.join отбрасывает base_path — проверяем итог."""
        base = os.path.realpath(base_path)
        real = os.path.realpath(path)
        if real != base and not real.startswith(base + os.sep):
            raise ValueError(f"Path outside filestore: {path}")
        return path

    async def _get_file_path(
        self,
        storage: "AttachmentStorage",
        attachment: "Attachment",
        filename: str,
        parent_id: str,
    ) -> str:
        """
        Build file path for storage.

        Structure: filestore/<parent_id>/<attachment_id>-<filename>

        Имя файла — storage_name: префикс id записи делает путь уникальным
        по построению. Раньше для этого заводили отдельную подпапку
        <attachment_id>/ — префикс в имени даёт ту же уникальность без
        лишнего уровня вложенности.
        """
        base_path = await self._get_base_path(storage)

        parts = [base_path]
        if parent_id:
            parts.append(str(parent_id))
        parts.append(self.storage_name(attachment, filename))

        return self._inside_base(base_path, os.path.join(*parts))

    async def create_file(
        self,
        storage: "AttachmentStorage",
        attachment: "Attachment",
        content: bytes,
        filename: str,
        parent_id: str,
        mimetype: str | None = None,
    ):
        """
        Create file in local filesystem.

        Args:
            storage: Storage instance
            attachment: Attachment instance
            content: File content bytes
            filename: Filename
            mimetype: MIME type (not used for local storage)
            parent_id: Parent folder ID (not used for local storage, ignored)

        Returns:
            Dict with storage_file_url
        """
        self._log_operation("create_file", attachment, filename=filename)
        loop = asyncio.get_running_loop()

        # 1. Подготовка данных
        checksum = await loop.run_in_executor(
            None, self._compute_checksum, content
        )

        file_path = await self._get_file_path(
            storage, attachment, filename, parent_id
        )
        dir_path = os.path.dirname(file_path)

        # 2. Создание директорий (синхронно в потоке)
        await loop.run_in_executor(
            None, lambda: os.makedirs(dir_path, exist_ok=True)
        )

        # 3. Асинхронная запись. "xb", а не "wb": путь с id записи уникален
        # только в пределах базы — файлстор мог остаться от пересозданной
        # базы или делиться с другой. Чужой файл не трогаем, а добавляем к
        # имени случайный uuid.
        try:
            async with aiofiles.open(file_path, mode="xb") as f:
                await f.write(content)
        except FileExistsError:
            stem, ext = os.path.splitext(file_path)
            taken_path = file_path
            file_path = f"{stem}-{uuid.uuid4().hex}{ext}"
            logger.warning(
                "[file] Path already taken (stale or shared filestore?): "
                "%s, writing to %s",
                taken_path,
                file_path,
            )
            async with aiofiles.open(file_path, mode="xb") as f:
                await f.write(content)

        return {
            "storage_file_url": file_path,
            "storage_file_id": None,  # Local storage doesn't use file IDs
            "storage_parent_id": None,
            "storage_parent_name": None,
            "checksum": checksum,
        }

    async def read_file(
        self,
        storage: "AttachmentStorage",
        attachment: "Attachment",
    ):
        """
        Read file from local filesystem.

        Args:
            storage: Storage instance
            attachment: Attachment instance

        Returns:
            File content bytes or None if not found
        """
        self._log_operation("read_file", attachment)

        file_path = attachment.storage_file_url
        if not file_path:
            logger.warning(
                "[file] No file path for attachment %s", attachment.id
            )
            return None

        if not await aiofiles.os.path.exists(file_path):
            logger.warning("[file] File not found: %s", file_path)
            return None

        async with aiofiles.open(file_path, mode="rb") as f:
            return await f.read()

    async def read_range(
        self,
        storage: "AttachmentStorage",
        attachment: "Attachment",
        headers: dict[str, str],
        request_headers: Headers,
    ) -> Response:
        """
        Файл с диска кусками по 64 КБ: Range (перемотка видео, докачка)
        FileResponse берёт из запроса и обрабатывает сам; весь файл в память
        не читается.

        За nginx файл отдаёт nginx. Он сообщает, где у него файлстор:
        X-Accel-Mapping: <путь на диске>=<internal location> — ответ тогда
        без тела, с путём файла в X-Accel-Redirect. Права к этому моменту
        проверены; Content-Type, Content-Disposition и Cache-Control nginx
        сохраняет, Range и ETag обрабатывает сам.
        """
        disk_path, _, location = request_headers.get(
            "x-accel-mapping", ""
        ).partition("=")
        file_path = attachment.storage_file_url
        if location and file_path.startswith(disk_path):
            target = location + quote(file_path[len(disk_path) :])
            return Response(
                headers={**headers, "X-Accel-Redirect": target},
                media_type=attachment.mimetype,
            )
        return FileResponse(
            file_path,
            media_type=attachment.mimetype,
            headers=headers,
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
        Update file in local filesystem.

        If content is provided, overwrites the file.
        If filename is provided and different, creates new file and removes old.

        Args:
            storage: Storage instance
            attachment: Attachment instance
            content: New content (optional)
            filename: New filename (optional)
            mimetype: New MIME type (not used)

        Returns:
            Dict with updated storage info
        """
        self._log_operation("update_file", attachment, filename=filename)
        loop = asyncio.get_running_loop()
        result = {}
        old_path = attachment.storage_file_url

        # If content is provided, update the file
        if content:
            checksum = await loop.run_in_executor(
                None, self._compute_checksum, content
            )
            # Без нового имени — на месте старого файла: путь в базе не
            # меняется (Attachment.update его не переписывает)
            if old_path and not filename:
                new_path = old_path
            else:
                new_path = await self._get_file_path(
                    storage,
                    attachment,
                    filename or attachment.name,
                    attachment.storage_parent_id,
                )

            # Создаем папки и записываем
            await loop.run_in_executor(
                None,
                lambda: os.makedirs(os.path.dirname(new_path), exist_ok=True),
            )
            async with aiofiles.open(new_path, mode="wb") as f:
                await f.write(content)

            # Удаляем старый файл, если путь изменился
            if old_path and old_path != new_path:
                try:
                    if await aiofiles.os.path.exists(old_path):
                        await aiofiles.os.remove(old_path)
                        await loop.run_in_executor(
                            None,
                            self._cleanup_empty_dirs,
                            os.path.dirname(old_path),
                        )
                except Exception as e:
                    logger.warning("[file] Cleanup failed: %s", e)

            result.update({"storage_file_url": new_path, "checksum": checksum})

        # If only filename changed (no content), rename
        elif filename and filename != attachment.name and old_path:
            # Только переименование, в той же папке и по тому же правилу имени
            new_path = os.path.join(
                os.path.dirname(old_path),
                self.storage_name(attachment, filename),
            )
            if await aiofiles.os.path.exists(old_path):
                await aiofiles.os.rename(old_path, new_path)
                result["storage_file_url"] = new_path

        return result

    async def delete_file(
        self,
        storage: "AttachmentStorage",
        attachment: "Attachment",
    ) -> bool:
        """
        Delete file from local filesystem.

        Args:
            storage: Storage instance
            attachment: Attachment instance

        Returns:
            True if deleted successfully
        """
        self._log_operation("delete_file", attachment)

        file_path = attachment.storage_file_url
        if not file_path:
            return True  # Nothing to delete

        if not await aiofiles.os.path.exists(file_path):
            logger.debug("[file] File already deleted: %s", file_path)
            return True

        try:
            await aiofiles.os.remove(file_path)
            # Очистку пустых папок лучше оставить в executor, так как это рекурсивный системный обход
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(
                None, self._cleanup_empty_dirs, os.path.dirname(file_path)
            )
            return True

        except Exception as e:
            logger.error("[file] Delete error: %s", e)
            return False

    def _cleanup_empty_dirs(self, dir_path: str):
        """
        Remove empty directories up to base path.

        Args:
            dir_path: Directory path to start from
        """
        base_path = self._cached_path or self.DEFAULT_FILESTORE_PATH
        try:
            # Используем dir_path как в исходной сигнатуре
            while (
                dir_path
                and dir_path != base_path
                and os.path.isdir(dir_path)
                and not os.listdir(dir_path)
            ):
                os.rmdir(dir_path)
                dir_path = os.path.dirname(dir_path)
        except Exception as e:
            logger.debug("[file] Could not cleanup directories: %s", e)

    async def create_folder(
        self,
        storage: "AttachmentStorage",
        folder_name: str,
        parent_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ):
        """
        Create folder in local filesystem.

        For local storage, folders are created automatically when files are saved.
        This method just returns a path that would be used.

        Args:
            storage: Storage instance
            folder_name: Folder name
            parent_id: Parent folder path (optional)
            metadata: Additional metadata (not used)

        Returns:
            Folder path
        """
        base_path = await self._get_base_path(storage)
        loop = asyncio.get_running_loop()

        # Очищаем имя папки от спецсимволов и путей
        safe_folder_name = sanitize_filename(os.path.basename(folder_name))

        if parent_id:
            folder_path = os.path.join(parent_id, safe_folder_name)
        else:
            folder_path = os.path.join(base_path, safe_folder_name)
        self._inside_base(base_path, folder_path)

        # Создаем директорию асинхронно через executor
        await loop.run_in_executor(
            None, lambda: os.makedirs(folder_path, exist_ok=True)
        )

        logger.debug("[file] Created folder: %s", folder_path)
        return folder_path

    async def validate_connection(self, storage: "AttachmentStorage") -> bool:
        """
        Validate that the storage path is accessible.

        Args:
            storage: Storage instance

        Returns:
            True if path is accessible
        """
        base_path = await self._get_base_path(storage)
        loop = asyncio.get_running_loop()

        try:
            # 1. Проверяем/создаем базовую директорию
            await loop.run_in_executor(
                None, lambda: os.makedirs(base_path, exist_ok=True)
            )

            test_file = os.path.join(base_path, ".test_write")

            # 2. Тестовая запись через aiofiles
            async with aiofiles.open(test_file, mode="w") as f:
                await f.write("test")

            # 3. Удаление через aiofiles.os
            await aiofiles.os.remove(test_file)

            return True
        except Exception as e:
            logger.error("[file] Storage validation failed: %s", e)
            return False
