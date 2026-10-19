# Copyright 2025 FARA CRM
# Marketing module — publish from a Telegram user account (Telethon)

import io
from typing import TYPE_CHECKING

from .strategy import PublishStrategyBase

if TYPE_CHECKING:
    from telethon import TelegramClient
    from backend.base.crm.attachments.models.attachments import Attachment
    from ..models.marketing_channel import MarketingChannel
    from ..models.marketing_publication import MarketingPublication
    from ..models.marketing_video import MarketingVideo


class TelegramAccountPublishStrategy(PublishStrategyBase):
    """Сторис и посты в группу или канал от имени аккаунта Telegram.

    Бот сторис в группы не публикует (postStory в Bot API — только от
    имени бизнес-аккаунта), поэтому — обычный аккаунт по MTProto через
    Telethon. Аккаунт — админ группы с правом публиковать истории, у группы
    уровень бустов не ниже 1.

    Поля канала: client_id/client_secret — api_id/api_hash с
    my.telegram.org, access_token — сессия Telethon (StringSession, полный
    доступ к аккаунту), oauth_state — phone_code_hash между шагами входа.

    Telethon импортируется внутри методов: без него сервер стартует, а
    ошибку получит только такая публикация или вход.
    """

    kinds = frozenset({"post", "story"})

    async def send_code(self, channel: "MarketingChannel", phone: str) -> dict:
        """Код входа на телефон; вернуть поля канала: сессия и hash кода."""
        client = self._client(channel, session="")
        await client.connect()
        try:
            sent = await client.send_code_request(phone)
        finally:
            await client.disconnect()
        return {
            "access_token": client.session.save(),
            "oauth_state": sent.phone_code_hash,
            "authorized": False,
        }

    async def sign_in(
        self,
        channel: "MarketingChannel",
        phone: str,
        code: str,
        password: str,
    ) -> dict | None:
        """Войти кодом или паролем 2FA; None — Telegram ждёт пароль.

        Пароль уходит в Telegram и нигде не сохраняется.
        """
        from telethon.errors import SessionPasswordNeededError

        client = self._client(channel, session=channel.access_token)
        await client.connect()
        try:
            if password:
                await client.sign_in(password=password)
            else:
                await client.sign_in(
                    phone, code, phone_code_hash=channel.oauth_state
                )
        except SessionPasswordNeededError:
            return None
        finally:
            await client.disconnect()
        return {
            "access_token": client.session.save(),
            "oauth_state": None,
            "authorized": True,
        }

    async def publish(
        self,
        channel: "MarketingChannel",
        publication: "MarketingPublication",
        video: "MarketingVideo",
        attachment: "Attachment",
    ) -> None:
        from telethon import functions, types, utils

        if not channel.authorized:
            raise ValueError(
                "Аккаунт Telegram не подключён: «Войти в Telegram» в канале"
            )

        client = self._client(channel, session=channel.access_token)
        await client.connect()
        try:
            if not await client.is_user_authorized():
                raise ValueError(
                    "Сессия Telegram завершена — войдите в канале заново"
                )
            # Сессия новая и пустая: группу по числовому id Telethon найдёт
            # только среди загруженных диалогов
            await client.get_dialogs()
            peer = await client.get_input_entity(self._peer(channel.chat_id))

            # Имя у потока — по нему Telethon определяет тип файла
            file = io.BytesIO(attachment.content)
            file.name = attachment.name

            if publication.kind == "post":
                await client.send_file(
                    peer,
                    file,
                    caption=video.caption or "",
                    supports_streaming=True,
                )
                return

            # Размеры и длительность видео читает hachoir
            attributes, mime_type = utils.get_attributes(
                file, mime_type=attachment.mimetype, supports_streaming=True
            )
            uploaded = await client.upload_file(
                attachment.content, file_name=attachment.name
            )
            await client(
                functions.stories.SendStoryRequest(
                    peer=peer,
                    media=types.InputMediaUploadedDocument(
                        file=uploaded,
                        mime_type=mime_type,
                        attributes=attributes,
                    ),
                    privacy_rules=[types.InputPrivacyValueAllowAll()],
                    caption=video.caption or None,
                )
            )
        finally:
            await client.disconnect()

    @staticmethod
    def _client(channel: "MarketingChannel", session: str) -> "TelegramClient":
        """Клиент Telethon; сессия «FARA CRM» видна в Telegram → Устройства."""
        from telethon import TelegramClient
        from telethon.sessions import StringSession

        return TelegramClient(
            StringSession(session),
            int(channel.client_id),
            channel.client_secret,
            device_model="FARA CRM",
        )

    @staticmethod
    def _peer(chat_id: str) -> int | str:
        """-100… — числовой id, иначе @username."""
        return int(chat_id) if chat_id.lstrip("-").isdigit() else chat_id
