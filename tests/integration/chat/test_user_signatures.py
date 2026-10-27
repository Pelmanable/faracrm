import pytest
import pytest_asyncio

from tests.conftest import auto

pytestmark = [pytest.mark.integration, pytest.mark.api]


@pytest_asyncio.fixture(autouse=True)
async def _security_init(clean_all_tables, db_service):
    from tests.conftest import _run_post_init_once

    await _run_post_init_once()


async def _read(client, person):
    response = await client.post(
        auto(f"/users/{person.id}"),
        headers=person.headers,
        json={"fields": ["chat_signatures"]},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["chat_signatures"]


async def _write(client, person, settings, target=None):
    target = target or person
    return await client.put(
        auto(f"/users/{target.id}"),
        headers=person.headers,
        json={
            "name": "Alice" if target.id == person.id else "Bob",
            "chat_signatures": settings,
        },
    )


async def test_employee_saves_connector_signatures_through_user_crud(
    client, staff
):
    settings = [
        {
            "connector_id": 12,
            "body": "Анна\nОтдел продаж",
            "format": "text",
            "auto_insert": True,
        },
        {
            "connector_id": 25,
            "body": "<p><strong>Анна</strong></p>",
            "format": "html",
            "auto_insert": False,
        },
    ]
    response = await _write(client, staff.alice, settings)
    assert response.status_code == 200, response.text
    assert await _read(client, staff.alice) == settings
    assert await _read(client, staff.bob) is None


async def test_employee_cannot_change_another_users_signature(client, staff):
    response = await _write(client, staff.alice, [], target=staff.bob)
    assert response.status_code == 403, response.text
    assert await _read(client, staff.bob) is None


@pytest.mark.parametrize("empty", [[], None])
async def test_employee_can_clear_saved_signatures(client, staff, empty):
    response = await _write(
        client,
        staff.alice,
        [
            {
                "connector_id": 12,
                "body": "Анна",
                "format": "text",
                "auto_insert": True,
            },
        ],
    )
    assert response.status_code == 200, response.text
    response = await _write(client, staff.alice, empty)
    assert response.status_code == 200, response.text
    assert await _read(client, staff.alice) == empty
