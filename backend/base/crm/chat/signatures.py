import hashlib
import html
import json
from html.parser import HTMLParser
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt

TEXT_LIMIT = 2000
HTML_LIMIT = 10000
MAX_SIGNATURES = 100


class SignatureContent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(default="", max_length=HTML_LIMIT)
    auto_insert: StrictBool = False


class SignatureSetting(SignatureContent):
    connector_id: StrictInt = Field(gt=0)
    format: Literal["text", "html"] = "text"


class SignatureSave(SignatureContent):
    revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class _SignatureHTML(HTMLParser):
    allowed_tags = {
        "p",
        "br",
        "strong",
        "b",
        "em",
        "i",
        "u",
        "s",
        "ul",
        "ol",
        "li",
        "blockquote",
        "pre",
        "code",
        "h1",
        "h2",
        "h3",
        "a",
    }
    skipped_tags = {"script", "style", "template", "noscript"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.text: list[str] = []
        self.skipping = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.skipped_tags:
            self.skipping += 1
        if self.skipping or tag not in self.allowed_tags:
            return

        attributes = ""
        if tag == "a":
            href = dict(attrs).get("href") or ""
            try:
                safe = urlsplit(href).scheme.lower() in {
                    "http",
                    "https",
                    "mailto",
                }
            except ValueError:
                safe = False
            if safe and not any(ord(char) < 32 for char in href):
                attributes = f' href="{html.escape(href, quote=True)}"'
        self.parts.append(f"<{tag}{attributes}>")

    def handle_endtag(self, tag):
        if tag in self.skipped_tags:
            self.skipping = max(0, self.skipping - 1)
        elif not self.skipping and tag in self.allowed_tags and tag != "br":
            self.parts.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.skipping:
            self.parts.append(html.escape(data, quote=False))
            self.text.append(data)


def clean_signature(body: str, format: Literal["text", "html"]) -> str:
    if "\x00" in body:
        raise ValueError("Signature must not contain null characters")
    if format == "text":
        if len(body) > TEXT_LIMIT:
            raise ValueError(
                f"Text signature must not exceed {TEXT_LIMIT} characters"
            )
        return body.strip()

    parser = _SignatureHTML()
    parser.feed(body)
    parser.close()
    if not "".join(parser.text).strip():
        return ""
    return "".join(parser.parts).strip()


def validate_settings(value: list | None) -> list[dict]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > MAX_SIGNATURES:
        raise ValueError(f"Expected at most {MAX_SIGNATURES} signatures")

    settings = []
    connector_ids = set()
    for item in value:
        setting = SignatureSetting.model_validate(item)
        if setting.connector_id in connector_ids:
            raise ValueError("Only one signature per connector is allowed")
        connector_ids.add(setting.connector_id)
        setting.body = clean_signature(setting.body, setting.format)
        settings.append(setting.model_dump())
    return settings


def settings_revision(settings: list[dict]) -> str:
    data = json.dumps(
        settings, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(data.encode()).hexdigest()
