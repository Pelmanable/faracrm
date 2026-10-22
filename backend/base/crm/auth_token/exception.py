"""Exceptions related to auth"""

from backend.base.crm.auth.exception import AuthFailed


class TokenNotFound(AuthFailed):
    """Exception on token not found"""


class TokenEmpty(AuthFailed):
    """Exception on token is empty"""
