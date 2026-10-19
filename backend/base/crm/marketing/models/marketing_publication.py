# Copyright 2025 FARA CRM
# Marketing module — publication

import logging
import secrets
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from backend.base.system.core.enviroment import env
from backend.base.system.dotorm.dotorm.decorators import hybridmethod
from backend.base.system.dotorm.dotorm.fields import (
    Char,
    Datetime,
    Integer,
    Many2one,
    Selection,
    Text,
)
from backend.base.system.dotorm.dotorm.model import DotModel

if TYPE_CHECKING:
    from .marketing_channel import MarketingChannel
    from .marketing_rule import MarketingRule
    from .marketing_video import MarketingVideo

logger = logging.getLogger(__name__)


class MarketingPublication(DotModel):
    """Одна публикация ролика в канал. Она же журнал: что и когда выходило.

    Создаётся вручную или правилом (marketing_rule). Выпускает крон
    cron_publish_due; повтор после ошибки — вернуть статус «Запланирована».
    """

    __table__ = "marketing_publication"

    id: int = Integer(primary_key=True)
    video_id: "MarketingVideo" = Many2one(
        lambda: env.models.marketing_video,
        required=True,
        string="Video",
    )
    channel_id: "MarketingChannel" = Many2one(
        lambda: env.models.marketing_channel,
        required=True,
        string="Channel",
    )
    rule_id: "MarketingRule | None" = Many2one(
        lambda: env.models.marketing_rule,
        ondelete="set null",
        string="Rule",
        help="Правило, создавшее публикацию; пусто — создана вручную",
    )
    kind: str = Selection(
        options=[
            ("post", "Пост"),
            ("story", "Сторис"),
        ],
        default="post",
        required=True,
        string="Format",
        help="Сторис — только где площадка их умеет "
        "(Instagram, Telegram-аккаунт)",
    )
    date_planned: datetime = Datetime(required=True, string="Planned")
    state: str = Selection(
        options=[
            ("planned", "Запланирована"),
            ("done", "Опубликована"),
            ("failed", "Ошибка"),
        ],
        default="planned",
        string="State",
    )
    date_done: datetime | None = Datetime(string="Published")
    url: str | None = Char(
        string="Link",
        help="Ссылка на результат, если площадка её даёт",
    )
    error: str | None = Text(string="Error")
    # Временная ссылка на файл ролика для площадок, которые качают его сами
    # (Instagram, Rutube) — routers/media.py. Своя у каждой публикации:
    # Rutube качает уже после ответа, и ссылку другой публикации того же
    # ролика закрывать нельзя.
    media_token: str | None = Char(private=True, string="Media link token")

    @hybridmethod
    async def cron_publish_due(self) -> None:
        """Крон-задача: правила → публикации, затем выпуск подошедших.

        Крон не берёт задачу, пока прошлый запуск running, поэтому одну
        публикацию два воркера не выпустят.
        """
        await env.models.marketing_rule.plan_due()

        due = await self.search(
            filter=[
                ("state", "=", "planned"),
                ("date_planned", "<=", datetime.now(timezone.utc)),
            ],
            fields=["id", "video_id", "channel_id", "kind"],
            order="ASC",
            sort="date_planned",
        )
        for publication in due:
            await publication.publish()

    async def publish(self) -> None:
        """Отправить ролик в канал; итог — статус done или failed с ошибкой."""
        video = await env.models.marketing_video.search_one(
            filter=[("id", "=", self.video_id.id)],
        )
        channel = await env.models.marketing_channel.search_one(
            filter=[("id", "=", self.channel_id.id)],
        )
        try:
            url = await channel.send_video(self, video)
        except Exception as e:
            logger.exception("Marketing publication %s failed", self.id)
            await self.update(
                MarketingPublication(state="failed", error=str(e))
            )
            return

        await self.update(
            MarketingPublication(
                state="done",
                date_done=datetime.now(timezone.utc),
                url=url,
                error=None,
            )
        )

    async def open_media_link(self) -> str:
        """Открыть временную ссылку на файл ролика; вернуть адрес."""
        self.media_token = secrets.token_urlsafe(32)
        await self.update(MarketingPublication(media_token=self.media_token))
        api_url = await env.models.system_settings.get_api_url()
        return f"{api_url.rstrip('/')}/marketing/media/{self.media_token}"

    async def close_media_link(self) -> None:
        """Закрыть временную ссылку на файл ролика."""
        await self.update(MarketingPublication(media_token=None))
