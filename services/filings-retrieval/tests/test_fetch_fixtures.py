"""eval/fetch_fixtures.py 게이트 판정 로직 단위 검증 (반올림 오판 회귀)."""

import importlib.util
from pathlib import Path

_MODULE_PATH = Path(__file__).resolve().parent.parent / "eval" / "fetch_fixtures.py"
_SPEC = importlib.util.spec_from_file_location("fetch_fixtures", _MODULE_PATH)
fetch_fixtures = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(fetch_fixtures)


def test_gate_uses_unrounded_acceptance():
    # round(0.89996, 4) == 0.9 — 반올림값 판정이면 통과로 오판하는 경계값
    reasons = fetch_fixtures.gate_fail_reasons(0.89996, 10, 3)
    assert "acceptance-below-0.90" in reasons


def test_gate_passes_exactly_at_thresholds():
    assert fetch_fixtures.gate_fail_reasons(
        fetch_fixtures.ACCEPTANCE_THRESHOLD,
        fetch_fixtures.SECTION1_MIN,
        fetch_fixtures.TREE_DEPTH_MIN,
    ) == []


def test_gate_reports_all_fail_reasons():
    assert fetch_fixtures.gate_fail_reasons(0.5, 4, 1) == [
        "acceptance-below-0.90",
        "section1-below-5",
        "tree-depth-below-2",
    ]
