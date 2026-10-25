import asyncio
import email
import io
import logging
import pathlib
from email import policy
from typing import TYPE_CHECKING
from fastapi import APIRouter, Depends, Header, Request, Response, Query
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field
from starlette.status import (
    HTTP_400_BAD_REQUEST,
    HTTP_404_NOT_FOUND,
    HTTP_409_CONFLICT,
    HTTP_413_CONTENT_TOO_LARGE,
    HTTP_500_INTERNAL_SERVER_ERROR,
)
from PIL import Image
from urllib.parse import quote

from backend.base.crm.attachments.models.attachments import mimetype_essence
from backend.base.crm.attachments.models.attachments_upload import PART_SIZE
from backend.base.crm.attachments.strategies import get_strategy
from backend.base.crm.auth_token.app import AuthTokenApp
from backend.base.system.core.utils import libreoffice
from backend.base.system.schemas.base_schema import Id

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from backend.base.system.core.enviroment import Environment

router_private = APIRouter(
    tags=["Attachment"],
    dependencies=[Depends(AuthTokenApp.verify_access)],
)
# Роутер для бинарного контента — поддержка авторизации через cookie
# Позволяет использовать <img src="...">, <a href="...">, <audio src="...">
# без необходимости передавать Authorization header
router_content = APIRouter(
    tags=["Attachment"],
    dependencies=[Depends(AuthTokenApp.verify_access_by_cookie)],
)

# Типы изображений, которые можно ресайзить
RESIZABLE_MIMETYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
}

# Что браузер только показывает — превью отдаёт inline как есть. Список
# разрешённых, а не запрет: всё, чего здесь нет (SVG, HTML, новый тип),
# идёт исходником или скачиванием. <img>, <video> и <audio> на
# Content-Disposition не смотрят — в чате и окне просмотра файл виден и так
PREVIEW_INLINE_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/webp",
    "image/avif",
    "image/bmp",
    "video/mp4",
    "video/webm",
    "video/ogg",
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg",
    "audio/webm",
    "audio/wav",
    "audio/flac",
    "audio/aac",
    "application/pdf",
    "application/json",
    "text/plain",
}

# Код и разметка, которые превью отдаёт исходником (text/plain); text/* и
# *+xml — тоже, кроме перечисленных в preview_type. Те же типы фронт
# открывает во вкладке как текст (TEXT_MIMETYPES в viewKind.ts)
PREVIEW_AS_TEXT_TYPES = {
    "application/javascript",
    "application/xml",
    "application/x-sh",
    "application/x-yaml",
    "application/sql",
}


def preview_type(mimetype: str | None) -> tuple[str | None, str]:
    """Как превью отдаёт файл: (Content-Type вместо настоящего или None,
    inline/attachment). Превью открывают и по прямой ссылке — загруженный
    HTML, SVG или XML не должен выполнить скрипты на домене CRM. Так же
    отдают файлы публичные ручки (маркетплейс, брендинг, маркетинг)."""
    mimetype = mimetype_essence(mimetype)
    if mimetype in PREVIEW_INLINE_TYPES:
        return None, "inline"
    # SVG показывает <img> (скрипты там не работают), по ссылке — скачать
    if mimetype == "image/svg+xml":
        return None, "attachment"
    # Остальной текст и разметка (html, xml, js…) — исходником
    if (
        mimetype.startswith("text/")
        or mimetype.endswith("+xml")
        or mimetype in PREVIEW_AS_TEXT_TYPES
    ):
        return "text/plain; charset=utf-8", "inline"
    # Прочее (архивы, офис, неизвестный тип) — скачать
    return None, "attachment"


# Документы, которые просмотр показывает как PDF через LibreOffice (Writer) —
# по расширению имени: по нему же LibreOffice выбирает формат на входе
OFFICE_PDF_SUFFIXES = {".doc", ".docm", ".odt", ".ott", ".fodt", ".rtf"}


def parse_email(content: bytes) -> dict:
    """Письмо (.eml) → заголовки, тело (HTML и текст) и имена вложений."""
    message = email.message_from_bytes(content, policy=policy.default)
    html = message.get_body(preferencelist=("html",))
    text = message.get_body(preferencelist=("plain",))
    return {
        "subject": str(message["subject"] or ""),
        "from": str(message["from"] or ""),
        "to": str(message["to"] or ""),
        "date": str(message["date"] or ""),
        "html": html.get_content() if html else "",
        "text": text.get_content() if text else "",
        "attachments": [
            part.get_filename() or "" for part in message.iter_attachments()
        ],
    }


# Больше — не ресайзим: картинка в несколько мегабайт распаковывается в
# гигабайты памяти. 50 Мп — фото с телефона (8000×6000) проходят
RESIZE_MAX_PIXELS = 50_000_000


def resize_image(
    image_bytes: bytes, width: int, height: int, mimetype: str
) -> bytes:
    """Ресайз изображения с сохранением пропорций. Тяжёлая работа —
    вызывать в потоке (asyncio.to_thread). Слишком большая картинка —
    ValueError: вызывающие отдают оригинал."""
    img = Image.open(io.BytesIO(image_bytes))
    if img.width * img.height > RESIZE_MAX_PIXELS:
        raise ValueError(
            f"Image too large to resize: {img.width}x{img.height}"
        )

    # Конвертируем RGBA в RGB для JPEG
    if img.mode == "RGBA" and mimetype in ("image/jpeg", "image/jpg"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        background.paste(img, mask=img.split()[3])
        img = background

    # Ресайз с сохранением пропорций (thumbnail)
    img.thumbnail((width, height), Image.Resampling.LANCZOS)

    # Сохраняем в буфер
    output = io.BytesIO()

    if mimetype == "image/png":
        img.save(output, format="PNG", optimize=True)
    elif mimetype == "image/gif":
        img.save(output, format="GIF")
    elif mimetype == "image/webp":
        img.save(output, format="WEBP", quality=85)
    else:
        img.save(output, format="JPEG", quality=85)

    return output.getvalue()


@router_private.get("/attachments/model_fields/{model_name}")
async def attachment_route_model_fields(req: Request, model_name: str):
    """Список полей модели по её env-имени (значение models.name реестра).

    Используется UI-конструктором шаблонов папок маршрута: чтобы предлагать
    выбор ТОЛЬКО существующих полей выбранной модели вместо ручного ввода
    конструкций вида ``{поле}``.
    """
    env: Environment = req.app.state.env

    model_cls = env.models._get_model(model_name)

    # private отрезается в одном месте — DotModel.get_public_fields()
    field_names = list(model_cls.get_public_fields())

    return model_cls.get_fields_info_list(field_names)


# ── Загрузка частями ────────────────────────────────────
# Файл приходит частями по PART_SIZE по порядку, со смещением (как в tus):
# каждый запрос маленький — лимиты nginx не мешают, обрыв докачивается.
# Готовая загрузка (offset == size) передаётся вместо content как
# upload_id: при создании вложения, в отправке сообщения чата, в PUT.


class UploadStart(BaseModel):
    name: str = Field(..., description="File name")
    mimetype: str | None = Field(None, description="MIME type")
    size: int = Field(..., ge=0, description="File size in bytes")


def upload_not_found() -> JSONResponse:
    return JSONResponse(
        content={"error": "#NOT_FOUND"}, status_code=HTTP_404_NOT_FOUND
    )


@router_private.post("/attachments/uploads")
async def upload_start(req: Request, body: UploadStart):
    """Начать загрузку: {id, part_size, offset}."""
    env: Environment = req.app.state.env
    async with env.apps.db.get_transaction():
        upload = await env.models.attachment_upload.sudo().start(
            body.name, body.mimetype, body.size
        )
    return {"id": upload.id, "part_size": PART_SIZE, "offset": 0}


@router_private.patch("/attachments/uploads/{upload_id}")
async def upload_append(
    req: Request,
    upload_id: Id,
    upload_offset: int = Header(..., ge=0, description="Offset of the part"),
):
    """Часть файла (тело — её байты) с позиции Upload-Offset: {offset}.
    409 с текущим offset — позиция не совпала с полученным."""
    env: Environment = req.app.state.env

    # Тело читаем с пределом: часть больше PART_SIZE в память не берём
    chunk = bytearray()
    async for block in req.stream():
        chunk += block
        if len(chunk) > PART_SIZE:
            return JSONResponse(
                content={"error": "#PART_TOO_LARGE"},
                status_code=HTTP_413_CONTENT_TOO_LARGE,
            )

    async with env.apps.db.get_transaction():
        upload = await env.models.attachment_upload.sudo().get_own(upload_id)
        if upload is None:
            return upload_not_found()
        received = await upload.append(upload_offset, bytes(chunk))

    if received is None:
        return JSONResponse(
            content={"offset": upload.received},
            status_code=HTTP_409_CONFLICT,
        )
    return {"offset": received}


@router_private.get("/attachments/uploads/{upload_id}")
async def upload_status(req: Request, upload_id: Id):
    """Сколько получено — для докачки после обрыва: {offset, size}."""
    env: Environment = req.app.state.env
    upload = await env.models.attachment_upload.sudo().get_own(upload_id)
    if upload is None:
        return upload_not_found()
    return {"offset": upload.received, "size": upload.size}


@router_private.delete("/attachments/uploads/{upload_id}")
async def upload_abort(req: Request, upload_id: Id):
    """Отменить загрузку: строка и временный файл удаляются."""
    env: Environment = req.app.state.env
    async with env.apps.db.get_transaction():
        upload = await env.models.attachment_upload.sudo().get_own(upload_id)
        if upload is None:
            return upload_not_found()
        await upload.sudo().discard()
    return {"ok": True}


@router_private.get("/attachments/{attachment_id}")
async def attachment_content(req: Request, attachment_id: Id):
    """Скачать файл"""
    env: Environment = req.app.state.env
    attach = await env.models.attachment.search_one(
        filter=[("id", "=", attachment_id)],
        fields=[
            "id",
            "res_model",
            "res_id",
            "name",
            "storage_file_url",
            "storage_file_id",
            "mimetype",
            "storage_id",
            "content",
        ],
        # fields_nested={"storage_id": {"fields": ["id", "type", "google_credentials"]}},
    )
    if not attach:
        return JSONResponse(
            content={"error": "#NOT_FOUND"}, status_code=HTTP_404_NOT_FOUND
        )

    # Без filename* браузер не переведет проценты обратно в буквы
    headers = {
        "Content-Disposition": f"attachment; filename*=utf-8''{quote(attach.name, safe='')}"
    }

    # Хранилище со стримингом — отдаёт файл по кускам
    strategy = attach.storage_id and get_strategy(attach.storage_id.type)
    if strategy and strategy.supports_streaming:
        return await strategy.read_range(
            attach.storage_id, attach, headers, req.headers
        )

    # Хранилище без стриминга — читаем целиком
    attachment_content = await attach.read_content()

    return Response(
        headers=headers,
        media_type=attach.mimetype,
        content=attachment_content,
    )


@router_private.get("/attachments/{attachment_id}/preview")
async def attachment_preview(
    req: Request,
    attachment_id: Id,
    w: int | None = Query(None, ge=1, le=2000, description="Width"),
    h: int | None = Query(None, ge=1, le=2000, description="Height"),
):
    """Получить превью файла (для изображений) - inline отображение

    Параметры:
    - w: ширина (опционально)
    - h: высота (опционально)

    Если указаны w и/или h, изображение будет уменьшено с сохранением пропорций.
    """
    env: Environment = req.app.state.env
    attach = await env.models.attachment.search_one(
        filter=[("id", "=", attachment_id)],
        fields=[
            "id",
            "res_model",
            "res_id",
            "name",
            "checksum",
            "storage_file_url",
            "storage_file_id",
            "mimetype",
            "storage_id",
            "content",
        ],
        # fields_nested={"storage_id": {"fields": ["id", "type", "google_credentials"]}},
    )
    if not attach:
        return JSONResponse(
            content={"error": "#NOT_FOUND"}, status_code=HTTP_404_NOT_FOUND
        )

    # ETag на основе checksum + размеров (уникальный ключ варианта)
    etag = f'"{attach.checksum or attach.id}-{w or 0}-{h or 0}"'

    # Если клиент прислал If-None-Match и checksum совпадает — 304, файл
    # не читаем
    if_none_match = req.headers.get("if-none-match")
    if if_none_match and if_none_match == etag:
        return Response(status_code=304, headers={"ETag": etag})

    # Без filename* браузер не переведет проценты обратно в буквы
    content_type, disposition = preview_type(attach.mimetype)
    headers = {
        "Content-Disposition": f"{disposition}; filename*=utf-8''{quote(attach.name, safe='')}",
        "Cache-Control": "private, max-age=86400, immutable",
        "ETag": etag,
    }
    # Заголовок перекрывает media_type и в ответах стратегий хранилищ
    if content_type:
        headers["Content-Type"] = content_type

    # Уменьшенная картинка (указаны размеры) — ресайз в памяти
    if (w or h) and attach.mimetype in RESIZABLE_MIMETYPES:
        attachment_content = await attach.read_content()
        if attachment_content is not None:
            try:
                width = w or h or 100
                height = h or w or 100
                attachment_content = await asyncio.to_thread(
                    resize_image,
                    attachment_content,
                    width,
                    height,
                    attach.mimetype,
                )
            except Exception as e:
                # Если ресайз не удался, возвращаем оригинал
                logger.warning(
                    "Resize image fails, return the original: %s", e
                )
        return Response(
            headers=headers,
            media_type=attach.mimetype,
            content=attachment_content,
        )

    # Оригинал из хранилища со стримингом — по кускам
    strategy = attach.storage_id and get_strategy(attach.storage_id.type)
    if strategy and strategy.supports_streaming:
        return await strategy.read_range(
            attach.storage_id, attach, headers, req.headers
        )

    # Оригинал из хранилища без стриминга — читаем целиком
    attachment_content = await attach.read_content()

    return Response(
        headers=headers,
        media_type=attach.mimetype,
        content=attachment_content,
    )


@router_private.get("/attachments/{attachment_id}/email")
async def attachment_email(req: Request, attachment_id: Id):
    """Письмо .eml для просмотра без скачивания: заголовки, тело, имена
    вложений. HTML письма санитизирует фронт."""
    env: Environment = req.app.state.env
    attach = await env.models.attachment.search_one(
        filter=[("id", "=", attachment_id)],
        fields=[
            "id",
            "res_model",
            "res_id",
            "name",
            "storage_file_url",
            "storage_file_id",
            "mimetype",
            "storage_id",
            "content",
        ],
    )
    if not attach:
        return JSONResponse(
            content={"error": "#NOT_FOUND"}, status_code=HTTP_404_NOT_FOUND
        )

    # Разбор письма — в потоке: большое письмо не держит остальные запросы
    return await asyncio.to_thread(parse_email, await attach.read_content())


# ── Cookie-based routes for binary content ──────────────
# Дублируют /attachments/{id} и /attachments/{id}/preview
# но авторизуются через HttpOnly cookie (cookie_token).
# Фронт может использовать <img src="/api/content/attachments/123/preview">
# без Authorization header — cookie отправится автоматически.
# помогает избежать js overhead и использовать браузер как контент менеджера
# с классическим механизмом кеширования


@router_content.get("/attachments/{attachment_id}/content")
async def attachment_content_cookie(req: Request, attachment_id: Id):
    """Скачать файл (авторизация через cookie)"""
    return await attachment_content(req, attachment_id)


@router_content.get("/attachments/{attachment_id}/content/preview")
async def attachment_preview_cookie(
    req: Request,
    attachment_id: Id,
    w: int | None = Query(None, ge=1, le=2000, description="Width"),
    h: int | None = Query(None, ge=1, le=2000, description="Height"),
):
    """Превью файла (авторизация через cookie)"""
    return await attachment_preview(req, attachment_id, w, h)


@router_content.get("/attachments/{attachment_id}/content/pdf")
async def attachment_pdf_cookie(req: Request, attachment_id: Id):
    """Документ Word/OpenDocument/RTF как PDF — просмотр во вкладке
    браузера (авторизация через cookie)."""
    env: Environment = req.app.state.env
    attach = await env.models.attachment.search_one(
        filter=[("id", "=", attachment_id)],
        fields=[
            "id",
            "res_model",
            "res_id",
            "name",
            "storage_file_url",
            "storage_file_id",
            "mimetype",
            "storage_id",
            "content",
        ],
    )
    if not attach:
        return JSONResponse(
            content={"error": "#NOT_FOUND"}, status_code=HTTP_404_NOT_FOUND
        )

    name = pathlib.PurePath(attach.name or "document")
    if name.suffix.lower() not in OFFICE_PDF_SUFFIXES:
        return JSONResponse(
            content={"error": "#UNSUPPORTED_TYPE"},
            status_code=HTTP_400_BAD_REQUEST,
        )

    content = await attach.read_content()
    # Ответ открыт во вкладке — ошибку показываем там же текстом
    try:
        pdf = await asyncio.to_thread(
            libreoffice.convert_to_pdf, content, name.suffix.lower()
        )
    except RuntimeError as e:
        return PlainTextResponse(
            f"Не удалось показать документ: {e}",
            status_code=HTTP_500_INTERNAL_SERVER_ERROR,
        )

    pdf_name = quote(name.with_suffix(".pdf").name, safe="")
    return Response(
        headers={
            "Content-Disposition": f"inline; filename*=utf-8''{pdf_name}",
            "Cache-Control": "private, max-age=86400, immutable",
        },
        media_type="application/pdf",
        content=pdf,
    )
