"""
Вложения сообщения чата: файлы и голосовое — загрузкой частями, в сообщение
уходит upload_id.

Run: pytest tests/integration/chat/test_chat_attachments.py -v -m integration
"""

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.api]

from backend.base.crm.attachments.models.attachments import Attachment
from backend.base.crm.attachments.models.attachments_upload import (
    AttachmentUpload,
)
from backend.base.crm.chat.models.chat import Chat
from backend.base.crm.chat.models.chat_member import ChatMember
from backend.base.crm.chat.models.chat_message import ChatMessage
from tests.integration.attachments.test_chunked_upload import (
    download,
    start_upload,
    upload_bytes,
)

# Заголовок webm (EBML) — запись диктофона браузера
VOICE = bytes.fromhex("1a45dfa3") + b"opus voice recording"


async def create_chat(user_id: int) -> int:
    chat_id = await Chat.create(Chat(name="Attachments Chat"))
    await ChatMember.create(
        ChatMember(
            chat_id=chat_id, user_id=user_id, is_active=True, can_write=True
        )
    )
    return chat_id


async def send(client, chat_id: int, body: str, attachments: list):
    return await client.post(
        f"/chats/{chat_id}/messages",
        json={"body": body, "attachments": attachments},
    )


class TestChatAttachments:
    async def test_voice_message(
        self, authenticated_client, filestore, mock_chat_ws
    ):
        client, user_id, _ = authenticated_client
        chat_id = await create_chat(user_id)
        upload_id = await upload_bytes(client, VOICE)

        r = await send(
            client,
            chat_id,
            "",
            [
                {
                    "name": "voice_20261024.webm",
                    "mimetype": "audio/webm",
                    "size": len(VOICE),
                    "upload_id": upload_id,
                    "is_voice": True,
                }
            ],
        )

        assert r.status_code == 200, r.text
        message = r.json()["data"]
        [voice] = message["attachments"]
        assert voice["is_voice"] is True
        assert voice["mimetype"] == "audio/webm"
        assert voice["size"] == len(VOICE)
        assert await download(client, voice["id"]) == VOICE
        attachment = await Attachment.get(voice["id"])
        assert attachment.res_model == "chat_message"
        assert attachment.res_id == message["id"]

    async def test_files_message(
        self, authenticated_client, filestore, mock_chat_ws
    ):
        client, user_id, _ = authenticated_client
        chat_id = await create_chat(user_id)
        files = {
            "report.txt": ("text/plain", b"quarterly report"),
            "photo.png": ("image/png", bytes.fromhex("89504e470d0a1a0a")),
        }
        attachments = [
            {
                "name": name,
                "mimetype": mimetype,
                "size": len(data),
                "upload_id": await upload_bytes(client, data),
            }
            for name, (mimetype, data) in files.items()
        ]

        r = await send(client, chat_id, "Документы", attachments)

        assert r.status_code == 200, r.text
        sent = {a["name"]: a for a in r.json()["data"]["attachments"]}
        assert sent.keys() == files.keys()
        for name, (_, data) in files.items():
            assert await download(client, sent[name]["id"]) == data
        assert not await AttachmentUpload.search(fields=["id"])

    async def test_upload_not_complete_message_not_saved(
        self, authenticated_client, filestore, mock_chat_ws
    ):
        """Файл не догружен — сообщения нет: оно и вложение в одной
        транзакции."""
        client, user_id, _ = authenticated_client
        chat_id = await create_chat(user_id)
        upload_id = await start_upload(client, 10)

        r = await send(
            client,
            chat_id,
            "Файл",
            [
                {
                    "name": "a.txt",
                    "mimetype": "text/plain",
                    "size": 10,
                    "upload_id": upload_id,
                }
            ],
        )

        assert r.status_code == 400
        assert r.json()["content"] == "UPLOAD_NOT_COMPLETE"
        assert not await ChatMessage.search(filter=[("chat_id", "=", chat_id)])

    async def test_base64_content_rejected(
        self, authenticated_client, filestore, mock_chat_ws
    ):
        client, user_id, _ = authenticated_client
        chat_id = await create_chat(user_id)

        r = await send(
            client,
            chat_id,
            "",
            [
                {
                    "name": "voice.webm",
                    "mimetype": "audio/webm",
                    "size": 5,
                    "content": "aGVsbG8=",
                    "is_voice": True,
                }
            ],
        )

        assert r.status_code == 400
        assert r.json()["content"] == "CONTENT_NOT_SUPPORTED"
