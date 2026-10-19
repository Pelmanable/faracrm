# Copyright 2025 FARA CRM
# Marketing module — OAuth for YouTube and Instagram channels

import html
import logging
import secrets
from typing import TYPE_CHECKING, Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, JSONResponse

from backend.base.crm.auth_token.app import AuthTokenApp
from backend.base.crm.marketing.strategies import STRATEGIES
from backend.base.system.schemas.base_schema import Id

if TYPE_CHECKING:
    from backend.base.system.core.enviroment import Environment

logger = logging.getLogger(__name__)

# Типы каналов с подключением по OAuth — у их стратегий есть
# authorization_url и fetch_tokens
OAuthType = Literal["youtube", "instagram"]

# Старт — только для вошедшего: он пишет oauth_state в канал, права на
# изменение канала решают ACL.
router_private = APIRouter(
    tags=["Marketing OAuth"],
    prefix="/marketing",
    dependencies=[Depends(AuthTokenApp.verify_access)],
)
# Колбэк — без входа (сюда редиректит площадка), доверие даёт state: под
# анонимной сессией канал по нему читаем и правим через sudo.
router_public = APIRouter(
    tags=["Marketing OAuth"],
    prefix="/marketing",
    dependencies=[Depends(AuthTokenApp.use_anonymous_session)],
)


async def oauth_redirect_uri(env: "Environment", channel_type: str) -> str:
    """Адрес колбэка — его же указывают в приложении площадки.

    127.0.0.1 → localhost: для http Google пускает только localhost.
    """
    api_url = await env.models.system_settings.sudo().get_api_url()
    api_url = api_url.replace("://127.0.0.1", "://localhost")
    return f"{api_url.rstrip('/')}/marketing/{channel_type}/callback"


def callback_page(text: str, status_code: int = 200) -> HTMLResponse:
    """Страница окна согласия: текст итога, форма канала перечитывается."""
    return HTMLResponse(
        content=(
            f"<html><body><p>{html.escape(text)}</p>"
            "<script>window.opener && window.opener.location.reload()"
            "</script></body></html>"
        ),
        status_code=status_code,
    )


@router_private.get("/{channel_type}/auth/{channel_id}")
async def oauth_start(req: Request, channel_type: OAuthType, channel_id: Id):
    """Ссылка на согласие площадки для канала."""
    env: "Environment" = req.app.state.env
    channel = await env.models.marketing_channel.search_one(
        filter=[("id", "=", channel_id), ("type", "=", channel_type)],
        fields=["id", "client_id"],
    )
    if not channel:
        return JSONResponse({"error": "Канал не найден"}, 404)
    if not channel.client_id:
        return JSONResponse({"error": "Сначала заполните Client ID"}, 400)

    channel.oauth_state = secrets.token_urlsafe(32)
    await channel.update(
        env.models.marketing_channel(oauth_state=channel.oauth_state)
    )
    redirect_uri = await oauth_redirect_uri(env, channel_type)
    return {
        "authorization_url": STRATEGIES[channel_type].authorization_url(
            channel, redirect_uri
        )
    }


@router_public.get("/{channel_type}/callback")
async def oauth_callback(req: Request, channel_type: OAuthType):
    """Площадка вернула code: меняем на токены, канал — подключён."""
    env: "Environment" = req.app.state.env
    error = req.query_params.get("error")
    if error:
        return callback_page(f"Доступ не выдан: {error}", 400)

    channel = await env.models.marketing_channel.sudo().search_one(
        filter=[
            ("type", "=", channel_type),
            ("oauth_state", "=", req.query_params.get("state", "")),
        ],
        fields=["id", "client_id", "client_secret", "proxy_url"],
    )
    if not channel:
        return callback_page("Канал не найден — подключите заново", 404)

    try:
        fields = await STRATEGIES[channel_type].fetch_tokens(
            channel,
            req.query_params.get("code", ""),
            await oauth_redirect_uri(env, channel_type),
        )
    except Exception as e:
        logger.exception("OAuth failed for marketing channel %s", channel.id)
        return callback_page(f"Не удалось подключить канал: {e}", 500)

    await channel.sudo().update(
        env.models.marketing_channel(
            **fields, authorized=True, oauth_state=None
        )
    )
    return callback_page("Канал подключён. Окно можно закрыть.")
