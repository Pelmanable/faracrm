# Copyright 2025 FARA CRM
# Marketing module — application

from typing import TYPE_CHECKING

from backend.base.system.core.app import App
from backend.base.crm.security.acl_post_init_mixin import ACL
from backend.base.crm.security.utils import init_module_roles

if TYPE_CHECKING:
    from fastapi import FastAPI
    from backend.base.system.core.enviroment import Environment


class MarketingApp(App):
    """
    Маркетинг: ролики по расписанию в группы и каналы.

    - Ролик (marketing_video) хранится один раз, публикации ссылаются на него
    - Канал (marketing_channel) — «Через коннектор» (коннектор чата с флагом
      marketing: Telegram и MAX — сообщением, VK — сторис сообщества),
      группа от имени аккаунта Telegram (Telethon, вход по коду —
      routers/telegram.py), канал YouTube или аккаунт Instagram (OAuth,
      routers/oauth.py),
      канал Rutube (вход по паролю, routers/rutube.py); как уходит ролик,
      решает стратегия типа канала (strategies/)
    - Публикация (marketing_publication) — разовая или от правила, она же
      журнал; формат — пост или сторис (какие умеет площадка — kinds у
      стратегии)
    - Правило (marketing_rule) — раз в интервал следующее видео по кругу
    - Крон раз в минуту: правила → публикации → отправка
    """

    info = {
        "ui_menu": True,
        "ui_menu_name": "marketing",
        "name": "Marketing",
        "summary": "Scheduled video publishing to groups and channels",
        "author": "FARA CRM",
        "category": "Marketing",
        "version": "1.0.0.0",
        "license": "FARA CRM License v1.0",
        "post_init": True,
        "depends": ["security", "attachments", "chat", "cron"],
    }

    ROLE_ACL = {
        "marketing_user": {
            "marketing_video": ACL.FULL,
            "marketing_channel": ACL.FULL,
            "marketing_publication": ACL.FULL,
            "marketing_rule": ACL.FULL,
        },
    }

    async def post_init(self, app: "FastAPI"):
        env: "Environment" = app.state.env

        # Роль — ДО super().post_init(): он создаёт ACL из ROLE_ACL
        await init_module_roles(
            env,
            "marketing",
            [("marketing_user", "Маркетинг: пользователь")],
        )

        await super().post_init(app)

        await env.models.cron_job.create_or_update(
            env=env,
            name="Маркетинг: публикации по расписанию",
            model_name="marketing_publication",
            method_name="cron_publish_due",
            interval_number=1,
            interval_type="minutes",
            # Instagram обрабатывает видео до 5 минут на публикацию
            timeout=1800,
        )
