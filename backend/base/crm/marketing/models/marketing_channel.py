# Copyright 2025 FARA CRM
# Marketing module — channel

from datetime import datetime
from typing import TYPE_CHECKING

from backend.base.system.core.enviroment import env
from backend.base.system.dotorm.dotorm.fields import (
    Boolean,
    Char,
    Datetime,
    Integer,
    Many2one,
    Selection,
    Text,
)
from backend.base.system.dotorm.dotorm.model import DotModel
from ..strategies import CONNECTOR_STRATEGIES, STRATEGIES

if TYPE_CHECKING:
    from backend.base.crm.chat.models.chat_connector import ChatConnector
    from ..strategies import PublishStrategyBase
    from .marketing_publication import MarketingPublication
    from .marketing_video import MarketingVideo


class MarketingChannel(DotModel):
    """Куда публикуем. Тип канала выбирает стратегию (strategies/):

    - chat — «Через коннектор»: коннектор чата с флагом marketing; стратегию
      выбирает тип коннектора (publish_strategy): VK — сторис сообщества,
      Telegram и MAX — видео-сообщением в чат
    - telegram_account — группа или канал от имени аккаунта Telegram
      (сторис; вход по коду — routers/telegram.py)
    - youtube — канал YouTube, подключается по OAuth (routers/oauth.py)
    - rutube — канал Rutube, вход по логину и паролю (routers/rutube.py)
    - instagram — профессиональный аккаунт Instagram, тоже по OAuth

    Поля подключения общие, как access_token/refresh_token у chat_connector:
    YouTube хранит refresh_token, Instagram — access_token со сроком,
    Telegram-аккаунт — сессию, Rutube — токен в access_token.
    """

    __table__ = "marketing_channel"

    id: int = Integer(primary_key=True)
    name: str = Char(required=True, string="Name")
    type: str = Selection(
        options=[
            ("chat", "Через коннектор"),
            ("telegram_account", "Telegram (аккаунт)"),
            ("youtube", "YouTube"),
            ("rutube", "Rutube"),
            ("instagram", "Instagram"),
        ],
        default="chat",
        required=True,
        string="Type",
    )

    # chat — коннектор; chat, telegram_account — id группы
    connector_id: "ChatConnector | None" = Many2one(
        lambda: env.models.chat_connector,
        string="Connector",
        help="Коннектор чата с флагом «Поддерживается в маркетинге»: "
        "Telegram, MAX или VK",
    )
    chat_id: str | None = Char(
        string="Chat ID",
        help="Id группы или канала: у Telegram вида -100… или @username",
    )

    # Подключение (telegram_account, youtube, instagram). client_secret
    # вводит администратор — role_read; токены, сессию и state пишет и
    # читает только сервер — private.
    client_id: str | None = Char(
        string="Client ID",
        help="Telegram: api_id; Google: OAuth-клиент «Веб-приложение»; "
        "Instagram: Instagram App ID",
    )
    client_secret: str | None = Char(
        role_read="system_admin",
        string="Client Secret",
    )
    refresh_token: str | None = Text(private=True, string="Refresh Token")
    access_token: str | None = Text(private=True, string="Access Token")
    access_token_expires: datetime | None = Datetime(
        string="Access Token expires"
    )
    external_account_id: str | None = Char(
        string="Account ID",
        help="Id аккаунта на площадке — приходит при подключении",
    )
    oauth_state: str | None = Char(private=True, string="OAuth state")
    authorized: bool = Boolean(default=False, string="Authorized")
    proxy_url: str | None = Char(
        string="Proxy",
        help="Прокси для запросов к площадке, напр. http://user:pass@host:port"
        " — если сервер её не видит напрямую",
    )

    async def send_video(
        self, publication: "MarketingPublication", video: "MarketingVideo"
    ) -> str | None:
        """Опубликовать ролик стратегией канала; вернуть ссылку."""
        strategy = self.publish_strategy()
        if publication.kind not in strategy.kinds:
            raise ValueError(
                "Этот формат публикации в канале такого типа не поддерживается"
            )

        attachment = await env.models.attachment.search_one(
            filter=[("id", "=", video.file.id)],
        )
        await attachment.read_content()
        return await strategy.publish(self, publication, video, attachment)

    def publish_strategy(self) -> "PublishStrategyBase":
        """Стратегия по типу канала; у «Через коннектор» — по типу коннектора.

        Свою стратегию имеет только VK (сторис вместо сообщений), остальные
        коннекторы публикуют универсальной отправкой сообщением.
        """
        if self.type == "chat" and self.connector_id:
            return CONNECTOR_STRATEGIES.get(
                self.connector_id.type, STRATEGIES["chat"]
            )
        return STRATEGIES[self.type]
