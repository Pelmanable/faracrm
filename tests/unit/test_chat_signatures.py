import pytest
from pydantic import ValidationError

from backend.base.crm.chat.signatures import (
    SignatureSave,
    clean_signature,
    settings_revision,
    validate_settings,
)

pytestmark = pytest.mark.unit


def test_empty_settings():
    assert validate_settings(None) == []
    assert validate_settings([]) == []


def test_text_signature_preserves_line_breaks():
    assert (
        clean_signature("  Анна\nОтдел продаж  ", "text")
        == "Анна\nОтдел продаж"
    )


def test_text_signature_length():
    assert clean_signature("x" * 2000, "text") == "x" * 2000
    with pytest.raises(ValueError):
        clean_signature("x" * 2001, "text")


def test_null_character_is_rejected():
    with pytest.raises(ValueError):
        clean_signature("Анна\x00", "text")


def test_html_keeps_formatting_and_safe_links():
    body = '<p><strong>Анна</strong><br><a href="mailto:anna@example.com">Email</a></p>'
    assert clean_signature(body, "html") == body


def test_html_removes_scripts_images_and_event_handlers():
    body = (
        '<script>alert(1)</script><p onclick="alert(1)">Анна<img src="x"></p>'
    )
    assert clean_signature(body, "html") == "<p>Анна</p>"


@pytest.mark.parametrize(
    "href", ["javascript:alert(1)", "data:text/html,x", "//example.com"]
)
def test_html_rejects_unsafe_links(href):
    assert (
        clean_signature(f'<a href="{href}">Link</a>', "html") == "<a>Link</a>"
    )


def test_empty_html_disables_signature():
    assert clean_signature("<p><br></p>", "html") == ""


def test_duplicate_connector_is_rejected():
    setting = {"connector_id": 1, "body": "Анна"}
    with pytest.raises(ValueError):
        validate_settings([setting, setting])


def test_settings_have_explicit_defaults():
    assert validate_settings([{"connector_id": 1, "body": " Анна "}]) == [
        {
            "connector_id": 1,
            "body": "Анна",
            "format": "text",
            "auto_insert": False,
        }
    ]


def test_save_does_not_accept_another_user():
    with pytest.raises(ValidationError):
        SignatureSave(body="Анна", revision=settings_revision([]), user_id=2)


def test_revision_changes_with_settings():
    assert settings_revision([]) == settings_revision([])
    assert settings_revision([]) != settings_revision(
        [{"connector_id": 1, "body": "Анна"}]
    )
