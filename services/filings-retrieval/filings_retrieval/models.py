"""공용 dataclass 모델."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class CorpInfo:
    """corpCode.xml 한 항목 (상장사)."""

    stock_code: str
    corp_code: str
    corp_name: str
    modify_date: str


@dataclass(frozen=True)
class ReportMeta:
    """list.json에서 선택된 사업보고서 접수 메타."""

    corp_code: str
    rcept_no: str
    report_nm: str
    rcept_dt: str
    note: Optional[str] = None


@dataclass
class SectionNode:
    """섹션 트리 노드 (SECTION-1/2/3)."""

    level: int
    title: str
    children: list["SectionNode"] = field(default_factory=list)
    element: object = None  # lxml element — 직렬화 대상 아님

    def to_snapshot(self) -> dict:
        """제목 계층만 담은 스냅샷 (본문 텍스트 제외)."""
        return {
            "title": self.title,
            "children": [child.to_snapshot() for child in self.children],
        }

    def max_depth(self) -> int:
        if not self.children:
            return 1
        return 1 + max(child.max_depth() for child in self.children)


@dataclass
class ParsedDocument:
    """본문 XML 파싱 결과."""

    rcept_no: str
    sections: list[SectionNode]
    parse_mode: str  # "strict" | "recover"
    doc_text_chars: int  # 태그 제거한 문서 전체 텍스트 문자수 (트리와 독립 산정)
    tree_text_chars: int  # 파싱 트리 itertext 문자수 — 침묵 손실 감지용
    library_excluded_section1_titles: list[str] = field(default_factory=list)

    @property
    def text_preservation_rate(self) -> float:
        if self.doc_text_chars == 0:
            return 0.0
        return self.tree_text_chars / self.doc_text_chars

    @property
    def max_depth(self) -> int:
        if not self.sections:
            return 0
        return max(section.max_depth() for section in self.sections)


@dataclass(frozen=True)
class Chunk:
    """청크: 직렬화 텍스트 + 섹션 경로 메타."""

    text: str
    section_path: tuple[str, ...]
    raw_char_count: int  # 원문(직렬화 전) 기준 문자수 — acceptance 분자용


@dataclass
class ChunkingResult:
    """회사 1건 청킹 결과 + acceptance 계측."""

    chunks: list[Chunk]
    included_section1_titles: list[str]
    excluded_section1_titles: list[str]
    narrative_chars: int  # A7 포함 섹션의 원문 텍스트 문자수 (분모)
    accepted_chars: int  # 청크에 수용된 원문 기준 문자수 (분자)

    @property
    def text_acceptance_rate(self) -> float:
        if self.narrative_chars == 0:
            return 0.0
        return self.accepted_chars / self.narrative_chars


@dataclass(frozen=True)
class CorpSpec:
    """corps.txt 한 항목."""

    stock_code: str
    category: str
    name_hint: str
    comment: Optional[str] = None
