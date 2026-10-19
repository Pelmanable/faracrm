# Copyright 2025 FARA CRM
# Marketing module — stories of a VK community

from typing import TYPE_CHECKING

import httpx

from .strategy import PublishStrategyBase

if TYPE_CHECKING:
    from backend.base.crm.attachments.models.attachments import Attachment
    from ..models.marketing_channel import MarketingChannel
    from ..models.marketing_publication import MarketingPublication
    from ..models.marketing_video import MarketingVideo


class VkPublishStrategy(PublishStrategyBase):
    """Сторис сообщества ВКонтакте через коннектор чата VK.

    Канал «Через коннектор» с коннектором VK приходит сюда, а не в
    универсальную отправку сообщением (MarketingChannel.publish_strategy).
    Только сторис: видео грузит лишь video.save с ключом пользователя и
    правом video, а его VK выдаёт в исключительных случаях через
    devsupport@corp.vk.com. Сторис — ключ сообщества с правом «Истории»,
    тот же, что у коннектора чата VK. Вызовы API — через _call стратегии
    коннектора: там токен, версия API и разбор ошибок VK.
    """

    kinds = frozenset({"story"})

    # Загрузка файла — минуты, а не секунды
    UPLOAD_TIMEOUT = 300.0

    async def publish(
        self,
        channel: "MarketingChannel",
        publication: "MarketingPublication",
        video: "MarketingVideo",
        attachment: "Attachment",
    ) -> str:
        # Коннектор загружен вместе с каналом — со всеми своими полями
        connector = channel.connector_id
        api = connector.strategy

        # 1. Адрес загрузки; с ключом сообщества история уходит в сообщество
        server = await api._call(
            connector, "stories.getVideoUploadServer", {"add_to_news": 1}
        )

        # 2. Сам файл
        async with httpx.AsyncClient(timeout=self.UPLOAD_TIMEOUT) as client:
            response = await client.post(
                server["upload_url"],
                files={
                    "video_file": (
                        attachment.name,
                        attachment.content,
                        attachment.mimetype or "video/mp4",
                    )
                },
            )
        self._raise_for_error(response)
        result = response.json()
        if "response" not in result:
            raise ValueError(f"VK загрузка истории: {result}")

        # 3. Сохранить историю
        saved = await api._call(
            connector,
            "stories.save",
            {"upload_results": result["response"]["upload_result"]},
        )
        story = saved["items"][0]
        return f"https://vk.com/story{story['owner_id']}_{story['id']}"
