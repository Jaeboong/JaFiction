"""dart_client 단위 검증 — corpCode 해석·보고서 선택·014 fallback·throttle·키 부재."""

import io
import json
import zipfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

from filings_retrieval.dart_client import (
    DartApiError,
    DartClient,
    DartError,
    MissingApiKeyError,
    classify_document_response,
    parse_corps_file,
)

FIXTURES_CORPS = Path(__file__).resolve().parent.parent / "eval" / "fixtures" / "corps.txt"


def make_corp_code_zip(entries: list[dict]) -> bytes:
    items = "".join(
        "<list>"
        f"<corp_code>{entry['corp_code']}</corp_code>"
        f"<corp_name>{entry['corp_name']}</corp_name>"
        f"<stock_code>{entry.get('stock_code', '')}</stock_code>"
        f"<modify_date>{entry['modify_date']}</modify_date>"
        "</list>"
        for entry in entries
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("CORPCODE.xml", f"<result>{items}</result>")
    return buffer.getvalue()


def write_corp_code_cache(cache_dir: Path, entries: list[dict]) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    (cache_dir / "corpCode.zip").write_bytes(make_corp_code_zip(entries))


# ── corps.txt 파서 ───────────────────────────────────────────────────────


def test_parse_corps_file_synthetic(tmp_path):
    path = tmp_path / "corps.txt"
    path.write_text(
        "# 헤더 설명 코멘트 (메타 아님)\n"
        "# 포맷: 각 값 줄 위에 \"# <카테고리> | <회사명> | <비고>\" 메타 코멘트\n"
        "\n"
        "# KOSPI대형 | 삼성전자 | 초대형 보고서\n"
        "005930\n"
        "# KOSDAQ중견 | 리노공업\n"
        "058470\n"
        "\n"
        "123456\n",
        encoding="utf-8",
    )
    specs = parse_corps_file(path)
    assert [spec.stock_code for spec in specs] == ["005930", "058470", "123456"]
    assert specs[0].category == "KOSPI대형"
    assert specs[0].name_hint == "삼성전자"
    assert specs[0].comment == "초대형 보고서"
    assert specs[1].comment is None
    assert specs[2].category == ""  # 메타 코멘트 없는 값 줄


def test_parse_corps_file_committed_fixture():
    specs = parse_corps_file(FIXTURES_CORPS)
    assert len(specs) == 20
    by_code = {spec.stock_code: spec for spec in specs}
    assert by_code["005930"].name_hint == "삼성전자"
    assert by_code["105560"].category == "금융"
    assert all(spec.category for spec in specs)


# ── corpCode 해석 ────────────────────────────────────────────────────────


def test_resolve_corp_prefers_latest_modify_date(tmp_path):
    write_corp_code_cache(
        tmp_path,
        [
            {"corp_code": "00000001", "corp_name": "옛법인", "stock_code": "005930",
             "modify_date": "20200101"},
            {"corp_code": "00126380", "corp_name": "삼성전자", "stock_code": "005930",
             "modify_date": "20260101"},
            {"corp_code": "00000002", "corp_name": "비상장", "modify_date": "20260101"},
        ],
    )
    client = DartClient(cache_dir=tmp_path, api_key=None)
    corp = client.resolve_corp("005930")
    assert corp.corp_code == "00126380"
    assert corp.corp_name == "삼성전자"


def test_resolve_unknown_stock_code_raises(tmp_path):
    write_corp_code_cache(tmp_path, [])
    client = DartClient(cache_dir=tmp_path, api_key=None)
    with pytest.raises(DartError, match="999999"):
        client.resolve_corp("999999")


def test_missing_key_is_explicit_error_when_network_needed(tmp_path):
    client = DartClient(cache_dir=tmp_path, api_key=None)  # corpCode.zip 캐시 없음
    with pytest.raises(MissingApiKeyError, match="DART_API_KEY"):
        client.load_corp_index()


# ── 응답 분류 ────────────────────────────────────────────────────────────


def test_classify_document_response():
    assert classify_document_response(b"PK\x03\x04zipdata") is None
    status = classify_document_response(
        "<result><status>014</status><message>파일이 존재하지 않습니다.</message></result>".encode()
    )
    assert status == ("014", "파일이 존재하지 않습니다.")
    unknown = classify_document_response(b"garbage")
    assert unknown is not None and unknown[0] == "unknown"


# ── list.json 선택 + 014 fallback ────────────────────────────────────────


class FakeDart:
    """URL 패턴별 canned 응답 + 호출 기록."""

    def __init__(self, list_y, list_n, documents):
        self.list_y = list_y
        self.list_n = list_n
        self.documents = documents
        self.calls: list[str] = []

    def __call__(self, url: str) -> bytes:
        self.calls.append(url)
        parsed = urlparse(url)
        params = {key: values[0] for key, values in parse_qs(parsed.query).items()}
        if parsed.path.endswith("/list.json"):
            items = self.list_y if params["last_reprt_at"] == "Y" else self.list_n
            return json.dumps({"status": "000", "list": items}).encode()
        if parsed.path.endswith("/document.xml"):
            return self.documents[params["rcept_no"]]
        raise AssertionError(f"unexpected url: {url}")


ERROR_014 = "<result><status>014</status><message>없음</message></result>".encode()


def test_business_report_filter_and_latest_selection(tmp_path):
    fake = FakeDart(
        list_y=[
            {"rcept_no": "20260514000001", "report_nm": "분기보고서 (2026.03)",
             "rcept_dt": "20260514"},
            {"rcept_no": "20260318000182", "report_nm": "사업보고서 (2025.12)",
             "rcept_dt": "20260318"},
            {"rcept_no": "20250315000100", "report_nm": "사업보고서 (2024.12)",
             "rcept_dt": "20250315"},
            {"rcept_no": "20250814000200", "report_nm": "반기보고서 (2025.06)",
             "rcept_dt": "20250814"},
        ],
        list_n=[],
        documents={"20260318000182": b"PK\x03\x04main"},
    )
    client = DartClient(cache_dir=tmp_path, api_key="k", http_get=fake, sleep=lambda _: None)
    meta, data = client.fetch_latest_business_report("00369657")
    assert meta.rcept_no == "20260318000182"  # 분기·반기 제외, 사업보고서 최신
    assert meta.note is None
    assert data.startswith(b"PK")


def test_014_falls_back_to_original_with_note(tmp_path):
    # 실측(한화에어로·KB금융·삼성화재): 최종본(정정) rcept_no가 document.xml 014
    fake = FakeDart(
        list_y=[
            {"rcept_no": "20260501000900", "report_nm": "[기재정정]사업보고서 (2025.12)",
             "rcept_dt": "20260501"},
        ],
        list_n=[
            {"rcept_no": "20260501000900", "report_nm": "[기재정정]사업보고서 (2025.12)",
             "rcept_dt": "20260501"},
            {"rcept_no": "20260316001112", "report_nm": "사업보고서 (2025.12)",
             "rcept_dt": "20260316"},
        ],
        documents={"20260501000900": ERROR_014, "20260316001112": b"PK\x03\x04orig"},
    )
    client = DartClient(cache_dir=tmp_path, api_key="k", http_get=fake, sleep=lambda _: None)
    meta, data = client.fetch_latest_business_report("00126566")
    assert meta.rcept_no == "20260316001112"
    assert meta.note and "014" in meta.note
    assert data == b"PK\x03\x04orig"


def test_all_candidates_014_raises(tmp_path):
    fake = FakeDart(
        list_y=[{"rcept_no": "1", "report_nm": "사업보고서", "rcept_dt": ""}],
        list_n=[{"rcept_no": "1", "report_nm": "사업보고서", "rcept_dt": ""}],
        documents={"1": ERROR_014},
    )
    client = DartClient(cache_dir=tmp_path, api_key="k", http_get=fake, sleep=lambda _: None)
    with pytest.raises(DartError, match="014"):
        client.fetch_latest_business_report("00000000")


def test_non_zip_non_014_error_classified(tmp_path):
    fake = FakeDart(
        list_y=[{"rcept_no": "2", "report_nm": "사업보고서", "rcept_dt": ""}],
        list_n=[],
        documents={
            "2": "<result><status>020</status><message>쿼터 초과</message></result>".encode()
        },
    )
    client = DartClient(cache_dir=tmp_path, api_key="k", http_get=fake, sleep=lambda _: None)
    with pytest.raises(DartApiError, match="020"):
        client.fetch_latest_business_report("00000000")


def test_throttle_sleeps_between_requests(tmp_path):
    fake = FakeDart(
        list_y=[{"rcept_no": "3", "report_nm": "사업보고서", "rcept_dt": ""}],
        list_n=[],
        documents={"3": b"PK\x03\x04x"},
    )
    sleeps: list[float] = []
    client = DartClient(
        cache_dir=tmp_path, api_key="k", http_get=fake, sleep=sleeps.append,
        throttle_seconds=2.0,
    )
    client.fetch_latest_business_report("00000000")  # list.json + document.xml 2회 호출
    assert len(fake.calls) == 2
    assert sleeps and all(0 < wait <= 2.0 for wait in sleeps)


# ── 캐시 우선 패키지 획득 ────────────────────────────────────────────────


def test_get_report_package_cache_hit_needs_no_network(tmp_path):
    write_corp_code_cache(
        tmp_path,
        [{"corp_code": "00369657", "corp_name": "리노공업", "stock_code": "058470",
          "modify_date": "20260101"}],
    )
    (tmp_path / "058470_00369657_20260318000182.zip").write_bytes(b"PK\x03\x04cached")
    (tmp_path / "manifest.json").write_text(
        json.dumps(
            [{"stock_code": "058470", "corp_code": "00369657", "corp_name": "리노공업",
              "report_nm": "사업보고서 (2025.12)", "rcept_no": "20260318000182",
              "rcept_dt": "20260318", "zip": "058470_00369657_20260318000182.zip"}],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    def no_network(url):
        raise AssertionError(f"캐시 히트인데 네트워크 호출 발생: {url}")

    client = DartClient(cache_dir=tmp_path, api_key=None, http_get=no_network)
    corp, meta, zip_path = client.get_report_package("058470")
    assert corp.corp_name == "리노공업"
    assert meta.rcept_no == "20260318000182"
    assert meta.report_nm == "사업보고서 (2025.12)"
    assert zip_path.read_bytes() == b"PK\x03\x04cached"


def test_get_report_package_fetches_and_updates_manifest(tmp_path):
    write_corp_code_cache(
        tmp_path,
        [{"corp_code": "00369657", "corp_name": "리노공업", "stock_code": "058470",
          "modify_date": "20260101"}],
    )
    fake = FakeDart(
        list_y=[{"rcept_no": "20260318000182", "report_nm": "사업보고서 (2025.12)",
                 "rcept_dt": "20260318"}],
        list_n=[],
        documents={"20260318000182": b"PK\x03\x04fresh"},
    )
    client = DartClient(cache_dir=tmp_path, api_key="k", http_get=fake, sleep=lambda _: None)
    corp, meta, zip_path = client.get_report_package("058470")
    assert zip_path.name == "058470_00369657_20260318000182.zip"
    assert zip_path.read_bytes() == b"PK\x03\x04fresh"
    manifest = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
    assert manifest[0]["stock_code"] == "058470"
    assert manifest[0]["rcept_no"] == "20260318000182"
