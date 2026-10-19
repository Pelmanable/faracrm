# Copyright 2025 FARA CRM
# Marketing module — publish strategies by channel type

from .strategy import PublishStrategyBase
from .chat import ChatPublishStrategy
from .youtube import YoutubePublishStrategy
from .instagram import InstagramPublishStrategy
from .telegram_account import TelegramAccountPublishStrategy
from .rutube import RutubePublishStrategy
from .vk import VkPublishStrategy

# Все стратегии живут в самом модуле — реестр с регистрацией не нужен
STRATEGIES: dict[str, PublishStrategyBase] = {
    "chat": ChatPublishStrategy(),
    "telegram_account": TelegramAccountPublishStrategy(),
    "youtube": YoutubePublishStrategy(),
    "rutube": RutubePublishStrategy(),
    "instagram": InstagramPublishStrategy(),
}

# Канал «Через коннектор»: своя стратегия по типу коннектора, остальные
# коннекторы — универсальной отправкой сообщением (STRATEGIES["chat"])
CONNECTOR_STRATEGIES: dict[str, PublishStrategyBase] = {
    "vk": VkPublishStrategy(),
}

__all__ = [
    "PublishStrategyBase",
    "ChatPublishStrategy",
    "TelegramAccountPublishStrategy",
    "VkPublishStrategy",
    "YoutubePublishStrategy",
    "RutubePublishStrategy",
    "InstagramPublishStrategy",
    "STRATEGIES",
    "CONNECTOR_STRATEGIES",
]
