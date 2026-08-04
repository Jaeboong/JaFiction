#!/usr/bin/env python3
"""P0 fixture 하니스 — corps.txt 20개사 수집(캐시 우선)·파싱·청킹·게이트 판정.

실행 (서비스 디렉토리 어디서든, 경로는 스크립트 기준 상대 고정):
    .venv/bin/python eval/fetch_fixtures.py            # 캐시 모드 (네트워크 불필요)
    .venv/bin/python eval/fetch_fixtures.py --force    # 재수집 (DART_API_KEY 필요)
    .venv/bin/python eval/fetch_fixtures.py --regen-goldens

산출: eval/results.json + eval/report.md 전량 재생성 (+ --regen-goldens 시 eval/goldens/*).
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVICE_DIR))

from filings_retrieval.chunker import (  # noqa: E402
    CHUNKER_VERSION,
    chunk_document,
    normalize_title,
)
from filings_retrieval.dart_client import (  # noqa: E402
    DartClient,
    DartError,
    parse_corps_file,
)
from filings_retrieval.document_parser import (  # noqa: E402
    DocumentParseError,
    parse_document,
)

EVAL_DIR = SERVICE_DIR / "eval"
FIXTURES_DIR = EVAL_DIR / "fixtures"
RAW_DIR = FIXTURES_DIR / "raw"
CORPS_PATH = FIXTURES_DIR / "corps.txt"
RESULTS_PATH = EVAL_DIR / "results.json"
REPORT_PATH = EVAL_DIR / "report.md"
GOLDENS_DIR = EVAL_DIR / "goldens"

GOLDEN_STOCK_CODES = ("058470", "214150")  # 리노공업, 클래시스

ACCEPTANCE_THRESHOLD = 0.90
SECTION1_MIN = 5
TREE_DEPTH_MIN = 2
REQUIRED_COMPANY_PASSES = 18
BUSINESS_SECTION_KEY = "사업의내용"


def _business_section_found(section1_titles: list[str]) -> bool:
    return any(BUSINESS_SECTION_KEY in normalize_title(title) for title in section1_titles)


def gate_fail_reasons(acceptance: float, section1_count: int, tree_depth: int) -> list[str]:
    """회사별 게이트 판정 — acceptance는 반올림 전 진값으로 비교한다.

    round(0.89996, 4) == 0.9 라서 반올림값 판정은 경계 미달을 통과로 오판한다.
    """
    reasons: list[str] = []
    if acceptance < ACCEPTANCE_THRESHOLD:
        reasons.append("acceptance-below-0.90")
    if section1_count < SECTION1_MIN:
        reasons.append("section1-below-5")
    if tree_depth < TREE_DEPTH_MIN:
        reasons.append("tree-depth-below-2")
    return reasons


def evaluate_company(client: DartClient, spec, force: bool) -> dict:
    record: dict = {
        "stock_code": spec.stock_code,
        "category": spec.category,
        "corp_code": None,
        "corp_name": spec.name_hint,
        "rcept_no": None,
        "report_nm": None,
        "note": None,
        "parse_ok": False,
        "parse_mode": None,
        "text_acceptance_rate": None,
        "narrative_ratio": None,
        "text_preservation_rate": None,
        "section1_count": 0,
        "section1_titles": [],
        "tree_depth": 0,
        "chunk_count": 0,
        "chunk_length": None,
        "included_sections": [],
        "excluded_sections": [],
        "library_excluded_sections": [],
        "business_section_found": False,
        "gate_pass": False,
        "fail_reasons": [],
        "error": None,
    }
    try:
        corp, meta, zip_path = client.get_report_package(spec.stock_code, force=force)
    except DartError as exc:
        record["error"] = f"수집 실패: {exc}"
        record["fail_reasons"].append("fetch-error")
        return record
    record.update(
        corp_code=corp.corp_code,
        corp_name=corp.corp_name,
        rcept_no=meta.rcept_no,
        report_nm=meta.report_nm or None,
        note=meta.note,
    )
    try:
        parsed = parse_document(zip_path, meta.rcept_no)
    except DocumentParseError as exc:
        record["error"] = f"파싱 실패: {exc}"
        record["fail_reasons"].append("parse-error")
        return record
    result = chunk_document(parsed)
    lengths = sorted(len(chunk.text) for chunk in result.chunks)
    section1_titles = [section.title for section in parsed.sections]
    acceptance = result.text_acceptance_rate
    record.update(
        parse_ok=True,
        parse_mode=parsed.parse_mode,
        text_acceptance_rate=round(acceptance, 4),  # 표시/저장용 반올림
        narrative_ratio=(
            round(result.narrative_chars / parsed.doc_text_chars, 4)
            if parsed.doc_text_chars
            else None
        ),
        text_preservation_rate=round(parsed.text_preservation_rate, 4),
        section1_count=len(parsed.sections),
        section1_titles=section1_titles,
        tree_depth=parsed.max_depth,
        chunk_count=len(result.chunks),
        chunk_length=(
            {
                "min": lengths[0],
                "max": lengths[-1],
                "mean": round(statistics.fmean(lengths), 1),
                "median": int(statistics.median(lengths)),
            }
            if lengths
            else None
        ),
        included_sections=result.included_section1_titles,
        excluded_sections=result.excluded_section1_titles,
        library_excluded_sections=parsed.library_excluded_section1_titles,
        business_section_found=_business_section_found(section1_titles),
    )
    record["fail_reasons"].extend(
        gate_fail_reasons(acceptance, record["section1_count"], record["tree_depth"])
    )
    record["gate_pass"] = not record["fail_reasons"]
    return record


def build_gate(companies: list[dict]) -> dict:
    passed = sum(1 for company in companies if company["gate_pass"])
    parsed_companies = [company for company in companies if company["parse_ok"]]
    business_all = bool(parsed_companies) and all(
        company["business_section_found"] for company in parsed_companies
    )
    return {
        "pass": passed >= REQUIRED_COMPANY_PASSES and business_all,
        "companies_passed": passed,
        "companies_total": len(companies),
        "required_passes": REQUIRED_COMPANY_PASSES,
        "business_section_identified_in_all_parsed": business_all,
        "criteria": (
            f"회사별: acceptance ≥ {ACCEPTANCE_THRESHOLD} && SECTION-1 ≥ {SECTION1_MIN} && "
            f"트리 깊이 ≥ {TREE_DEPTH_MIN} / 전체: ≥{REQUIRED_COMPANY_PASSES}곳 통과 && "
            "파싱 성공 전 건에서 '사업의 내용' 대분류 식별"
        ),
    }


_FAIL_REASON_LABELS = {
    "fetch-error": "수집 실패 (corpCode 해석/원문 수신)",
    "parse-error": "본문 선택/파싱 실패",
    "acceptance-below-0.90": "텍스트 수용률 0.90 미달",
    "section1-below-5": "SECTION-1 식별 5개 미달",
    "tree-depth-below-2": "섹션 트리 깊이 2 미달",
}


def write_report(companies: list[dict], gate: dict) -> None:
    lines: list[str] = []
    verdict = "PASS" if gate["pass"] else "FAIL"
    lines.append("# DART 사업보고서 P0 — 수집·파싱·청킹 리포트")
    lines.append("")
    lines.append(f"- **게이트 판정: {verdict}** — 회사별 통과 "
                 f"{gate['companies_passed']}/{gate['companies_total']} "
                 f"(기준 ≥{gate['required_passes']}), '사업의 내용' 전 건 식별: "
                 f"{'예' if gate['business_section_identified_in_all_parsed'] else '아니오'}")
    lines.append(f"- 게이트 기준: {gate['criteria']}")
    lines.append(f"- chunker_version: `{CHUNKER_VERSION}` / 총 청크 수: "
                 f"{sum(company['chunk_count'] for company in companies):,}")
    lines.append("")
    lines.append("## 회사별 결과")
    lines.append("")
    lines.append(
        "| 회사 | 종목코드 | rcept_no | 파싱 | 수용률 | 서술부비율 | 보존율 | S1 | 깊이 "
        "| 청크수 | 길이 중앙값 | 판정 |"
    )
    lines.append("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for company in companies:
        chunk_length = company["chunk_length"] or {}
        lines.append(
            "| {corp_name} | {stock_code} | {rcept_no} | {parse} | {acc} | {narr} | {pres} "
            "| {s1} | {depth} | {chunks} | {median} | {verdict} |".format(
                corp_name=company["corp_name"],
                stock_code=company["stock_code"],
                rcept_no=company["rcept_no"] or "—",
                parse=(company["parse_mode"] or "실패"),
                acc=(f"{company['text_acceptance_rate']:.4f}"
                     if company["text_acceptance_rate"] is not None else "—"),
                narr=(f"{company['narrative_ratio']:.3f}"
                      if company["narrative_ratio"] is not None else "—"),
                pres=(f"{company['text_preservation_rate']:.3f}"
                      if company["text_preservation_rate"] is not None else "—"),
                s1=company["section1_count"],
                depth=company["tree_depth"],
                chunks=company["chunk_count"],
                median=chunk_length.get("median", "—"),
                verdict="통과" if company["gate_pass"] else "미달",
            )
        )
    lines.append("")
    lines.append("## 실패/미달 유형 분류")
    lines.append("")
    failing = [company for company in companies if not company["gate_pass"]]
    if not failing:
        lines.append("없음 — 20/20 회사별 게이트 통과.")
    else:
        for company in failing:
            reasons = ", ".join(
                _FAIL_REASON_LABELS.get(reason, reason) for reason in company["fail_reasons"]
            )
            error = f" — {company['error']}" if company["error"] else ""
            lines.append(f"- **{company['corp_name']}** ({company['stock_code']}): {reasons}{error}")
    lines.append("")
    notes = [company for company in companies if company["note"]]
    if notes:
        lines.append("## 수집 노트 (정정본 fallback 등)")
        lines.append("")
        for company in notes:
            lines.append(f"- {company['corp_name']} ({company['stock_code']}): {company['note']}")
        lines.append("")
    lines.append("## 측정 정의")
    lines.append("")
    lines.append(
        "- **수용률(text_acceptance_rate)** = 청크에 수용된 원문 기준 문자수 / A7 포함 대분류의 "
        "서술부 원문 텍스트 문자수. 분모는 섹션 서브트리 전체 텍스트(하위 섹션·자기 제목·CORRECTION"
        "·이미지 파일명 제외)를 청커 추출 경로와 **독립적으로** 산정한다. 분모가 셀/문단 경계 공백을 "
        "포함해 보수적(하한 추정)이며, 실측상 잔여 갭은 경계 공백 회계가 대부분이다."
    )
    lines.append(
        "- **서술부비율(narrative_ratio)** = A7 포함 대분류 서술부 문자수 / 문서 전체 텍스트 문자수"
        "(태그 제거, 트리와 독립 산정). 재무제표·감사의견 등 제외 대분류가 빠진 비율을 보여준다."
    )
    lines.append(
        "- **보존율(text_preservation_rate)** = 파싱 트리 전체 텍스트 / 태그 제거 원문 텍스트. "
        "recover 파싱의 침묵 부분손실(문서 중간 중단) 감지용 — 1.000 미만이면 파서 손실 의심."
    )
    lines.append(
        "- A7 제외 대분류: 재무에 관한 사항(요약재무정보 포함), 회계감사인의 감사의견, "
        "대표이사 등의 확인, 전문가의 확인, 목차. [기재정정] 문서의 LIBRARY 하위 SECTION-1"
        "(정정 전 원본 중복)도 제외. 섹션 내부 LIBRARY는 실제 콘텐츠 컨테이너라 포함."
    )
    lines.append("")
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def regen_goldens(client: DartClient) -> list[Path]:
    GOLDENS_DIR.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for stock_code in GOLDEN_STOCK_CODES:
        corp, meta, zip_path = client.get_report_package(stock_code)
        parsed = parse_document(zip_path, meta.rcept_no)
        snapshot = {
            "stock_code": stock_code,
            "corp_name": corp.corp_name,
            "rcept_no": meta.rcept_no,
            "max_depth": parsed.max_depth,
            "section_tree": [section.to_snapshot() for section in parsed.sections],
        }
        path = GOLDENS_DIR / f"{stock_code}_section_tree.json"
        path.write_text(
            json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        written.append(path)
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true",
                        help="캐시를 무시하고 재수집 (DART_API_KEY 필요)")
    parser.add_argument("--regen-goldens", action="store_true",
                        help="골든 회사 섹션 트리 스냅샷 재생성")
    args = parser.parse_args()

    specs = parse_corps_file(CORPS_PATH)
    client = DartClient(cache_dir=RAW_DIR)
    companies = []
    for spec in specs:
        record = evaluate_company(client, spec, force=args.force)
        status = "통과" if record["gate_pass"] else "미달"
        print(f"[{status}] {record['corp_name']} ({spec.stock_code}) "
              f"acceptance={record['text_acceptance_rate']} "
              f"S1={record['section1_count']} depth={record['tree_depth']} "
              f"chunks={record['chunk_count']}")
        companies.append(record)

    gate = build_gate(companies)
    results = {
        "chunker_version": CHUNKER_VERSION,
        "gate": gate,
        "companies": companies,
    }
    RESULTS_PATH.write_text(
        json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    write_report(companies, gate)
    print(f"\nresults: {RESULTS_PATH.relative_to(SERVICE_DIR)}")
    print(f"report:  {REPORT_PATH.relative_to(SERVICE_DIR)}")

    if args.regen_goldens:
        for path in regen_goldens(client):
            print(f"golden:  {path.relative_to(SERVICE_DIR)}")

    print(f"\nGATE: {'PASS' if gate['pass'] else 'FAIL'} "
          f"({gate['companies_passed']}/{gate['companies_total']})")
    return 0 if gate["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
