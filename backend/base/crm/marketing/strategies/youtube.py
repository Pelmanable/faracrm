# Copyright 2025 FARA CRM
# Marketing module — publish to YouTube

from typing import TYPE_CHECKING
from urllib.parse import urlencode

import httpx

from .strategy import PublishStrategyBase

if TYPE_CHECKING:
    from backend.base.crm.attachments.models.attachments import Attachment
    from ..models.marketing_channel import MarketingChannel
    from ..models.marketing_publication import MarketingPublication
    from ..models.marketing_video import MarketingVideo

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos"
SCOPE = "https://www.googleapis.com/auth/youtube.upload"


class YoutubePublishStrategy(PublishStrategyBase):
    """Загрузка ролика на канал YouTube (Data API v3, resumable upload).

    Вертикальное видео до 3 минут YouTube сам делает Shorts — флага в API
    нет. Заголовок — название ролика, описание — подпись. Сторис у YouTube
    нет.

    Подключение (OAuth, см. routers/oauth.py): authorization_url →
    согласие в Google → колбэк → fetch_tokens. При публикации
    refresh_token меняется на access_token каждый раз — публикаций мало.
    """

    TIMEOUT = 30.0
    # Загрузка файла — минуты, а не секунды
    UPLOAD_TIMEOUT = 600.0

    def authorization_url(
        self, channel: "MarketingChannel", redirect_uri: str
    ) -> str:
        """Ссылка на согласие Google; state — channel.oauth_state."""
        params = {
            "client_id": channel.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": SCOPE,
            "access_type": "offline",
            # Без consent повторное подключение приходит без refresh_token
            "prompt": "consent",
            "state": channel.oauth_state,
        }
        return f"{AUTH_URL}?{urlencode(params)}"

    async def fetch_tokens(
        self, channel: "MarketingChannel", code: str, redirect_uri: str
    ) -> dict:
        """Обменять code из колбэка на refresh_token — поля канала."""
        result = await self._token_request(
            channel,
            {
                "code": code,
                "client_id": channel.client_id,
                "client_secret": channel.client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        return {"refresh_token": result["refresh_token"]}

    async def publish(
        self,
        channel: "MarketingChannel",
        publication: "MarketingPublication",
        video: "MarketingVideo",
        attachment: "Attachment",
    ) -> str:
        if not channel.authorized:
            raise ValueError(
                "YouTube не подключён: «Подключить YouTube» в форме канала"
            )

        token = await self._token_request(
            channel,
            {
                "client_id": channel.client_id,
                "client_secret": channel.client_secret,
                "refresh_token": channel.refresh_token,
                "grant_type": "refresh_token",
            },
        )
        auth = {"Authorization": f"Bearer {token['access_token']}"}
        mimetype = attachment.mimetype or "application/octet-stream"
        metadata = {
            "snippet": {
                "title": video.name,
                "description": video.caption or "",
            },
            "status": {"privacyStatus": "public"},
        }

        async with httpx.AsyncClient(
            timeout=self.UPLOAD_TIMEOUT, proxy=channel.proxy_url
        ) as client:
            # 1. Сессия загрузки: метаданные, в ответ — адрес для файла
            session = await client.post(
                UPLOAD_URL,
                params={"uploadType": "resumable", "part": "snippet,status"},
                headers={
                    **auth,
                    "X-Upload-Content-Length": str(len(attachment.content)),
                    "X-Upload-Content-Type": mimetype,
                },
                json=metadata,
            )
            self._raise_for_error(session)

            # 2. Сам файл
            upload = await client.put(
                session.headers["Location"],
                headers={**auth, "Content-Type": mimetype},
                content=attachment.content,
            )
            self._raise_for_error(upload)

        return f"https://youtu.be/{upload.json()['id']}"

    async def _token_request(
        self, channel: "MarketingChannel", data: dict
    ) -> dict:
        """POST в токен-эндпоинт Google."""
        async with httpx.AsyncClient(
            timeout=self.TIMEOUT, proxy=channel.proxy_url
        ) as client:
            response = await client.post(TOKEN_URL, data=data)
        self._raise_for_error(response)
        return response.json()
