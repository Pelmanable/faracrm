# Copyright 2025 FARA CRM
# Report DOCX Designer — routes: field catalog and live preview

import json
from typing import TYPE_CHECKING, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from starlette.status import HTTP_400_BAD_REQUEST

from backend.base.crm.auth_token.app import AuthTokenApp
from backend.base.crm.report_docx.routers.reports import (
    error_response,
    file_response,
    require_template_admin,
)
from backend.base.system.schemas.base_schema import Id
from ..catalog import template_field_catalog

if TYPE_CHECKING:
    from backend.base.system.core.enviroment import Environment

router_private = APIRouter(
    tags=["Report DOCX Designer"],
    dependencies=[Depends(AuthTokenApp.verify_access)],
)


@router_private.post("/reports/preview")
async def preview_report(
    req: Request,
    template_id: Id,
    output_format: Literal["docx", "pdf"] | None = None,
    params: str = Query("{}", description="Report params as JSON object"),
):
    """
    Рендер переданного DOCX (несохранённая правка из редактора) с данными по
    настройкам шаблона — тот же путь, что у ReportTemplate.render_attachment,
    но байты берутся из запроса: тело — сам DOCX (не JSON и не base64),
    параметры отчёта — JSON в строке запроса. Разовый рендер, а не
    сохранение файла, поэтому без загрузки частями.

    Только администратору отчётов: здесь исполняется присланный клиентом
    шаблон (Jinja в песочнице, но это всё равно чужой код с данными записи).
    Данные записи и так читаются под сессией запроса — ACL, правила строк,
    приватные и ролевые поля в контекст не попадают.
    """
    require_template_admin(req)
    env: "Environment" = req.app.state.env
    try:
        report_params = json.loads(params)
    except ValueError:
        report_params = None
    if not isinstance(report_params, dict):
        return JSONResponse(
            status_code=HTTP_400_BAD_REQUEST,
            content={"error": "params must be a JSON object"},
        )
    template_bytes = await req.body()

    templates = env.models.report_template
    try:
        tmpl = await templates.get_template(template_id)
        report = await templates.render_bytes(
            tmpl, template_bytes, report_params, output_format
        )
    except Exception as e:
        return error_response(e)
    return file_response(report)


@router_private.get("/reports/templates/{template_id}/fields")
async def template_fields(req: Request, template_id: Id):
    """Каталог полей шаблона для конструктора — см. catalog.py. Только
    администратору отчётов, как и сам конструктор."""
    require_template_admin(req)
    try:
        data = await template_field_catalog(template_id)
    except Exception as e:
        return error_response(e)
    return {"data": data}
