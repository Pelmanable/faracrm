import json
from types import SimpleNamespace

import pytest
import pytest_asyncio

from backend.base.crm.chat.models.chat_connector import ChatConnector
from tests.integration.chat.conftest import auth_headers

pytestmark = [pytest.mark.integration, pytest.mark.api]


@pytest_asyncio.fixture(autouse=True)
async def _security_init(clean_all_tables, db_service):
    from tests.conftest import _run_post_init_once

    await _run_post_init_once()


@pytest_asyncio.fixture
async def channels():
    result = {}
    for name, kind, active in (
        ("vk", "vk", True),
        ("email", "email", True),
        ("inactive", "vk", False),
    ):
        result[name] = await ChatConnector.create(
            ChatConnector(
                name=name,
                type=kind,
                active=active,
                access_token="connector-secret",
                lead_distribution=False,
            )
        )
    return SimpleNamespace(**result)


async def _settings(client, person):
    response = await client.get("/chat/signatures", headers=person.headers)
    assert response.status_code == 200, response.text
    return response.json()


async def _save(
    client,
    person,
    connector_id,
    body,
    *,
    auto_insert=False,
    revision=None,
    **extra,
):
    if revision is None:
        revision = (await _settings(client, person))["revision"]
    return await client.put(
        f"/chat/signatures/{connector_id}",
        headers=person.headers,
        json={
            "body": body,
            "auto_insert": auto_insert,
            "revision": revision,
            **extra,
        },
    )


async def test_empty_settings_and_connector_fields(client, staff, channels):
    settings = await _settings(client, staff.alice)
    assert settings["data"] == []
    assert len(settings["revision"]) == 64
    assert {item["id"] for item in settings["connectors"]} >= {
        channels.vk,
        channels.email,
    }
    assert all(
        set(item) == {"id", "name", "type", "active"}
        for item in settings["connectors"]
    )
    assert "connector-secret" not in json.dumps(settings)


async def test_signature_is_saved_to_user(client, db_pool, staff, channels):
    response = await _save(
        client,
        staff.alice,
        channels.vk,
        " Анна\nОтдел продаж ",
        auto_insert=True,
    )
    assert response.status_code == 200, response.text
    expected = [
        {
            "connector_id": channels.vk,
            "body": "Анна\nОтдел продаж",
            "format": "text",
            "auto_insert": True,
        }
    ]
    assert response.json()["data"] == expected
    stored = await db_pool.fetchval(
        "SELECT chat_signatures FROM users WHERE id = $1", staff.alice.id
    )
    assert json.loads(stored) == expected


async def test_employee_settings_are_independent(client, staff, channels):
    response = await _save(client, staff.alice, channels.vk, "Анна")
    assert response.status_code == 200, response.text
    assert (await _settings(client, staff.bob))["data"] == []


async def test_saving_another_connector_preserves_existing_signature(
    client, staff, channels
):
    assert (
        await _save(client, staff.alice, channels.vk, "Анна")
    ).status_code == 200
    assert (
        await _save(client, staff.alice, channels.email, "<p>Anna</p>")
    ).status_code == 200
    settings = (await _settings(client, staff.alice))["data"]
    assert {item["connector_id"] for item in settings} == {
        channels.vk,
        channels.email,
    }
    assert {item["format"] for item in settings} == {"text", "html"}


async def test_empty_body_removes_signature(client, staff, channels):
    assert (
        await _save(client, staff.alice, channels.vk, "Анна")
    ).status_code == 200
    response = await _save(client, staff.alice, channels.vk, "  ")
    assert response.status_code == 200, response.text
    assert response.json()["data"] == []


async def test_stale_revision_does_not_overwrite_settings(
    client, staff, channels
):
    revision = (await _settings(client, staff.alice))["revision"]
    assert (
        await _save(
            client, staff.alice, channels.vk, "Анна", revision=revision
        )
    ).status_code == 200
    response = await _save(
        client, staff.alice, channels.email, "<p>Anna</p>", revision=revision
    )
    assert response.status_code == 409
    assert [
        item["body"] for item in (await _settings(client, staff.alice))["data"]
    ] == ["Анна"]


@pytest.mark.parametrize("channel", ["inactive", "unknown"])
async def test_unavailable_connector_is_rejected(
    client, staff, channels, channel
):
    connector_id = channels.inactive if channel == "inactive" else 999999
    assert (
        await _save(client, staff.alice, connector_id, "Анна")
    ).status_code == 400


async def test_cannot_select_another_user(client, staff, channels):
    response = await _save(
        client, staff.alice, channels.vk, "Анна", user_id=staff.bob.id
    )
    assert response.status_code == 422


async def test_plain_signature_length_is_enforced(client, staff, channels):
    assert (
        await _save(client, staff.alice, channels.vk, "x" * 2001)
    ).status_code == 400


async def test_email_signature_is_sanitized(client, staff, channels):
    response = await _save(
        client,
        staff.alice,
        channels.email,
        '<p onclick="x()">Анна</p><script>x()</script>',
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"][0]["body"] == "<p>Анна</p>"


async def test_portal_user_is_rejected(client, user_factory):
    user = await user_factory(login="portal", role_ids={"selected": []})
    response = await client.get(
        "/chat/signatures", headers=await auth_headers(user.id)
    )
    assert response.status_code == 403


async def test_authentication_is_required(client):
    response = await client.get("/chat/signatures")
    assert response.status_code in (401, 403)
