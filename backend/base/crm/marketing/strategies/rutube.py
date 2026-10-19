# Copyright 2025 FARA CRM
# Marketing module — publish to Rutube

from typing import TYPE_CHECKING

import httpx

from backend.base.system.core.enviroment import env
from .strategy import PublishStrategyBase

if TYPE_CHECKING:
    from backend.base.crm.attachments.models.attachments import Attachment
    from ..models.marketing_channel import MarketingChannel
    from ..models.marketing_publication import MarketingPublication
    from ..models.marketing_video import MarketingVideo

API_URL = "https://rutube.ru/api"
# «Разное»; сменить категорию можно в Rutube Studio
CATEGORY_ID = 13


class RutubePublishStrategy(PublishStrategyBase):
    """Видео на канал Rutube через старый API Rutube.

    Документации у API нет — адреса и поля из официального клиента
    (github.com/rutube/php-api-client): вход api/accounts/token_auth/,
    загрузка api/video/ по ссылке на файл. Rutube качает файл уже после
    ответа, поэтому ссылка остаётся открытой до его колбэка
    (routers/rutube.py: callback_url / errback_url). Сторис у Rutube нет.
    """

    TIMEOUT = 60.0

    async def fetch_token(
        self, channel: "MarketingChannel", username: str, password: str
    ) -> dict:
        """Логин и пароль → токен — поля канала. Пароль не сохраняется."""
        async with httpx.AsyncClient(
            timeout=self.TIMEOUT, proxy=channel.proxy_url
        ) as client:
            response = await client.post(
                f"{API_URL}/accounts/token_auth/",
                data={"username": username, "password": password},
            )
        self._raise_for_error(response)
        return {"access_token": response.json()["token"], "authorized": True}

    async def publish(
        self,
        channel: "MarketingChannel",
        publication: "MarketingPublication",
        video: "MarketingVideo",
        attachment: "Attachment",
    ) -> str:
        if not channel.authorized:
            raise ValueError("Rutube не подключён: «Войти в Rutube» в канале")

        link = await publication.open_media_link()
        api_url = await env.models.system_settings.get_api_url()
        done = (
            f"{api_url.rstrip('/')}/marketing/rutube/done/"
            f"{publication.media_token}"
        )
        try:
            async with httpx.AsyncClient(
                timeout=self.TIMEOUT, proxy=channel.proxy_url
            ) as client:
                response = await client.post(
                    f"{API_URL}/video/",
                    headers={"Authorization": f"Token {channel.access_token}"},
                    json={
                        "url": link,
                        "title": video.name,
                        "description": video.caption or "",
                        "is_hidden": 0,
                        "category_id": CATEGORY_ID,
                        "callback_url": done,
                        "errback_url": f"{done}?error=1",
                    },
                )
            self._raise_for_error(response)
        except Exception:
            # Rutube видео не принял — качать нечего, ссылку закрываем сразу
            await publication.close_media_link()
            raise

        return f"https://rutube.ru/video/{response.json()['video_id']}/"
