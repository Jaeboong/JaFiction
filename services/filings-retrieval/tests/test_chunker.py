"""청커 단위 검증 — A7 제외·경계(500~800자)·표 직렬화·sectionPath·acceptance."""

from filings_retrieval.chunker import (
    CHUNK_MAX_CHARS,
    CHUNK_MIN_CHARS,
    CHUNKER_VERSION,
    chunk_document,
    is_excluded_section1,
    normalize_title,
)
from filings_retrieval.document_parser import build_section_tree, parse_xml_root
from filings_retrieval.models import ParsedDocument


def make_parsed(xml: str) -> ParsedDocument:
    root, mode = parse_xml_root(xml)
    sections, excluded = build_section_tree(root)
    return ParsedDocument(
        rcept_no="test",
        sections=sections,
        parse_mode=mode,
        doc_text_chars=1,
        tree_text_chars=1,
        library_excluded_section1_titles=excluded,
    )


# ── A7 제외 제목 정규화 매칭 ─────────────────────────────────────────────


def test_chunker_version_constant():
    assert isinstance(CHUNKER_VERSION, str) and CHUNKER_VERSION


def test_normalize_title_nfkc_roman_and_spaces():
    # 전각 로마숫자(Ⅲ) → ASCII, 전각 공백·괄호 제거
    assert normalize_title("Ⅲ. 재무에 관한 사항") == "iii.재무에관한사항"
    assert normalize_title("【 대표이사 등의 확인 】") == "대표이사등의확인"


def test_excluded_section1_variants():
    excluded = [
        "III. 재무에 관한 사항",
        "Ⅲ. 재무에 관한 사항",  # 전각 로마숫자 상호참조 표기
        "III.재무에 관한 사항",  # 마침표 뒤 공백 없음 (KB금융/에코프로비엠 실측)
        "V. 회계감사인의 감사의견 등",
        "【 대표이사 등의 확인 】",
        "【 전문가의 확인 】",
        "목 차",
        "목차",
    ]
    for title in excluded:
        assert is_excluded_section1(title), title


def test_included_section1_variants():
    included = [
        "II. 사업의 내용",
        "Ⅱ.사업의 내용",
        "I. 회사의 개요",
        "IV. 이사의 경영진단 및 분석의견",
        "XII. 상세표",
        "VII. 주주에 관한 사항",
    ]
    for title in included:
        assert not is_excluded_section1(title), title


# ── 청킹 경계·sectionPath·표 직렬화 ─────────────────────────────────────


def para(text: str) -> str:
    return f"<P>{text}</P>"


def make_doc(body: str) -> str:
    return f'<?xml version="1.0" encoding="utf-8"?><DOCUMENT><BODY>{body}</BODY></DOCUMENT>'


def test_chunk_boundaries_500_to_800():
    sentence = "회사는 반도체 검사용 소켓을 설계 제조 판매하는 사업을 영위하고 있습니다. "
    paragraphs = "".join(para(sentence * 3) for _ in range(30))
    doc = make_doc(
        f"<SECTION-1><TITLE>II. 사업의 내용</TITLE>{paragraphs}</SECTION-1>"
    )
    result = chunk_document(make_parsed(doc))
    assert len(result.chunks) > 1
    for chunk in result.chunks:
        assert len(chunk.text) <= CHUNK_MAX_CHARS
    for chunk in result.chunks[:-1]:
        assert len(chunk.text) >= CHUNK_MIN_CHARS


def test_oversized_single_paragraph_is_split():
    long_text = "가나다라 마바사아 자차카타 파하 " * 200  # ~3,400자 단일 문단
    doc = make_doc(f"<SECTION-1><TITLE>II. 사업의 내용</TITLE>{para(long_text)}</SECTION-1>")
    result = chunk_document(make_parsed(doc))
    assert len(result.chunks) >= 4
    assert all(len(chunk.text) <= CHUNK_MAX_CHARS for chunk in result.chunks)
    for chunk in result.chunks[:-1]:
        assert len(chunk.text) >= CHUNK_MIN_CHARS


def test_section_path_metadata():
    doc = make_doc(
        "<SECTION-1><TITLE>II. 사업의 내용</TITLE>"
        "<SECTION-2><TITLE>1. 사업의 개요</TITLE>"
        f"{para('사업 개요 본문입니다.')}"
        "</SECTION-2></SECTION-1>"
    )
    result = chunk_document(make_parsed(doc))
    assert result.chunks
    assert result.chunks[0].section_path == ("II. 사업의 내용", "1. 사업의 개요")


def test_table_rows_serialized_with_headers():
    doc = make_doc(
        "<SECTION-1><TITLE>II. 사업의 내용</TITLE>"
        "<TABLE>"
        "<THEAD><TR><TH>구분</TH><TH>금액</TH></TR></THEAD>"
        "<TBODY>"
        "<TR><TD>매출액</TD><TD>1,000</TD></TR>"
        "<TR><TD>영업이익</TD><TD>200</TD></TR>"
        "</TBODY></TABLE>"
        "</SECTION-1>"
    )
    result = chunk_document(make_parsed(doc))
    text = "\n".join(chunk.text for chunk in result.chunks)
    assert "구분: 매출액 | 금액: 1,000" in text
    assert "구분: 영업이익 | 금액: 200" in text


def test_table_without_headers_joins_values():
    doc = make_doc(
        "<SECTION-1><TITLE>II. 사업의 내용</TITLE>"
        "<TABLE><TBODY><TR><TD>금융위원회</TD><TD>귀중</TD></TR></TBODY></TABLE>"
        "</SECTION-1>"
    )
    result = chunk_document(make_parsed(doc))
    assert "금융위원회 | 귀중" in "\n".join(chunk.text for chunk in result.chunks)


def test_a7_excluded_sections_not_chunked():
    doc = make_doc(
        "<SECTION-1><TITLE>II. 사업의 내용</TITLE>"
        f"{para('포함되어야 하는 사업 본문')}</SECTION-1>"
        "<SECTION-1><TITLE>III. 재무에 관한 사항</TITLE>"
        f"{para('제외되어야 하는 재무제표 본문')}</SECTION-1>"
        "<SECTION-1><TITLE>【 대표이사 등의 확인 】</TITLE>"
        f"{para('제외되어야 하는 확인서')}</SECTION-1>"
    )
    result = chunk_document(make_parsed(doc))
    text = "\n".join(chunk.text for chunk in result.chunks)
    assert "포함되어야 하는 사업 본문" in text
    assert "재무제표 본문" not in text
    assert "확인서" not in text
    assert result.included_section1_titles == ["II. 사업의 내용"]
    assert set(result.excluded_section1_titles) == {
        "III. 재무에 관한 사항",
        "【 대표이사 등의 확인 】",
    }


def test_acceptance_metrics_counted():
    doc = make_doc(
        "<SECTION-1><TITLE>II. 사업의 내용</TITLE>"
        f"{para('본문 텍스트가 청크에 수용됩니다.')}</SECTION-1>"
    )
    result = chunk_document(make_parsed(doc))
    assert result.narrative_chars > 0
    assert 0.9 <= result.text_acceptance_rate <= 1.05


def test_inline_library_content_is_chunked():
    # 리노공업 실측: II. 사업의 내용의 SECTION-2 전부가 LIBRARY 하위 (실 콘텐츠)
    doc = make_doc(
        "<SECTION-1><TITLE>II. 사업의 내용</TITLE><LIBRARY>"
        "<SECTION-2><TITLE>1. 사업의 개요</TITLE>"
        f"{para('LIBRARY 안의 실제 사업 본문')}"
        "</SECTION-2></LIBRARY></SECTION-1>"
    )
    result = chunk_document(make_parsed(doc))
    text = "\n".join(chunk.text for chunk in result.chunks)
    assert "LIBRARY 안의 실제 사업 본문" in text
    assert result.chunks[0].section_path == ("II. 사업의 내용", "1. 사업의 개요")
