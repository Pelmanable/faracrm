from abc import ABC, abstractmethod


class AuthStrategyAbstract(ABC):
    @abstractmethod
    async def verify_access(self, *args, **kwargs):
        raise NotImplementedError()
