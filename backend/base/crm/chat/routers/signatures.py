import json

from fastapi import APIRouter, Depends, HTTPException, Path, Request

from backend.base.crm.auth_token.app import AuthTokenApp
from backend.base.crm.chat.signatures import (
    SignatureSave,
    clean_signature,
    settings_revision,
    validate_settings,
)

router_private = APIRouter(
    tags=["Chat Signatures"],
    dependencies=[Depends(AuthTokenApp.verify_access)],
)


def _user_id(req: Request) -> int:
    user = req.state.session.user_id
    if not user or not (
        user.is_admin
        or any(role.code == "base_user" for role in (user.role_ids or []))
    ):
        raise HTTPException(403, "Chat signatures are available to staff only")
    return user.id


async def _connectors(env):
    return await env.models.chat_connector.search(
        filter=[
            ("type", "!=", "internal"),
            ("category", "in", ["messenger", "social", "email"]),
        ],
        fields=["id", "name", "type", "active"],
        sort="name",
        order="ASC",
        limit=1000,
    )


@router_private.get("/chat/signatures")
async def get_signatures(req: Request):
    user_id = _user_id(req)
    env = req.app.state.env
    connectors = await _connectors(env)
    user = await env.models.user.sudo().get(
        user_id, fields=["id", "chat_signatures"]
    )
    settings = validate_settings(user.chat_signatures)
    return {
        "data": settings,
        "revision": settings_revision(settings),
        "connectors": [
            {"id": c.id, "name": c.name, "type": c.type, "active": c.active}
            for c in connectors
        ],
    }


@router_private.put("/chat/signatures/{connector_id}")
async def save_signature(
    req: Request,
    payload: SignatureSave,
    connector_id: int = Path(gt=0),
):
    user_id = _user_id(req)
    env = req.app.state.env
    connector = next(
        (c for c in await _connectors(env) if c.id == connector_id), None
    )
    if not connector or not connector.active:
        raise HTTPException(400, "Connector is unavailable")

    format = "html" if connector.type == "email" else "text"
    try:
        body = clean_signature(payload.body, format)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error

    # Блокируем запись целиком: настройки разных коннекторов хранятся в одном JSON.
    async with env.apps.db.get_transaction() as transaction:
        rows = await transaction.execute(
            "SELECT chat_signatures FROM users WHERE id = %s FOR UPDATE",
            [user_id],
        )
        if not rows:
            raise HTTPException(404, "User not found")
        stored = rows[0]["chat_signatures"]
        settings = validate_settings(
            json.loads(stored) if isinstance(stored, str) else stored
        )
        if payload.revision != settings_revision(settings):
            raise HTTPException(
                409, "Signatures have changed; reload before saving"
            )

        settings = [s for s in settings if s["connector_id"] != connector_id]
        if body:
            settings.append(
                {
                    "connector_id": connector_id,
                    "body": body,
                    "format": format,
                    "auto_insert": payload.auto_insert,
                }
            )
        try:
            settings = validate_settings(settings)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        # Пользователь определяется сессией, поле закрыто для общего CRUD.
        await env.models.user(id=user_id).sudo().update(
            env.models.user(chat_signatures=settings), session=transaction
        )

    return {"data": settings, "revision": settings_revision(settings)}
