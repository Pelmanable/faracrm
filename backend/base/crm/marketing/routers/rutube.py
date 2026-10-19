# Copyright 2025 FARA CRM
# Marketing module — Rutube sign in and upload callback

import logging
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.base.crm.auth_token.app import AuthTokenApp
from backend.base.crm.marketing.strategies import STRATEGIES
from backend.base.system.schemas.base_schema import Id

if TYPE_CHECKING:
    from backend.base.system.core.enviroment import Environment

logger = logging.getLogger(__name__)

# Вход — только для вошедшего в CRM: токен пишется в канал, права на
# изменение канала решают ACL.
router_private = APIRouter(
    tags=["Marketing Rutube"],
    prefix="/marketing/rutube",
    dependencies=[Depends(AuthTokenApp.verify_access)],
)
# Колбэк — без входа (сюда стучится Rutube), доверие даёт токен ссылки
# публикации: под анонимной сессией публикацию правим через sudo.
router_public = APIRouter(
    tags=["Marketing Rutube"],
    prefix="/marketing/rutube",
    dependencies=[Depends(AuthTokenApp.use_anonymous_session)],
)


class RutubeLoginPayload(BaseModel):
    username: str
    password: str


@router_private.post("/login/{channel_id}")
async def rutube_login(
    req: Request, channel_id: Id, payload: RutubeLoginPayload
):
    """Войти в Rutube логином и паролем; сохраняется только токен."""
    env: "Environment" = req.app.state.env
    channel = await env.models.marketing_channel.search_one(
        filter=[("id", "=", channel_id), ("type", "=", "rutube")],
        fields=["id", "proxy_url"],
    )
    if not channel:
        return JSONResponse({"error": "Канал не найден"}, 404)

    try:
        fields = await STRATEGIES["rutube"].fetch_token(
            channel, payload.username, payload.password
        )
    except Exception as e:
        logger.exception("Rutube login failed, channel %s", channel.id)
        return JSONResponse({"error": str(e)}, 400)

    await channel.update(env.models.marketing_channel(**fields))
    return {"ok": True}


@router_public.api_route("/done/{token}", methods=["GET", "POST"])
async def rutube_done(req: Request, token: str):
    """Rutube скачал и обработал видео (или не смог): закрыть ссылку.

    callback_url — успех, errback_url (?error=1) — ошибка: публикация
    получает статус «Ошибка» с ответом Rutube.
    """
    env: "Environment" = req.app.state.env
    publication = await env.models.marketing_publication.sudo().search_one(
        filter=[("media_token", "=", token)],
        fields=["id"],
    )
    if not publication:
        return JSONResponse({"error": "#NOT_FOUND"}, 404)

    await publication.sudo().close_media_link()
    if req.query_params.get("error"):
        body = (await req.body()).decode(errors="ignore")[:500]
        await publication.sudo().update(
            env.models.marketing_publication(
                state="failed",
                error=f"Rutube не смог загрузить видео: {body}",
            )
        )
    return {"ok": True}
