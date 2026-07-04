"""섹션 트리 → A7 범위 청킹 (500~800자, sectionPath 메타, 표 행 직렬화).

- A7: 재무제표 본문·감사의견·확인서·목차 류 boilerplate 대분류는 인덱싱하지 않는다.
  수치는 기존 fnlttSinglAcntAll 정형 API가 커버한다.
- 제목 매칭은 NFKC 정규화(전각 로마숫자 Ⅱ→II)·공백/괄호 변형을 허용한다.
- acceptance 분모는 청커 추출과 독립적으로 포함 섹션 서브트리 텍스트에서 산정한다
  (추출 누락이 acceptance 하락으로 드러나도록 — 침묵 실패 금지).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from .document_parser import SECTION_TAGS
from .models import Chunk, ChunkingResult, ParsedDocument, SectionNode

CHUNKER_VERSION = "0.1.0"

CHUNK_MIN_CHARS = 500
CHUNK_MAX_CHARS = 800

# A7 제외 대분류 (SECTION-1 TITLE 정규화 후 부분 일치).
EXCLUDED_SECTION1_SUBSTRINGS = (
    "재무에관한사항",  # 요약재무정보 포함 전체
    "회계감사인의감사의견",
    "대표이사등의확인",
    "전문가의확인",
)
# 목차는 짧아 오탐 방지를 위해 완전 일치로만.
EXCLUDED_SECTION1_EXACT = ("목차",)

_ROMAN_PREFIX_RE = re.compile(r"^[ivxlcdm]+\.?", re.IGNORECASE)
_BRACKETS_RE = re.compile(r"[【】\[\]()〈〉「」『』<>]")
_CELL_TAGS = ("TH", "TD", "TE", "TU")
_SKIP_TAGS = frozenset(["PGBRK", "COLGROUP", "COL", "IMG"])
_CONTAINER_TAGS = frozenset(["TABLE-GROUP", "LIBRARY", "IMAGE", "EXTRACTION", "SUMMARY"])


def normalize_title(title: str) -> str:
    """NFKC(전각 로마숫자·전각 공백 정규화) → 소문자 → 괄호·공백 제거."""
    text = unicodedata.normalize("NFKC", title).lower()
    text = _BRACKETS_RE.sub("", text)
    return "".join(text.split())


def is_excluded_section1(title: str) -> bool:
    normalized = normalize_title(title)
    stripped = _ROMAN_PREFIX_RE.sub("", normalized)
    if any(sub in normalized for sub in EXCLUDED_SECTION1_SUBSTRINGS):
        return True
    return normalized in EXCLUDED_SECTION1_EXACT or stripped in EXCLUDED_SECTION1_EXACT


def _norm_text(text: str) -> str:
    return " ".join(text.split())


@dataclass(frozen=True)
class _Unit:
    text: str
    raw_chars: int


def _own_first_title(section_el) -> object:
    return section_el.find("TITLE")


def _section_own_text_chars(section_el) -> int:
    """섹션 자기 콘텐츠 텍스트 문자수 — 하위 섹션·자기 TITLE·CORRECTION·IMG 제외.

    청커 추출 경로와 독립적으로 세어 acceptance 분모로 쓴다.
    """
    first_title = _own_first_title(section_el)
    parts: list[str] = []

    def rec(el) -> None:
        if el.text:
            parts.append(el.text)
        for child in el:
            tag = child.tag
            skip_subtree = (
                not isinstance(tag, str)
                or tag in SECTION_TAGS
                or tag == "CORRECTION"
                or tag == "IMG"
                or child is first_title
            )
            if not skip_subtree:
                rec(child)
            if child.tail:
                parts.append(child.tail)

    rec(section_el)
    return len(_norm_text("".join(parts)))


def _table_units(table_el):
    thead_rows = [tr for thead in table_el.findall("THEAD") for tr in thead.findall("TR")]
    headers: list[str] = []
    for tr in thead_rows:
        cells = [
            _norm_text("".join(cell.itertext()))
            for cell in tr
            if isinstance(cell.tag, str) and cell.tag in _CELL_TAGS
        ]
        if not any(cells):
            continue
        yield _Unit(" | ".join(c for c in cells if c), sum(len(c) for c in cells))
        if sum(len(c) for c in cells) > sum(len(h) for h in headers):
            headers = cells
    body_rows = [tr for tbody in table_el.findall("TBODY") for tr in tbody.findall("TR")]
    body_rows.extend(table_el.findall("TR"))
    for tr in body_rows:
        cells = [
            _norm_text("".join(cell.itertext()))
            for cell in tr
            if isinstance(cell.tag, str) and cell.tag in _CELL_TAGS
        ]
        if not any(cells):
            continue
        if headers and len(headers) == len(cells):
            pairs = []
            for header, value in zip(headers, cells):
                if not value:
                    continue
                pairs.append(f"{header}: {value}" if header else value)
            text = " | ".join(pairs)
        else:
            text = " | ".join(value for value in cells if value)
        yield _Unit(text, sum(len(value) for value in cells))


def _iter_units(section_el):
    """섹션 자기 콘텐츠에서 청킹 단위(문단/표 행) 추출."""
    first_title = _own_first_title(section_el)

    def rec(el):
        for child in el:
            tag = child.tag
            if not isinstance(tag, str):
                if child.tail and child.tail.strip():
                    yield _Unit(_norm_text(child.tail), len(_norm_text(child.tail)))
                continue
            if tag in SECTION_TAGS or tag == "CORRECTION" or child is first_title:
                pass
            elif tag in _SKIP_TAGS:
                pass
            elif tag == "TABLE":
                yield from _table_units(child)
            elif tag in _CONTAINER_TAGS:
                if child.text and child.text.strip():
                    yield _Unit(_norm_text(child.text), len(_norm_text(child.text)))
                yield from rec(child)
            else:
                text = _norm_text("".join(child.itertext()))
                if text:
                    yield _Unit(text, len(text))
            if child.tail and child.tail.strip():
                yield _Unit(_norm_text(child.tail), len(_norm_text(child.tail)))

    if section_el.text and section_el.text.strip():
        yield _Unit(_norm_text(section_el.text), len(_norm_text(section_el.text)))
    yield from rec(section_el)


def _split_at(text: str, limit: int) -> tuple[str, str]:
    """limit 이내(하한 limit*3/4) 마지막 공백에서 분할, 없으면 hard split.

    분할 창 하한 3/4 덕에 overflow flush 청크가 500자 아래로 내려가지 않는다.
    """
    if len(text) <= limit:
        return text, ""
    cut = text.rfind(" ", max(1, limit * 3 // 4), limit + 1)
    if cut <= 0:
        cut = limit
    return text[:cut].rstrip(), text[cut:].lstrip()


def _assemble_chunks(units: list[_Unit], section_path: tuple[str, ...]) -> tuple[list[Chunk], int]:
    """500~800자 청크 조립. (chunks, accepted_raw_chars) 반환.

    보장: 모든 청크 ≤ 800자, 섹션 내 마지막 청크를 제외하면 ≥ 500자.
    """
    chunks: list[Chunk] = []
    buf: list[str] = []
    buf_len = 0
    buf_raw = 0.0
    accepted_raw = 0

    def flush() -> None:
        nonlocal buf, buf_len, buf_raw
        if buf:
            chunks.append(Chunk("\n".join(buf), section_path, round(buf_raw)))
        buf, buf_len, buf_raw = [], 0, 0.0

    def append(piece: str, raw: float) -> None:
        nonlocal buf_len, buf_raw
        buf.append(piece)
        buf_len += (1 if buf_len else 0) + len(piece)
        buf_raw += raw

    for unit in units:
        text = unit.text
        if not text:
            continue
        accepted_raw += unit.raw_chars
        raw_per_char = unit.raw_chars / len(text) if text else 0.0
        while text:
            sep = 1 if buf_len else 0
            room = CHUNK_MAX_CHARS - buf_len - sep
            if len(text) <= room:
                append(text, raw_per_char * len(text))
                text = ""
            elif buf_len >= CHUNK_MIN_CHARS:
                flush()
            else:
                head, text = _split_at(text, room)
                if head:
                    append(head, raw_per_char * len(head))
                flush()
        if buf_len >= CHUNK_MAX_CHARS:
            flush()
    flush()
    return chunks, accepted_raw


def _iter_nodes_with_path(node: SectionNode, prefix: tuple[str, ...]):
    path = prefix + (node.title,)
    yield node, path
    for child in node.children:
        yield from _iter_nodes_with_path(child, path)


def chunk_document(parsed: ParsedDocument) -> ChunkingResult:
    """A7 포함 대분류만 청킹. acceptance 분모/분자를 함께 계측한다."""
    chunks: list[Chunk] = []
    included: list[str] = []
    excluded: list[str] = []
    narrative_chars = 0
    accepted_chars = 0
    for section1 in parsed.sections:
        if is_excluded_section1(section1.title):
            excluded.append(section1.title)
            continue
        included.append(section1.title)
        for node, path in _iter_nodes_with_path(section1, ()):
            if node.element is None:
                continue
            narrative_chars += _section_own_text_chars(node.element)
            units = list(_iter_units(node.element))
            node_chunks, node_accepted = _assemble_chunks(units, path)
            chunks.extend(node_chunks)
            accepted_chars += node_accepted
    return ChunkingResult(
        chunks=chunks,
        included_section1_titles=included,
        excluded_section1_titles=excluded,
        narrative_chars=narrative_chars,
        accepted_chars=accepted_chars,
    )
