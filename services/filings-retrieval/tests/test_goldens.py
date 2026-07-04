"""골든 스냅샷 대조 — 캐시된 원문에서 재파싱한 섹션 트리가 커밋본과 일치해야 한다.

원문 zip은 gitignored라 캐시가 없는 환경(CI 등)에서는 skip.
"""

import json
from pathlib import Path

import pytest

from filings_retrieval.dart_client import DartClient
from filings_retrieval.document_parser import parse_document

SERVICE_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = SERVICE_DIR / "eval" / "fixtures" / "raw"
GOLDENS_DIR = SERVICE_DIR / "eval" / "goldens"

GOLDEN_STOCK_CODES = ("058470", "214150")  # 리노공업, 클래시스


def cache_ready() -> bool:
    return (RAW_DIR / "corpCode.zip").exists() and all(
        list(RAW_DIR.glob(f"{stock_code}_*.zip")) for stock_code in GOLDEN_STOCK_CODES
    )


@pytest.mark.skipif(not cache_ready(), reason="오프라인 원문 캐시 없음 (gitignored fixture)")
@pytest.mark.parametrize("stock_code", GOLDEN_STOCK_CODES)
def test_section_tree_matches_golden(stock_code):
    golden_path = GOLDENS_DIR / f"{stock_code}_section_tree.json"
    assert golden_path.exists(), f"골든 스냅샷 없음: {golden_path} — fetch_fixtures.py --regen-goldens"
    golden = json.loads(golden_path.read_text(encoding="utf-8"))

    client = DartClient(cache_dir=RAW_DIR, api_key=None)
    corp, meta, zip_path = client.get_report_package(stock_code)
    parsed = parse_document(zip_path, meta.rcept_no)

    assert meta.rcept_no == golden["rcept_no"]
    assert corp.corp_name == golden["corp_name"]
    assert parsed.max_depth == golden["max_depth"]
    assert [section.to_snapshot() for section in parsed.sections] == golden["section_tree"]
