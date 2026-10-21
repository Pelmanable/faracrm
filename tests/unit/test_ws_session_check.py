# Copyright 2025 FARA CRM
# Unit tests: проверка сессии открытого сокета — без БД и сети.
"""
Сокет чата живёт часами, а сессию проверяют только при подключении. Чтобы
отозванная или истёкшая сессия не держала открытым чужое приложение (и не
получала новые сообщения), на каждом пинге (раз в 30 с) ws.py зовёт
ConnectionManager.check_session — ту же проверку, что у HTTP-запроса (кэш
или БД). Сессии нет — сокет закрывается кодом 1008, фронт выходит сам.
"""

import pytest
from starlette.websockets import WebSocketState

from backend.base.crm.auth_token.app import AuthTokenApp
from backend.base.crm.chat.websocket.manager import ConnectionManager
from backend.base.crm.security.exceptions.AuthException import (
    SessionExpired,
    SessionNotExist,
)


class FakeWS:
    def __init__(self):
        self.closed_with: int | None = None
        self.client_state = WebSocketState.CONNECTED

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed_with = code
        self.client_state = WebSocketState.DISCONNECTED


@pytest.fixture
def manager() -> ConnectionManager:
    async def resolve(chat_id: int) -> list[int]:
        return []

    return ConnectionManager(resolve)


def session_check(monkeypatch, error: type[Exception] | None = None):
    """Подменить AuthTokenApp.check_session: сессия есть или ошибка."""

    async def check(env, token, cookie_token):
        if error is not None:
            raise error()
        return object()

    monkeypatch.setattr(AuthTokenApp, "check_session", check)


class TestCheckSession:
    async def test_valid_session_keeps_socket(self, manager, monkeypatch):
        session_check(monkeypatch)
        ws = FakeWS()

        assert await manager.check_session(ws, None, "t", "c") is True
        assert ws.closed_with is None

    @pytest.mark.parametrize("error", [SessionNotExist, SessionExpired])
    async def test_dead_session_closes_with_1008(
        self, manager, monkeypatch, error
    ):
        session_check(monkeypatch, error)
        ws = FakeWS()

        assert await manager.check_session(ws, None, "t", "c") is False
        assert ws.closed_with == 1008

    async def test_infrastructure_error_is_not_a_logout(
        self, manager, monkeypatch
    ):
        """Сбой БД — не «сессии нет»: 1008 выкинул бы пользователя. Ошибка
        уходит наружу, ws.py её логирует, клиент переподключится."""
        session_check(monkeypatch, RuntimeError)
        ws = FakeWS()

        with pytest.raises(RuntimeError):
            await manager.check_session(ws, None, "t", "c")
        assert ws.closed_with is None
