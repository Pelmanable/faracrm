"""
Импорт из Excel: файл загружается частями, разбор и импорт читают его по
одному upload_id; после успешного импорта загрузка удаляется.

Run: pytest tests/integration/excel/test_excel_import.py -v -m integration
"""

import io

import pytest
from openpyxl import Workbook

pytestmark = [pytest.mark.integration, pytest.mark.api]

from backend.base.crm.attachments.models.attachments_upload import (
    AttachmentUpload,
)
from backend.base.crm.partners.models.partners import Partner
from tests.integration.attachments.test_chunked_upload import upload_bytes

NAMES = ["Импорт Альфа", "Импорт Бета"]


def xlsx(rows: list[list]) -> bytes:
    """Книга с одним листом: первая строка — заголовки."""
    workbook = Workbook()
    for row in rows:
        workbook.active.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


class TestExcelImport:
    async def test_preview_and_import(self, authenticated_client, filestore):
        client, _, _ = authenticated_client
        upload_id = await upload_bytes(
            client, xlsx([["name"], *([name] for name in NAMES)])
        )

        r = await client.post(
            "/excel/partners/preview", json={"upload_id": upload_id}
        )

        assert r.status_code == 200, r.text
        preview = r.json()
        assert preview["rows_total"] == len(NAMES)
        [column] = preview["columns"]
        assert (column["header"], column["field"]) == ("name", "name")

        r = await client.post(
            "/excel/partners/import",
            json={"upload_id": upload_id, "mapping": {"0": "name"}},
        )

        assert r.status_code == 200, r.text
        assert r.json() == {"created": len(NAMES), "errors": []}
        partners = await Partner.search(
            fields=["name"], filter=[("name", "in", NAMES)]
        )
        assert sorted(p.name for p in partners) == sorted(NAMES)
        # Импорт прошёл — загрузка не нужна
        assert not await AttachmentUpload.search(fields=["id"])
        assert not (filestore / ".uploads" / str(upload_id)).exists()

    async def test_failed_import_keeps_upload(
        self, authenticated_client, filestore
    ):
        """Ошибка сопоставления — файл остаётся: поправить и повторить."""
        client, _, _ = authenticated_client
        upload_id = await upload_bytes(client, xlsx([["name"], ["Гамма"]]))

        r = await client.post(
            "/excel/partners/import",
            json={"upload_id": upload_id, "mapping": {"0": "no_such_field"}},
        )

        assert r.status_code == 400
        left = await AttachmentUpload.search(fields=["id"])
        assert [u.id for u in left] == [upload_id]

    async def test_unknown_upload(self, authenticated_client, filestore):
        client, _, _ = authenticated_client

        r = await client.post(
            "/excel/partners/preview", json={"upload_id": 999}
        )

        assert r.status_code == 400
        assert r.json()["content"] == "UPLOAD_NOT_FOUND"
