# Copyright 2025 FARA CRM
# Marketing module — video

from typing import TYPE_CHECKING

from backend.base.crm.attachments.models.attachments import Attachment
from backend.base.system.core.enviroment import env
from backend.base.system.dotorm.dotorm.fields import (
    Char,
    Integer,
    One2many,
    PolymorphicMany2one,
    Text,
)
from backend.base.system.dotorm.dotorm.model import DotModel

if TYPE_CHECKING:
    from .marketing_publication import MarketingPublication


class MarketingVideo(DotModel):
    """Ролик. Хранится один раз — повторные публикации ссылаются на него."""

    __table__ = "marketing_video"

    id: int = Integer(primary_key=True)
    name: str = Char(required=True, string="Name")
    file: Attachment | None = PolymorphicMany2one(
        relation_table=Attachment,
        required=True,
        string="Video",
    )
    caption: str | None = Text(
        string="Caption",
        help="Подпись: уходит сообщением перед видео",
    )
    # Публикация = ролик в одном канале, поэтому здесь статус ролика по
    # каждому каналу: где вышел, где ошибка
    publication_ids: list["MarketingPublication"] = One2many(
        store=False,
        relation_table=lambda: env.models.marketing_publication,
        relation_table_field="video_id",
        string="Publications",
    )
