# Copyright 2025 FARA CRM
# Marketing module — sign in to a Telegram user account

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

# Вход — только для вошедшего в CRM: сессия Telegram пишется в канал,
# права на изменение канала решают ACL.
router_private = APIRouter(
    tags=["Marketing Telegram"],
    prefix="/marketing/telegram",
    dependencies=[Depends(AuthTokenApp.verify_access)],
)


class TelegramCodePayload(BaseModel):
    phone: str


class TelegramSignInPayload(BaseModel):
    """Второй шаг — phone и code; третий, при 2FA, — только password."""

    phone: str = ""
    code: str = ""
    password: str = ""


async def find_channel(env: "Environment", channel_id: int):
    """Канал Telegram-аккаунта: (запись под пользователем, она же под sudo).

    Первая — проверка доступа и запись результата (ACL на изменение);
    вторая — чтение api_hash, сессии и hash кода (role_read / private).
    """
    channel = await env.models.marketing_channel.search_one(
        filter=[("id", "=", channel_id), ("type", "=", "telegram_account")],
        fields=["id"],
    )
    if not channel:
        return None, None
    channel_sudo = await env.models.marketing_channel.sudo().search_one(
        filter=[("id", "=", channel.id)],
        fields=[
            "id",
            "client_id",
            "client_secret",
            "access_token",
            "oauth_state",
        ],
    )
    return channel, channel_sudo


@router_private.post("/code/{channel_id}")
async def telegram_send_code(
    req: Request, channel_id: Id, payload: TelegramCodePayload
):
    """Отправить код входа на телефон аккаунта."""
    env: "Environment" = req.app.state.env
    channel, channel_sudo = await find_channel(env, channel_id)
    if not channel:
        return JSONResponse({"error": "Канал не найден"}, 404)

    try:
        fields = await STRATEGIES["telegram_account"].send_code(
            channel_sudo, payload.phone
        )
    except Exception as e:
        logger.exception("Telegram send_code failed, channel %s", channel.id)
        return JSONResponse({"error": str(e)}, 400)

    await channel.update(env.models.marketing_channel(**fields))
    return {"ok": True}


@router_private.post("/sign_in/{channel_id}")
async def telegram_sign_in(
    req: Request, channel_id: Id, payload: TelegramSignInPayload
):
    """Войти кодом; если включена 2FA — следующим запросом паролем."""
    env: "Environment" = req.app.state.env
    channel, channel_sudo = await find_channel(env, channel_id)
    if not channel:
        return JSONResponse({"error": "Канал не найден"}, 404)

    try:
        fields = await STRATEGIES["telegram_account"].sign_in(
            channel_sudo, payload.phone, payload.code, payload.password
        )
    except Exception as e:
        logger.exception("Telegram sign_in failed, channel %s", channel.id)
        return JSONResponse({"error": str(e)}, 400)

    if fields is None:
        return {"password_required": True}

    await channel.update(env.models.marketing_channel(**fields))
    return {"ok": True}
