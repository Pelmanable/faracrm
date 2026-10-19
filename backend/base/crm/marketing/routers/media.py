# Copyright 2025 FARA CRM
# Marketing module — temporary public link to a video file

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse

from backend.base.crm.auth_token.app import AuthTokenApp

if TYPE_CHECKING:
    from backend.base.system.core.enviroment import Environment

# Площадки, которые сами скачивают видео по ссылке (Instagram, Rutube),
# ходят сюда без входа. Доверие даёт токен публикации: стратегия открывает
# ссылку на время публикации и закрывает после (Rutube — по колбэку).
router_public = APIRouter(
    tags=["Marketing media"],
    prefix="/marketing",
    dependencies=[Depends(AuthTokenApp.use_anonymous_session)],
)


@router_public.get("/media/{token}")
async def marketing_media(req: Request, token: str):
    """Файл ролика публикации по временному токену."""
    env: "Environment" = req.app.state.env
    publication = await env.models.marketing_publication.sudo().search_one(
        filter=[("media_token", "=", token)],
        fields=["id", "video_id"],
    )
    if not publication:
        return JSONResponse({"error": "#NOT_FOUND"}, 404)

    video = await env.models.marketing_video.sudo().search_one(
        filter=[("id", "=", publication.video_id.id)],
        fields=["id", "file"],
    )
    attachment = await env.models.attachment.sudo().search_one(
        filter=[("id", "=", video.file.id)],
    )
    return Response(
        content=await attachment.read_content(),
        media_type=attachment.mimetype,
    )
