# Copyright 2025 FARA CRM
# Unit tests for SessionCache — чистая логика в памяти.
"""
Кэш сессий воркера.

Свойства, ради которых всё это существует:

1. Запись находится и по токену, и по куке; ротация токена не оставляет
   старых индексов.
2. Отзыв (logout, «завершить все», истечение) — запись уходит из всех
   индексов и помечается revoked.
3. Смена ролей — не отзыв: записи пользователя просто выкидываются, чтобы
   следующий запрос пересобрал их из БД со свежими ролями.
"""

from datetime import datetime, timedelta, timezone

from backend.base.crm.auth_token.session_cache import (
    CachedSession,
    SessionCache,
)

ALICE = 1
BOB = 2


def make(session_id: int, user_id: int = ALICE, token: str | None = None):
    now = datetime.now(timezone.utc)
    return CachedSession(
        session_id=session_id,
        user_id=user_id,
        is_admin=False,
        user_name="user",
        lang_id=None,
        lang_code=None,
        cookie_token=f"cookie-{session_id}",
        token=token or f"token-{session_id}",
        expired_datetime=now + timedelta(hours=1),
        ttl=3600,
        create_datetime=now,
    )


def indexed(cache: SessionCache, cached: CachedSession) -> bool:
    """Есть ли запись хоть в одном индексе."""
    return (
        cached.token in cache._by_token
        or cached.cookie_token in cache._by_cookie
        or cached.session_id in cache._by_session_id
        or cached.session_id in cache._by_user_id.get(cached.user_id, set())
    )


class TestLookup:
    async def test_put_then_get_by_token_and_cookie(self):
        cache = SessionCache()
        cached = make(10)
        await cache.put(cached)

        assert await cache.get_by_token("token-10") is cached
        assert await cache.get_by_cookie("cookie-10") is cached
        assert cache.size() == 1

    async def test_unknown_token_is_a_miss(self):
        cache = SessionCache()
        await cache.put(make(10))

        assert await cache.get_by_token("nope") is None
        assert await cache.get_by_cookie("nope") is None

    async def test_new_token_for_same_session_drops_old_indexes(self):
        """Ротация токена: старый токен и кука больше не находят сессию."""
        cache = SessionCache()
        await cache.put(make(10, token="old"))
        rotated = make(10, token="new")
        rotated.cookie_token = "cookie-new"
        await cache.put(rotated)

        assert await cache.get_by_token("old") is None
        assert await cache.get_by_cookie("cookie-10") is None
        assert await cache.get_by_token("new") is rotated
        assert cache.size() == 1


class TestInvalidation:
    async def test_revoke_drops_and_marks_the_entry(self):
        cache = SessionCache()
        cached = make(10)
        await cache.put(cached)

        assert await cache.revoke(10) == "token-10"
        assert cached.revoked
        assert not indexed(cache, cached)
        assert await cache.get_by_token("token-10") is None

    async def test_revoke_unknown_session_is_noop(self):
        cache = SessionCache()
        await cache.put(make(10))

        assert await cache.revoke(999) is None
        assert cache.size() == 1

    async def test_roles_change_drops_user_without_revoking(self):
        cache = SessionCache()
        laptop, phone, other = make(10), make(11), make(20, user_id=BOB)
        for cached in (laptop, phone, other):
            await cache.put(cached)

        tokens = await cache.invalidate_user(ALICE)

        assert sorted(tokens) == ["token-10", "token-11"]
        assert not laptop.revoked and not phone.revoked
        assert not indexed(cache, laptop) and not indexed(cache, phone)
        assert await cache.get_by_token("token-20") is other

    async def test_drop_by_token_clears_all_indexes(self):
        cache = SessionCache()
        cached = make(10)
        await cache.put(cached)

        await cache.drop_by_token("token-10")
        await cache.drop_by_token("token-10")  # повтор — без ошибок

        assert not indexed(cache, cached)

    async def test_clear_empties_cache(self):
        cache = SessionCache()
        for session_id in (10, 11, 20):
            await cache.put(make(session_id))

        await cache.clear()

        assert cache.size() == 0
        assert await cache.get_by_token("token-10") is None
