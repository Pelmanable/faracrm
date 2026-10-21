# Copyright 2025 FARA CRM
# Unit-тесты — без БД.
"""
Корневой tests/conftest.py на КАЖДЫЙ тест поднимает тестовую базу, пул и
делает TRUNCATE + сид (autouse). Unit-тестам всё это не нужно: они на
двойниках в памяти. Глушим эти фикстуры здесь — одноимённые определения
ближе к тесту перекрывают корневые, интеграционные тесты не затронуты.
"""

import pytest


@pytest.fixture(scope="session", autouse=True)
def manage_test_database():
    yield


@pytest.fixture(scope="session", autouse=True)
def db_pool():
    yield None


@pytest.fixture(autouse=True)
def clean_all_tables():
    yield
