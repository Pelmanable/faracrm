"""
Загрузка файла частями (/attachments/uploads) и вложение по upload_id.

Tests cover:
- части по порядку, докачка (GET), 409 на чужой позиции, пределы размера
- отмена и чужая загрузка
- создание и замена файла вложения по upload_id, ошибки «не догружена» и
  «не найдена»
- base64 в content — понятная ошибка 400
- content байтами из кода сервера пишется, как раньше
- cron: старые загрузки и файлы без строки удаляются

Run: pytest tests/integration/attachments/test_chunked_upload.py -v -m integration
"""

import hashlib
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.api]

from backend.base.crm.attachments.models.attachments import Attachment
from backend.base.crm.attachments.models.attachments_upload import (
    AttachmentUpload,
)
from backend.base.crm.attachments.routers import (
    attachments as attachments_router,
)
from tests.conftest import auto
from tests.integration.chat.conftest import auth_headers

PART = {"Content-Type": "application/offset+octet-stream"}


async def start_upload(client, size: int, **kwargs) -> int:
    """Открыть загрузку — upload_id."""
    r = await client.post(
        "/attachments/uploads",
        json={"name": "file.txt", "mimetype": "text/plain", "size": size},
        **kwargs,
    )
    assert r.status_code == 200, r.text
    assert r.json()["offset"] == 0
    return r.json()["id"]


async def send_part(client, upload_id: int, offset: int, data: bytes):
    return await client.patch(
        f"/attachments/uploads/{upload_id}",
        content=data,
        headers={**PART, "Upload-Offset": str(offset)},
    )


async def upload_bytes(client, data: bytes, part: int | None = None) -> int:
    """Загрузить байты частями по part (по умолчанию — одной) — upload_id.
    Общий помощник тестов чата и импорта Excel."""
    upload_id = await start_upload(client, len(data))
    part = part or len(data)
    for offset in range(0, len(data), part):
        r = await send_part(
            client, upload_id, offset, data[offset : offset + part]
        )
        assert r.status_code == 200, r.text
    return upload_id


async def download(client, attachment_id: int) -> bytes:
    r = await client.get(f"/attachments/{attachment_id}")
    assert r.status_code == 200, r.text
    return r.content


class TestUploadParts:
    """POST/PATCH/GET/DELETE /attachments/uploads."""

    async def test_parts_in_order(self, authenticated_client, filestore):
        client, _, _ = authenticated_client
        data = b"0123456789abcdefghij"

        upload_id = await upload_bytes(client, data, part=7)

        r = await client.get(f"/attachments/uploads/{upload_id}")
        assert r.json() == {"offset": len(data), "size": len(data)}
        assert (filestore / ".uploads" / str(upload_id)).read_bytes() == data

    async def test_wrong_offset_conflict(
        self, authenticated_client, filestore
    ):
        client, _, _ = authenticated_client
        upload_id = await start_upload(client, 10)

        r = await send_part(client, upload_id, 5, b"56789")

        assert r.status_code == 409
        assert r.json() == {"offset": 0}

    async def test_resend_part_overwrites_tail(
        self, authenticated_client, filestore
    ):
        """Повтор части после обрыва: позиция из БД, хвост обрезается."""
        client, _, _ = authenticated_client
        upload_id = await start_upload(client, 6)
        await send_part(client, upload_id, 0, b"abc")
        # Обрыв: на диске недописанный хвост, в БД его нет
        path = filestore / ".uploads" / str(upload_id)
        path.write_bytes(b"abcJUNK")

        r = await send_part(client, upload_id, 3, b"def")

        assert r.json() == {"offset": 6}
        assert path.read_bytes() == b"abcdef"

    async def test_part_larger_than_part_size(
        self, authenticated_client, filestore, monkeypatch
    ):
        client, _, _ = authenticated_client
        monkeypatch.setattr(attachments_router, "PART_SIZE", 4)
        upload_id = await start_upload(client, 10)

        r = await send_part(client, upload_id, 0, b"0123456789")

        assert r.status_code == 413

    async def test_part_beyond_file_size(
        self, authenticated_client, filestore
    ):
        client, _, _ = authenticated_client
        upload_id = await start_upload(client, 3)

        r = await send_part(client, upload_id, 0, b"12345")

        assert r.status_code == 400
        assert r.json()["content"] == "UPLOAD_SIZE_EXCEEDED"

    async def test_file_larger_than_max_upload_size(
        self, authenticated_client, filestore
    ):
        client, _, _ = authenticated_client

        r = await client.post(
            "/attachments/uploads",
            json={"name": "big.bin", "size": 2 * 1024**3},
        )

        assert r.status_code == 413
        assert r.json()["content"] == "UPLOAD_TOO_LARGE"

    async def test_abort(self, authenticated_client, filestore):
        client, _, _ = authenticated_client
        upload_id = await start_upload(client, 10)

        r = await client.delete(f"/attachments/uploads/{upload_id}")

        assert r.status_code == 200
        r = await client.get(f"/attachments/uploads/{upload_id}")
        assert r.status_code == 404
        assert not (filestore / ".uploads" / str(upload_id)).exists()

    async def test_foreign_upload_not_found(
        self, authenticated_client, filestore, user_factory
    ):
        client, _, _ = authenticated_client
        other = await user_factory(login="other")
        other_headers = await auth_headers(other.id)
        upload_id = await start_upload(client, 10)

        r = await client.get(
            f"/attachments/uploads/{upload_id}", headers=other_headers
        )

        assert r.status_code == 404


class TestAttachmentFromUpload:
    """Вложение по upload_id: POST и PUT автокруда."""

    async def test_create(self, authenticated_client, filestore):
        client, _, _ = authenticated_client
        data = b"attachment content"
        upload_id = await upload_bytes(client, data)

        r = await client.post(
            auto("/attachments"),
            json={
                "name": "doc.txt",
                "mimetype": "text/plain",
                "size": len(data),
                "upload_id": upload_id,
            },
        )

        assert r.status_code == 200, r.text
        attachment = await Attachment.get(r.json()["id"])
        assert attachment.size == len(data)
        assert attachment.checksum == hashlib.sha1(data).hexdigest()
        assert await download(client, attachment.id) == data
        # Загрузка израсходована: строки и временного файла нет
        assert not await AttachmentUpload.search(
            filter=[("id", "=", upload_id)]
        )
        assert not (filestore / ".uploads" / str(upload_id)).exists()

    async def test_replace_file(self, authenticated_client, filestore):
        client, _, _ = authenticated_client
        first = await upload_bytes(client, b"old")
        r = await client.post(
            auto("/attachments"),
            json={"name": "a.txt", "size": 3, "upload_id": first},
        )
        attachment_id = r.json()["id"]
        new = b"new, longer content"
        second = await upload_bytes(client, new)

        # Только upload_id: size и checksum сервер пишет сам, хотя PUT
        # автокруда передаёт лишь присланные поля
        r = await client.put(
            auto(f"/attachments/{attachment_id}"), json={"upload_id": second}
        )

        assert r.status_code == 200, r.text
        attachment = await Attachment.get(attachment_id)
        assert attachment.size == len(new)
        assert attachment.checksum == hashlib.sha1(new).hexdigest()
        assert await download(client, attachment_id) == new

    async def test_upload_not_complete(self, authenticated_client, filestore):
        client, _, _ = authenticated_client
        upload_id = await start_upload(client, 10)

        r = await client.post(
            auto("/attachments"),
            json={"name": "a.txt", "size": 10, "upload_id": upload_id},
        )

        assert r.status_code == 400
        assert r.json()["content"] == "UPLOAD_NOT_COMPLETE"
        assert not await Attachment.search(filter=[("name", "=", "a.txt")])

    async def test_upload_not_found(self, authenticated_client, filestore):
        client, _, _ = authenticated_client

        r = await client.post(
            auto("/attachments"),
            json={"name": "a.txt", "size": 10, "upload_id": 999},
        )

        assert r.status_code == 400
        assert r.json()["content"] == "UPLOAD_NOT_FOUND"

    async def test_base64_content_rejected(
        self, authenticated_client, filestore
    ):
        """Старый формат — понятная ошибка, а не вложение без файла."""
        client, _, _ = authenticated_client

        r = await client.post(
            auto("/attachments"),
            json={"name": "old.txt", "size": 5, "content": "aGVsbG8="},
        )

        assert r.status_code == 400
        assert r.json()["content"] == "CONTENT_NOT_SUPPORTED"
        assert "upload_id" in r.json()["detail"]
        # Base64 обратно в ответ не уходит
        assert "aGVsbG8=" not in r.text
        assert not await Attachment.search(filter=[("name", "=", "old.txt")])

    async def test_server_bytes_content(self, filestore):
        """Код сервера (входящие из мессенджеров, отчёты) пишет байтами."""
        data = b"bytes from server code"

        attachment_id = await Attachment.create(
            Attachment(name="server.txt", mimetype="text/plain", content=data)
        )

        attachment = await Attachment.get(attachment_id)
        assert attachment.size == len(data)
        assert attachment.checksum == hashlib.sha1(data).hexdigest()
        assert Path(attachment.storage_file_url).read_bytes() == data


class TestCleanup:
    """AttachmentUpload.cron_cleanup."""

    async def test_removes_stale_uploads_and_files(
        self, authenticated_client, filestore
    ):
        client, _, _ = authenticated_client
        stale = await start_upload(client, 10)
        fresh = await start_upload(client, 10)
        old = datetime.now(timezone.utc) - timedelta(days=2)
        await AttachmentUpload._get_db_session().execute(
            "UPDATE attachments_upload SET write_datetime = %s WHERE id = %s",
            (old, stale),
            cursor="void",
        )
        uploads_dir = filestore / ".uploads"
        # Файл брошенной загрузки и файл без строки — старые по mtime
        stray = uploads_dir / "999999"
        stray.write_bytes(b"x")
        two_days_ago = time.time() - 2 * 24 * 3600
        for path in (uploads_dir / str(stale), stray):
            os.utime(path, (two_days_ago, two_days_ago))

        result = await AttachmentUpload.cron_cleanup()

        assert result == {"uploads": 1, "files": 2}
        left = await AttachmentUpload.search(fields=["id"])
        assert [u.id for u in left] == [fresh]
        assert sorted(p.name for p in uploads_dir.iterdir()) == [str(fresh)]
