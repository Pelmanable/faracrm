# Copyright 2025 FARA CRM
# Marketing module — publish to Instagram

import asyncio
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING
from urllib.parse import urlencode

import httpx

from backend.base.system.core.enviroment import env
from .strategy import PublishStrategyBase

if TYPE_CHECKING:
    from backend.base.crm.attachments.models.attachments import Attachment
    from ..models.marketing_channel import MarketingChannel
    from ..models.marketing_publication import MarketingPublication
    from ..models.marketing_video import MarketingVideo

AUTH_URL = "https://www.instagram.com/oauth/authorize"
CODE_URL = "https://api.instagram.com/oauth/access_token"
GRAPH_URL = "https://graph.instagram.com"
API_URL = f"{GRAPH_URL}/v25.0"
SCOPE = "instagram_business_basic,instagram_business_content_publish"


class InstagramPublishStrategy(PublishStrategyBase):
    """Reels и сторис в профессиональный аккаунт Instagram.

    Instagram API со входом через Instagram (graph.instagram.com), без
    страницы Facebook. Файл Instagram скачивает сам по video_url — на время
    публикации открыта временная ссылка (publication.open_media_link).

    Токен — долгий, на 60 дней; при публикации продлевается, если до конца
    меньше REFRESH_BEFORE.
    """

    kinds = frozenset({"post", "story"})

    TIMEOUT = 60.0
    REFRESH_BEFORE = timedelta(days=30)
    # Обработку видео ждём до 5 минут
    POLL_INTERVAL = 15
    POLL_ATTEMPTS = 20

    def authorization_url(
        self, channel: "MarketingChannel", redirect_uri: str
    ) -> str:
        """Ссылка на вход в Instagram; state — channel.oauth_state."""
        params = {
            "client_id": channel.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": SCOPE,
            "state": channel.oauth_state,
        }
        return f"{AUTH_URL}?{urlencode(params)}"

    async def fetch_tokens(
        self, channel: "MarketingChannel", code: str, redirect_uri: str
    ) -> dict:
        """code → короткий токен и id аккаунта → долгий токен — поля канала."""
        async with httpx.AsyncClient(
            timeout=self.TIMEOUT, proxy=channel.proxy_url
        ) as client:
            response = await client.post(
                CODE_URL,
                data={
                    "client_id": channel.client_id,
                    "client_secret": channel.client_secret,
                    "grant_type": "authorization_code",
                    "redirect_uri": redirect_uri,
                    "code": code,
                },
            )
            self._raise_for_error(response)
            # В доках ответ — массив data, раньше отдавали плоско
            short = response.json()
            short = short.get("data", [short])[0]

            response = await client.get(
                f"{GRAPH_URL}/access_token",
                params={
                    "grant_type": "ig_exchange_token",
                    "client_secret": channel.client_secret,
                    "access_token": short["access_token"],
                },
            )
            self._raise_for_error(response)

        return {
            **self._token_fields(response.json()),
            "external_account_id": str(short["user_id"]),
        }

    async def publish(
        self,
        channel: "MarketingChannel",
        publication: "MarketingPublication",
        video: "MarketingVideo",
        attachment: "Attachment",
    ) -> str | None:
        if not channel.authorized:
            raise ValueError(
                "Instagram не подключён: «Подключить Instagram» в форме канала"
            )

        token = await self._fresh_token(channel)
        account = f"{API_URL}/{channel.external_account_id}"
        story = publication.kind == "story"
        container = {
            "media_type": "STORIES" if story else "REELS",
            "video_url": await publication.open_media_link(),
        }
        # Подпись принимают только Reels
        if publication.kind == "post" and video.caption:
            container["caption"] = video.caption

        try:
            async with httpx.AsyncClient(
                timeout=self.TIMEOUT,
                proxy=channel.proxy_url,
                headers={"Authorization": f"Bearer {token}"},
            ) as client:
                created = await self._call(
                    client, "POST", f"{account}/media", json=container
                )
                await self._wait_ready(client, created["id"])
                media = await self._call(
                    client,
                    "POST",
                    f"{account}/media_publish",
                    json={"creation_id": created["id"]},
                )
                info = await self._call(
                    client,
                    "GET",
                    f"{API_URL}/{media['id']}",
                    params={"fields": "permalink"},
                )
        finally:
            # Ссылка на файл живёт только пока идёт публикация
            await publication.close_media_link()

        return info.get("permalink")

    async def _fresh_token(self, channel: "MarketingChannel") -> str:
        """Токен канала; продлить и сохранить, если скоро истекает."""
        left = channel.access_token_expires - datetime.now(timezone.utc)
        if left > self.REFRESH_BEFORE:
            return channel.access_token

        async with httpx.AsyncClient(
            timeout=self.TIMEOUT, proxy=channel.proxy_url
        ) as client:
            response = await client.get(
                f"{GRAPH_URL}/refresh_access_token",
                params={
                    "grant_type": "ig_refresh_token",
                    "access_token": channel.access_token,
                },
            )
        self._raise_for_error(response)
        fields = self._token_fields(response.json())
        await channel.update(env.models.marketing_channel(**fields))
        return fields["access_token"]

    async def _wait_ready(self, client: httpx.AsyncClient, container_id: str):
        """Ждать, пока Instagram скачает и обработает видео."""
        for _ in range(self.POLL_ATTEMPTS):
            result = await self._call(
                client,
                "GET",
                f"{API_URL}/{container_id}",
                params={"fields": "status_code,status"},
            )
            if result["status_code"] == "FINISHED":
                return
            if result["status_code"] in ("ERROR", "EXPIRED"):
                raise ValueError(f"Instagram: {result.get('status')}")
            await asyncio.sleep(self.POLL_INTERVAL)
        raise ValueError("Instagram не обработал видео за 5 минут")

    async def _call(
        self, client: httpx.AsyncClient, method: str, url: str, **kwargs
    ) -> dict:
        """Запрос к Graph API; ошибка — исключением с текстом ответа."""
        response = await client.request(method, url, **kwargs)
        self._raise_for_error(response)
        return response.json()

    @staticmethod
    def _token_fields(result: dict) -> dict:
        """Ответ с долгим токеном → поля канала."""
        return {
            "access_token": result["access_token"],
            "access_token_expires": datetime.now(timezone.utc)
            + timedelta(seconds=result["expires_in"]),
        }
