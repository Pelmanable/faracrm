from pydantic import BaseModel

from backend.base.system.schemas.base_schema import Id


class UserSigninInput(BaseModel, extra="forbid"):
    login: str
    password: str


class ChangePasswordInput(BaseModel, extra="forbid"):
    user_id: Id | None = None
    password: str


class CopyUserInput(BaseModel, extra="forbid"):
    """Входные данные для копирования пользователя."""

    source_user_id: Id
    name: str
    login: str
    copy_password: bool = False
    copy_roles: bool = True
    copy_files: bool = False
    copy_languages: bool = True
    copy_is_admin: bool = True
    copy_contacts: bool = False


class CopyUserOutput(BaseModel, extra="forbid"):
    """Результат копирования пользователя."""

    id: int
    name: str
    login: str
