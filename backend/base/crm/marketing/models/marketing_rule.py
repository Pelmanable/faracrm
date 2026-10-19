# Copyright 2025 FARA CRM
# Marketing module — repeat rule

from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from backend.base.system.core.enviroment import env
from backend.base.system.dotorm.dotorm.decorators import hybridmethod
from backend.base.system.dotorm.dotorm.fields import (
    Boolean,
    Char,
    Datetime,
    Integer,
    Many2many,
    Many2one,
    Selection,
)
from backend.base.system.dotorm.dotorm.model import DotModel

if TYPE_CHECKING:
    from .marketing_channel import MarketingChannel
    from .marketing_video import MarketingVideo

INTERVALS = {
    "hours": timedelta(hours=1),
    "days": timedelta(days=1),
    "weeks": timedelta(weeks=1),
}


class MarketingRule(DotModel):
    """Повтор: раз в интервал — следующее видео из набора во все каналы.

    Видео идут по кругу в порядке id. Пропущенные запуски (сервер был
    выключен) не догоняются: date_next сдвигается до ближайшего будущего.
    """

    __table__ = "marketing_rule"

    id: int = Integer(primary_key=True)
    name: str = Char(required=True, string="Name")
    active: bool = Boolean(default=True)
    video_ids: list["MarketingVideo"] = Many2many(
        lambda: env.models.marketing_video,
        store=False,
        string="Videos",
        many2many_table="marketing_rule_video_many2many",
        column1="video_id",
        column2="rule_id",
        default=[],
    )
    channel_ids: list["MarketingChannel"] = Many2many(
        lambda: env.models.marketing_channel,
        store=False,
        string="Channels",
        many2many_table="marketing_rule_channel_many2many",
        column1="channel_id",
        column2="rule_id",
        default=[],
    )
    kind: str = Selection(
        options=[
            ("post", "Пост"),
            ("story", "Сторис"),
        ],
        default="post",
        required=True,
        string="Format",
        help="Формат публикаций правила",
    )
    interval_number: int = Integer(default=1, required=True, string="Every")
    interval_type: str = Selection(
        options=[
            ("hours", "Часов"),
            ("days", "Дней"),
            ("weeks", "Недель"),
        ],
        default="days",
        required=True,
        string="Interval",
    )
    date_next: datetime = Datetime(
        required=True,
        string="Next run",
        help="Первый запуск; дальше сдвигается на интервал",
    )
    last_video_id: "MarketingVideo | None" = Many2one(
        lambda: env.models.marketing_video,
        ondelete="set null",
        string="Last video",
        help="Последнее выпущенное видео — следующим пойдёт идущее за ним",
    )

    @hybridmethod
    async def plan_due(self) -> None:
        """Правила, у которых подошло время, создают публикации."""
        now = datetime.now(timezone.utc)
        rules = await self.search(
            filter=[("active", "=", True), ("date_next", "<=", now)],
            fields=[
                "id",
                "video_ids",
                "channel_ids",
                "kind",
                "interval_number",
                "interval_type",
                "date_next",
                "last_video_id",
            ],
        )
        for rule in rules:
            await rule.plan(now)

    async def plan(self, now: datetime) -> None:
        """Следующее видео — в публикацию на каждый канал, date_next — вперёд."""
        video = self.next_video()
        if video:
            for channel in self.channel_ids:
                await env.models.marketing_publication.create(
                    env.models.marketing_publication(
                        video_id=video,
                        channel_id=channel,
                        rule_id=self,
                        kind=self.kind,
                        date_planned=now,
                    )
                )

        # interval_number 0 зациклил бы сдвиг — шаг не меньше одного
        step = INTERVALS[self.interval_type] * max(self.interval_number, 1)
        date_next = self.date_next
        while date_next <= now:
            date_next += step

        await self.update(
            MarketingRule(date_next=date_next, last_video_id=video)
        )

    def next_video(self) -> "MarketingVideo | None":
        """Видео после последнего выпущенного, после последнего — первое."""
        videos = sorted(self.video_ids, key=lambda video: video.id)
        last_id = self.last_video_id.id if self.last_video_id else 0
        for video in videos:
            if video.id > last_id:
                return video
        return videos[0] if videos else None
