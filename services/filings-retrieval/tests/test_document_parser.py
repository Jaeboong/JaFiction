"""합성 XML로 인코딩 fallback·새니타이즈·복구 파싱·섹션 트리 단위 검증."""

import io
import zipfile

import pytest

from filings_retrieval.document_parser import (
    DocumentParseError,
    build_section_tree,
    decode_xml,
    parse_document,
    parse_xml_root,
    sanitize_xml,
    select_main_xml,
)


def make_zip(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return buffer.getvalue()


# ── select_main_xml ──────────────────────────────────────────────────────


def test_select_main_xml_exact_match_skips_attachments():
    data = make_zip(
        {
            "20260101000001.xml": b"<DOCUMENT/>",
            "20260101000001_00760.xml": b"<AUDIT/>",  # 감사보고서 첨부 — 제외 대상
        }
    )
    assert select_main_xml(data, "20260101000001") == b"<DOCUMENT/>"


def test_select_main_xml_missing_raises():
    data = make_zip({"20260101000001_00760.xml": b"<AUDIT/>"})
    with pytest.raises(DocumentParseError, match="본문 XML 없음"):
        select_main_xml(data, "20260101000001")


# ── decode_xml ───────────────────────────────────────────────────────────


def test_decode_declared_utf8():
    raw = '<?xml version="1.0" encoding="utf-8"?><P>한글</P>'.encode("utf-8")
    assert "한글" in decode_xml(raw)


def test_decode_declared_euckr():
    raw = '<?xml version="1.0" encoding="euc-kr"?><P>한글</P>'.encode("euc-kr")
    assert "한글" in decode_xml(raw)


def test_decode_wrong_declaration_falls_back_to_cp949():
    # 선언은 utf-8이지만 실제 바이트는 cp949 → fallback으로 복구
    raw = '<?xml version="1.0" encoding="utf-8"?><P>한글값</P>'.encode("cp949")
    assert "한글값" in decode_xml(raw)


def test_decode_strips_bom():
    raw = b"\xef\xbb\xbf" + '<?xml version="1.0" encoding="utf-8"?><P>a</P>'.encode()
    assert decode_xml(raw).startswith("<?xml")


# ── sanitize_xml ─────────────────────────────────────────────────────────


def test_sanitize_bare_ampersand():
    assert sanitize_xml("<P>S&P 500 R&D</P>") == "<P>S&amp;P 500 R&amp;D</P>"


def test_sanitize_preserves_valid_entities():
    text = "<P>&amp; &lt; &#38; &#x26; &quot;</P>"
    assert sanitize_xml(text) == text


def test_sanitize_neutralizes_html_named_entity():
    # LG전자 실측: &reg; — strict XML에서 fatal, &amp;reg;로 무해화
    assert sanitize_xml("<P>ThinQ&reg;</P>") == "<P>ThinQ&amp;reg;</P>"


def test_sanitize_attr_double_quote_pair():
    # LG화학 실측: ENG=""..."" 쌍따옴표형
    source = '<TD ENG=""Gain (loss) on valuation"">v</TD>'
    assert sanitize_xml(source) == '<TD ENG="&quot;Gain (loss) on valuation&quot;">v</TD>'


def test_sanitize_attr_leading_quote():
    # NAVER/현대차 실측: 선행 이중따옴표 + 단일 종료
    source = '<TD ENG=""Snow Corporation">v</TD>'
    assert sanitize_xml(source) == '<TD ENG="&quot;Snow Corporation">v</TD>'


def test_sanitize_keeps_legit_empty_attribute():
    source = '<TD ENG="" WIDTH="5">v</TD>'
    assert sanitize_xml(source) == source


def test_sanitize_keeps_adjacent_empty_attributes():
    # 인접한 두 정상 빈 속성이 깨진 쌍따옴표로 오인·병합되면 안 된다 (B 소실 회귀)
    source = '<TD A="" B="">v</TD>'
    assert sanitize_xml(source) == source


def test_sanitize_keeps_multiple_empty_attributes_before_value():
    source = '<TD ENG="" ACODE="" WIDTH="5">v</TD>'
    assert sanitize_xml(source) == source


def test_sanitize_attr_double_quote_pair_space_padded():
    # KB금융 실측: 내용이 공백으로 시작/끝나는 깨진 쌍따옴표도 수리돼야 한다
    source = '<TH COLSPAN="8" ENG="" KB Insurance Co., Ltd "">v</TH>'
    assert sanitize_xml(source) == (
        '<TH COLSPAN="8" ENG="&quot; KB Insurance Co., Ltd &quot;">v</TH>'
    )


def test_sanitize_broken_pair_next_to_empty_attribute():
    # 정상 빈 속성 + 깨진 쌍따옴표 혼재 시 깨진 쪽만 수리
    source = '<TD A="" ENG=""Gain (loss)"">v</TD>'
    assert sanitize_xml(source) == '<TD A="" ENG="&quot;Gain (loss)&quot;">v</TD>'


def test_sanitize_pseudo_markup_escaped():
    cases = {
        "<P>작품 <배틀그라운드> 흥행</P>": "<P>작품 &lt;배틀그라운드> 흥행</P>",
        "<P><Manufacturing Excellence> 체계</P>": "<P>&lt;Manufacturing Excellence> 체계</P>",
        "<P>< TV 시장점유율 추이 ></P>": "<P>&lt; TV 시장점유율 추이 ></P>",
        "<P><PUBG: 배틀그라운드></P>": "<P>&lt;PUBG: 배틀그라운드></P>",
        "<P><STS>부문</P>": "<P>&lt;STS>부문</P>",
    }
    for source, expected in cases.items():
        assert sanitize_xml(source) == expected


def test_sanitize_keeps_whitelist_tags_and_decl():
    text = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<DOCUMENT><SECTION-1 AID="X"><TITLE>t</TITLE><P>b</P></SECTION-1></DOCUMENT>'
    )
    assert sanitize_xml(text) == text


def test_sanitized_nasty_document_parses_strict_with_text_preserved():
    nasty = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<DOCUMENT><BODY><SECTION-1><TITLE>II. 사업의 내용</TITLE>"
        '<P>M&A와 <배틀그라운드>및 R&D, ThinQ&reg;</P>'
        '<TABLE><TBODY><TR><TD ENG=""Snow Corporation">스노우</TD></TR></TBODY></TABLE>'
        "</SECTION-1></BODY></DOCUMENT>"
    )
    root, mode = parse_xml_root(sanitize_xml(nasty))
    assert mode == "strict"
    text = "".join(root.itertext())
    assert "M&A와" in text
    assert "<배틀그라운드>및 R&D" in text
    assert "스노우" in text


# ── 섹션 트리 ────────────────────────────────────────────────────────────


SECTION_DOC = """<?xml version="1.0" encoding="utf-8"?>
<DOCUMENT>
<BODY>
<LIBRARY>
<CORRECTION><TITLE>정 정 신 고 (보고)</TITLE><P>정정 사유</P></CORRECTION>
<SECTION-1><TITLE>【 대표이사 등의 확인 】</TITLE><P>정정 전 원본 확인서</P></SECTION-1>
</LIBRARY>
<SECTION-1><TITLE>【 대표이사 등의 확인 】</TITLE><P>확인서</P></SECTION-1>
<SECTION-1><TITLE>I. 회사의 개요</TITLE>
  <SECTION-2><TITLE>1. 회사의 개요</TITLE><P>개요 본문</P></SECTION-2>
</SECTION-1>
<SECTION-1><TITLE>II. 사업의 내용</TITLE>
  <LIBRARY>
    <SECTION-2><TITLE>1. 사업의 개요</TITLE><P>사업 본문</P>
      <SECTION-3><TITLE>1-1. 상세</TITLE><P>상세 본문</P></SECTION-3>
    </SECTION-2>
  </LIBRARY>
</SECTION-1>
</BODY>
</DOCUMENT>
"""


def test_section_tree_titles_and_depth():
    root, mode = parse_xml_root(SECTION_DOC)
    assert mode == "strict"
    sections, excluded = build_section_tree(root)
    assert [section.title for section in sections] == [
        "【 대표이사 등의 확인 】",
        "I. 회사의 개요",
        "II. 사업의 내용",
    ]
    # LIBRARY 하위 SECTION-1(정정 전 원본)은 트리에서 제외 + 기록
    assert excluded == ["【 대표이사 등의 확인 】"]
    # 섹션 내부 LIBRARY는 실제 콘텐츠 컨테이너 — 하위 SECTION-2/3는 트리에 붙는다
    business = sections[2]
    assert [child.title for child in business.children] == ["1. 사업의 개요"]
    assert business.children[0].children[0].title == "1-1. 상세"
    assert max(section.max_depth() for section in sections) == 3


def test_parse_document_end_to_end(tmp_path):
    rcept_no = "20260101000001"
    data = make_zip({f"{rcept_no}.xml": SECTION_DOC.encode("utf-8")})
    zip_path = tmp_path / "sample.zip"
    zip_path.write_bytes(data)
    parsed = parse_document(zip_path, rcept_no)
    assert parsed.parse_mode == "strict"
    assert parsed.max_depth == 3
    assert len(parsed.sections) == 3
    assert parsed.library_excluded_section1_titles == ["【 대표이사 등의 확인 】"]
    assert parsed.text_preservation_rate > 0.9
