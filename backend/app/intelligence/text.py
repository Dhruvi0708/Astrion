"""Document text extraction and passage chunking (deterministic; no model involved).

Supported: PDF (text layer via pypdf), plain text, Markdown, CSV, JSON, HTML. Office formats are stored
but reported as unsupported for extraction rather than silently ignored. Scanned PDFs without a text
layer yield no text and are reported as such (no OCR).
"""

import contextlib
import io
import json
import re
from dataclasses import dataclass
from html.parser import HTMLParser

TARGET_CHARS = 1400
MAX_CHARS = 2200

TEXT_TYPES = {"text/plain", "text/markdown", "text/csv", "application/json", "text/html"}
UNSUPPORTED_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


class ExtractionError(Exception):
    pass


@dataclass(frozen=True)
class Segment:
    text: str
    page: int | None


@dataclass(frozen=True)
class Passage:
    index: int
    text: str
    char_start: int
    char_end: int
    page: int | None


class _HTMLText(HTMLParser):
    BLOCK = {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "section", "article", "blockquote"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):  # noqa: ANN001
        if tag in ("script", "style", "noscript"):
            self._skip += 1
        elif tag in self.BLOCK:
            self.parts.append("\n\n")

    def handle_endtag(self, tag):  # noqa: ANN001
        if tag in ("script", "style", "noscript") and self._skip:
            self._skip -= 1

    def handle_data(self, data):  # noqa: ANN001
        if not self._skip:
            self.parts.append(data)


def extract_segments(data: bytes, media_type: str) -> list[Segment]:
    if media_type == "application/pdf":
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError

        try:
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                raise ExtractionError("PDF is encrypted.")
            segments = [Segment(text=(page.extract_text() or ""), page=i + 1) for i, page in enumerate(reader.pages)]
        except PdfReadError as exc:
            raise ExtractionError(f"PDF could not be read: {exc}") from exc
        if not any(s.text.strip() for s in segments):
            raise ExtractionError("PDF has no text layer (scanned image?). OCR is not supported.")
        return segments
    if media_type in UNSUPPORTED_TYPES:
        raise ExtractionError("Text extraction for this format is not supported yet.")
    if media_type not in TEXT_TYPES:
        raise ExtractionError(f"Unsupported media type for extraction: {media_type}")
    text = data.decode("utf-8", errors="replace")
    if media_type == "text/html":
        parser = _HTMLText()
        parser.feed(text)
        text = "".join(parser.parts)
    elif media_type == "application/json":
        with contextlib.suppress(json.JSONDecodeError):
            text = json.dumps(json.loads(text), indent=1, ensure_ascii=False)
    return [Segment(text=text, page=None)]


_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"“(])")


def _split_long(paragraph: str) -> list[str]:
    if len(paragraph) <= MAX_CHARS:
        return [paragraph]
    out, buf = [], ""
    for sentence in _SENTENCE_END.split(paragraph):
        if buf and len(buf) + len(sentence) + 1 > TARGET_CHARS:
            out.append(buf)
            buf = sentence
        else:
            buf = f"{buf} {sentence}" if buf else sentence
        while len(buf) > MAX_CHARS:  # a single enormous "sentence"
            out.append(buf[:MAX_CHARS])
            buf = buf[MAX_CHARS:]
    if buf:
        out.append(buf)
    return out


def chunk(segments: list[Segment]) -> list[Passage]:
    """Groups paragraphs into passages of ~TARGET_CHARS, never splitting across pages. Offsets refer to
    the concatenation of all segment texts joined by a blank line."""
    passages: list[Passage] = []
    offset = 0
    for seg in segments:
        text = seg.text.replace("\r\n", "\n")
        cursor = 0
        buf, buf_start = "", None
        for match in re.finditer(r"[^\n]+(?:\n(?!\s*\n)[^\n]+)*", text):
            para = re.sub(r"[ \t]+", " ", match.group().strip())
            if not para:
                continue
            for piece in _split_long(para):
                start = offset + match.start()
                if buf and len(buf) + len(piece) + 2 > TARGET_CHARS:
                    passages.append(Passage(len(passages), buf, buf_start, buf_start + len(buf), seg.page))
                    buf, buf_start = "", None
                if buf_start is None:
                    buf_start = start
                buf = f"{buf}\n\n{piece}" if buf else piece
            cursor = match.end()
        if buf:
            passages.append(Passage(len(passages), buf, buf_start, buf_start + len(buf), seg.page))
        offset += len(text) + 2
        _ = cursor
    return passages
