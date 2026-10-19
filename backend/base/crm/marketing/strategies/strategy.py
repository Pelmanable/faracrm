# Copyright 2025 FARA CRM
# Marketing module — publish strategy base

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import httpx
    from backend.base.crm.attachments.models.attachments import Attachment
    from ..models.marketing_channel import MarketingChannel
    from ..models.marketing_publication import MarketingPublication
    from ..models.marketing_video import MarketingVideo


class PublishStrategyBase(ABC):
    """Как ролик уходит на площадку канала (тип канала → стратегия)."""

    # Форматы публикации, которые умеет площадка (post, story). Чужой
    # формат публикация не пройдёт — проверка в channel.send_video, до
    # обращения к площадке.
    kinds: frozenset[str] = frozenset({"post"})

    @abstractmethod
    async def publish(
        self,
        channel: "MarketingChannel",
        publication: "MarketingPublication",
        video: "MarketingVideo",
        attachment: "Attachment",
    ) -> str | None:
        """Опубликовать ролик; вернуть ссылку, если площадка её даёт.

        attachment — файл ролика с уже прочитанным content; формат —
        publication.kind; временная ссылка на файл для площадок, которые
        качают сами, — publication.open_media_link().
        """

    @staticmethod
    def _raise_for_error(response: "httpx.Response") -> None:
        """Ошибка API площадки — текстом в публикацию или на страницу."""
        if response.is_success:
            return
        raise ValueError(
            f"{response.request.url.host} {response.status_code}: "
            f"{response.text[:500]}"
        )
