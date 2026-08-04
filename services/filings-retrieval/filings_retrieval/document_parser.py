"""document.xml zip → 본문 XML 선택 → 새니타이즈 → 섹션 트리 파싱.

실측(20개사) 근거:
- 본문 파일명은 zip 내 "<rcept_no>.xml" 정확 일치. "<rcept_no>_00760.xml" 류 첨부는
  감사보고서라 파싱하지 않는다 (A7).
- 원문은 strict XML로 0/20 파싱된다. 검증된 새니타이즈 체인(bare '&' 이스케이프 →
  속성값 따옴표 수리 → 화이트리스트 외 '<' 이스케이프) 적용 후 20/20 strict 통과.
- lxml recover=True 단독은 불충분(속성 따옴표 결함 시 문서 중간에서 조용히 중단) —
  안전망으로만 사용하고 text_preservation_rate로 침묵 손실을 감지한다.
- LIBRARY는 섹션 내부에서는 실제 콘텐츠 컨테이너다(예: 리노공업 "II. 사업의 내용"의
  SECTION-2 전부가 LIBRARY 하위). 단 [기재정정] 문서에서 SECTION-1 자체가 LIBRARY
  하위이면 정정 전 원본 보존용 중복이라 트리에서 제외한다.
"""

from __future__ import annotations

import re
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Union

from lxml import etree

from .models import ParsedDocument, SectionNode

# 실측 태그 인벤토리: 15개 파일 이상 등장 코어 32종 + CORRECTION([기재정정] 4개사).
TAG_WHITELIST = frozenset(
    [
        "A",
        "BODY",
        "COL",
        "COLGROUP",
        "COMPANY-NAME",
        "CORRECTION",
        "COVER",
        "COVER-TITLE",
        "DOCUMENT",
        "DOCUMENT-NAME",
        "EXTRACTION",
        "FORMULA-VERSION",
        "IMAGE",
        "IMG",
        "IMG-CAPTION",
        "LIBRARY",
        "P",
        "PGBRK",
        "SECTION-1",
        "SECTION-2",
        "SECTION-3",
        "SPAN",
        "SUMMARY",
        "TABLE",
        "TABLE-GROUP",
        "TBODY",
        "TD",
        "TE",
        "TH",
        "THEAD",
        "TITLE",
        "TR",
        "TU",
    ]
)

SECTION_TAGS = ("SECTION-1", "SECTION-2", "SECTION-3")

_DECL_ENCODING_RE = re.compile(rb'<\?xml[^>]*encoding=["\']([A-Za-z0-9._-]+)["\']')
_BARE_AMP_RE = re.compile(r"&(?!(?:amp|lt|gt|quot|apos);|#[0-9]+;|#x[0-9A-Fa-f]+;)")
# 부정 전방탐색: ="" 직후가 「다음 속성(NAME=")」 형태면 인접한 두 정상 빈 속성
# (A="" B="")이므로 병합 수리 금지. 깨진 쌍따옴표는 내용이 속성 형태가 아니다
# (LG화학 ENG=""Gain (loss)"", KB금융 ENG="" KB Insurance Co., Ltd "" 실측).
_ATTR_QUOTE_PAIR_RE = re.compile(r'=""(?!\s*[A-Za-z][-:\w]*=")([^"<>\r\n]*)""')
_ATTR_QUOTE_LEAD_RE = re.compile(r'=""(?=[^\s">])')
_TAG_TOKEN_RE = re.compile(r"</?([A-Za-z][A-Za-z0-9-]*)")
_TAG_STRIP_RE = re.compile(r"<[^>]*>")
_XML_DECL_RE = re.compile(r"^\s*<\?xml[^>]*\?>")


class DocumentParseError(Exception):
    """본문 XML 선택/파싱 실패."""


def select_main_xml(zip_source: Union[bytes, str, Path], rcept_no: str) -> bytes:
    """zip에서 본문 XML("<rcept_no>.xml" 정확 일치)만 꺼낸다."""
    if isinstance(zip_source, bytes):
        handle = BytesIO(zip_source)
    else:
        handle = Path(zip_source).open("rb")
    try:
        with zipfile.ZipFile(handle) as archive:
            expected = f"{rcept_no}.xml"
            if expected not in archive.namelist():
                raise DocumentParseError(
                    f"본문 XML 없음: zip에 {expected} 부재 (내용: {archive.namelist()})"
                )
            return archive.read(expected)
    finally:
        handle.close()


def decode_xml(data: bytes) -> str:
    """XML 선언 인코딩 우선, 실패 시 utf-8 → cp949 → euc-kr fallback."""
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    candidates: list[str] = []
    match = _DECL_ENCODING_RE.search(data[:256])
    if match:
        candidates.append(match.group(1).decode("ascii").lower())
    for fallback in ("utf-8", "cp949", "euc-kr"):
        if fallback not in candidates:
            candidates.append(fallback)
    last_error: Exception | None = None
    for encoding in candidates:
        try:
            return data.decode(encoding)
        except (UnicodeDecodeError, LookupError) as exc:
            last_error = exc
    raise DocumentParseError(f"인코딩 해석 실패 (시도: {candidates}): {last_error}")


def _escape_stray_lt(text: str) -> str:
    """화이트리스트 태그가 아닌 '<'를 &lt;로 이스케이프 (의사마크업 무해화)."""
    parts: list[str] = []
    last = 0
    length = len(text)
    for match in re.finditer("<", text):
        i = match.start()
        keep = False
        nxt = text[i + 1] if i + 1 < length else ""
        if nxt in ("?", "!"):
            keep = True  # <?xml ...?>, <!-- ... -->, <!DOCTYPE ...>
        else:
            token = _TAG_TOKEN_RE.match(text, i)
            if token and token.group(1) in TAG_WHITELIST:
                end = token.end()
                if end < length and text[end] in " \t\r\n>/":
                    keep = True
        if not keep:
            parts.append(text[last:i])
            parts.append("&lt;")
            last = i + 1
    parts.append(text[last:])
    return "".join(parts)


def sanitize_xml(text: str) -> str:
    """검증된 새니타이즈 체인 (recon 20/20 strict 통과 확인).

    1. bare '&' → &amp; (수치 참조·사전정의 엔티티 제외 — &reg; 류 HTML 엔티티도 무해화)
    2. 속성값 따옴표 수리: ATTR=""..."" 쌍형 → 내부 &quot;, 잔여 =""(비공백 후행) → ="&quot;
    3. '<' 뒤 태그 토큰이 화이트리스트에 없으면 &lt;
    """
    text = _BARE_AMP_RE.sub("&amp;", text)
    text = _ATTR_QUOTE_PAIR_RE.sub(r'="&quot;\1&quot;"', text)
    text = _ATTR_QUOTE_LEAD_RE.sub('="&quot;', text)
    return _escape_stray_lt(text)


def _normalized_len(text: str) -> int:
    return len(" ".join(text.split()))


def _strip_tags_text_chars(sanitized: str) -> int:
    """트리와 독립적으로 문서 전체 텍스트 문자수를 센다 (침묵 손실 감지 기준)."""
    body = _XML_DECL_RE.sub("", sanitized)
    text = _TAG_STRIP_RE.sub(" ", body)
    for entity, char in (
        ("&amp;", "&"),
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&quot;", '"'),
        ("&apos;", "'"),
    ):
        text = text.replace(entity, char)
    return _normalized_len(text)


def parse_xml_root(sanitized: str) -> tuple[etree._Element, str]:
    """strict 우선, 실패 시 recover=True 안전망. (root, parse_mode) 반환."""
    data = sanitized.encode("utf-8")
    try:
        root = etree.fromstring(data, etree.XMLParser(huge_tree=True))
        return root, "strict"
    except etree.XMLSyntaxError:
        root = etree.fromstring(
            data, etree.XMLParser(recover=True, huge_tree=True)
        )
        if root is None:
            raise DocumentParseError("recover 파싱조차 실패 (root=None)")
        return root, "recover"


def _has_library_ancestor(element: etree._Element) -> bool:
    parent = element.getparent()
    while parent is not None:
        if parent.tag == "LIBRARY":
            return True
        parent = parent.getparent()
    return False


def _nearest_section_ancestor(element: etree._Element) -> etree._Element | None:
    parent = element.getparent()
    while parent is not None:
        if isinstance(parent.tag, str) and parent.tag in SECTION_TAGS:
            return parent
        parent = parent.getparent()
    return None


def section_title(element: etree._Element) -> str:
    """섹션 첫 TITLE 텍스트 (직계 우선, 없으면 첫 자손 TITLE)."""
    title = element.find("TITLE")
    if title is None:
        title = element.find(".//TITLE")
    if title is None:
        return "(제목 없음)"
    return " ".join("".join(title.itertext()).split())


def build_section_tree(
    root: etree._Element,
) -> tuple[list[SectionNode], list[str]]:
    """SECTION-1(LIBRARY 밖) 트리 구성. LIBRARY 하위 SECTION-1은 정정 중복이라 제외.

    섹션 내부의 LIBRARY는 실제 콘텐츠 컨테이너이므로, 하위 SECTION-2/3은
    중간에 LIBRARY가 끼어 있어도 가장 가까운 섹션 조상 기준으로 트리에 붙인다.
    """
    excluded: list[str] = []
    nodes: dict[int, SectionNode] = {}
    top: list[SectionNode] = []
    for element in root.iter(*SECTION_TAGS):
        level = int(element.tag[-1])
        if level == 1:
            if _has_library_ancestor(element):
                excluded.append(section_title(element))
                continue
            node = SectionNode(level=1, title=section_title(element), element=element)
            nodes[id(element)] = node
            top.append(node)
            continue
        ancestor = _nearest_section_ancestor(element)
        parent_node = nodes.get(id(ancestor)) if ancestor is not None else None
        if parent_node is None:
            # 조상 섹션이 트리에 없으면(LIBRARY 하위 정정 중복 등) 함께 제외한다.
            continue
        node = SectionNode(level=level, title=section_title(element), element=element)
        nodes[id(element)] = node
        parent_node.children.append(node)
    return top, excluded


def parse_document(zip_source: Union[bytes, str, Path], rcept_no: str) -> ParsedDocument:
    """zip → 본문 선택 → 디코딩 → 새니타이즈 → 파싱 → 섹션 트리."""
    raw = select_main_xml(zip_source, rcept_no)
    sanitized = sanitize_xml(decode_xml(raw))
    root, parse_mode = parse_xml_root(sanitized)
    sections, library_excluded = build_section_tree(root)
    doc_text_chars = _strip_tags_text_chars(sanitized)
    tree_text_chars = _normalized_len("".join(root.itertext()))
    return ParsedDocument(
        rcept_no=rcept_no,
        sections=sections,
        parse_mode=parse_mode,
        doc_text_chars=doc_text_chars,
        tree_text_chars=tree_text_chars,
        library_excluded_section1_titles=library_excluded,
    )
