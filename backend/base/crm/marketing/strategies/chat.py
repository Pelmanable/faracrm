# Copyright 2025 FARA CRM
# Marketing module — publish through a chat connector

from typing import TYPE_CHECKING

from backend.base.system.core.enviroment import env
from .strategy import PublishStrategyBase

if TYPE_CHECKING:
    from backend.base.crm.attachments.models.attachments import Attachment
    from ..models.marketing_channel import MarketingChannel
    from ..models.marketing_publication import MarketingPublication
    from ..models.marketing_video import MarketingVideo


class ChatPublishStrategy(PublishStrategyBase):
    """Через коннектор чата: подпись сообщением, затем файл.

    Универсальная отправка для коннекторов с флагом marketing без своей
    стратегии (Telegram, MAX): общие методы стратегии чата
    (chat_send_message, chat_send_message_binary), как рассылка отчётов в
    report_template.
    """

    async def publish(
        self,
        channel: "MarketingChannel",
        publication: "MarketingPublication",
        video: "MarketingVideo",
        attachment: "Attachment",
    ) -> None:
        if not channel.connector_id:
            raise ValueError("У канала не выбран коннектор")

        # Связи вложенной записи приходят числом (outbox_account_id) —
        # коннектор дочитываем
        connector = await env.models.chat_connector.search_one(
            filter=[("id", "=", channel.connector_id.id)],
            fields_nested={
                "outbox_account_id": {"fields": ["id", "external_id"]},
            },
        )
        strategy = connector.strategy
        if video.caption:
            await strategy.chat_send_message(
                connector,
                connector.outbox_account_id,
                video.caption,
                chat_id=channel.chat_id,
            )
        await strategy.chat_send_message_binary(
            connector, connector.outbox_account_id, channel.chat_id, attachment
        )
