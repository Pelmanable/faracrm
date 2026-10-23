"""
LibreOffice headless: конвертация офисных документов в PDF.

Общий для модулей: отчёты (report_docx) печатают через него DOCX, вложения
показывают doc/odt/rtf. В образе бэкенда ставится только Writer
(docker/backend.Dockerfile, WITH_LIBREOFFICE) — таблицы и презентации
он не откроет.
"""

import os
import pathlib
import re
import subprocess
import tempfile
import threading
import time

# «LibreOffice не найден» перепроверяем не чаще раза в минуту: у каждого
# воркера свой кэш, и после установки без рестарта они подхватят его сами
_RECHECK_SECONDS = 60
# Конверсия — по одной за раз в процессе (см. convert_to_pdf)
_LOCK = threading.Lock()
# (когда проверяли, что нашли) — кэш поиска на процесс
_probe: tuple[float, tuple[str, str] | None] = (0.0, None)


def _profile_uri() -> str:
    """Профиль LibreOffice этого процесса (file://…): у каждого воркера свой,
    чтобы они не блокировали друг друга через общий ~/.config."""
    path = os.path.join(
        tempfile.gettempdir(), f"fara_libreoffice_{os.getpid()}"
    )
    return pathlib.Path(path).as_uri()


def _find() -> tuple[str, str] | None:
    """(команда, версия) LibreOffice или None, если он не установлен."""
    for cmd in ["libreoffice", "soffice", "/usr/bin/libreoffice"]:
        try:
            r = subprocess.run(
                [cmd, "--version"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=5,
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        if r.returncode == 0:
            output = r.stdout.decode("utf-8", errors="replace")
            found = re.search(r"\d+(?:\.\d+)+", output)
            return cmd, found.group(0) if found else output.strip()[:40]
    return None


def libreoffice_info(recheck: bool = False) -> tuple[str, str] | None:
    """(команда, версия) LibreOffice или None. Найденный помним весь срок
    процесса (проверка запускает процесс); «не найден» перепроверяем раз
    в минуту или сразу по recheck (кнопка «Проверить снова» в отчётах)."""
    global _probe
    checked_at, info = _probe
    if info is not None and not recheck:
        return info
    if not recheck and time.monotonic() - checked_at < _RECHECK_SECONDS:
        return None
    info = _find()
    _probe = (time.monotonic(), info)
    return info


def convert_to_pdf(content: bytes, suffix: str) -> bytes:
    """Документ → PDF. suffix — расширение файла («.docx», «.odt»…): по нему
    LibreOffice выбирает формат на входе. Синхронно и небыстро — из
    event loop вызывать через asyncio.to_thread."""
    info = libreoffice_info()
    if info is None:
        raise RuntimeError(
            "LibreOffice not found. Install: apt install libreoffice-writer"
        )

    # Один профиль на процесс и одна конверсия за раз: два soffice с общим
    # профилем мешают друг другу (второй молча передаёт документ первому и
    # выходит без PDF), а свежий профиль на каждый вызов — это ещё +2 с
    with _LOCK, tempfile.TemporaryDirectory() as tmpdir:
        source_path = os.path.join(tmpdir, f"document{suffix}")
        with open(source_path, "wb") as f:
            f.write(content)

        try:
            result = subprocess.run(
                [
                    info[0],
                    f"-env:UserInstallation={_profile_uri()}",
                    "--headless",
                    "--norestore",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    tmpdir,
                    source_path,
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=60,
            )
            if result.returncode != 0:
                stderr = result.stderr.decode("utf-8", errors="replace")
                raise RuntimeError(f"LibreOffice error: {stderr}")
        except FileNotFoundError:
            raise RuntimeError(
                "LibreOffice not found. Install: apt install libreoffice-writer"
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError("PDF conversion timed out (60s)")

        pdf_path = os.path.join(tmpdir, "document.pdf")
        if not os.path.exists(pdf_path):
            raise RuntimeError("PDF not created")

        with open(pdf_path, "rb") as f:
            return f.read()
