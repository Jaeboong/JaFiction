"""OpenDART 수집 클라이언트 — 캐시 우선, 네트워크는 명시적 최후 수단.

- DART_API_KEY는 env로만 읽는다. 네트워크가 필요한데 키가 없으면 명시 에러
  (조용한 실패 금지 — plan 원칙 4).
- list.json(pblntf_ty=A&pblntf_detail_ty=A001&last_reprt_at=Y)은 분기·반기보고서도
  섞어 반환하므로 report_nm에 "사업보고서" 포함 필터 후 rcept_no 최신 채택.
- [기재정정]/[첨부정정] rcept_no는 document.xml이 status 014(파일 없음)일 수 있음
  → last_reprt_at=N 재조회 후 후보 최신순으로 document.xml 시도, 첫 zip(PK 매직
  바이트) 채택 + note 기록. zip 아닌 응답은 <result><status> XML 에러로 분류.
- 요청당 2초 throttle (일일 쿼터 보호).
"""

from __future__ import annotations

import json
import os
import re
import time
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import urlencode
from urllib.request import urlopen
from xml.etree import ElementTree

from .models import CorpInfo, ReportMeta

DART_BASE_URL = "https://opendart.fss.or.kr/api"
THROTTLE_SECONDS = 2.0
BUSINESS_REPORT_KEYWORD = "사업보고서"
_STATUS_NO_FILE = "014"


class DartError(Exception):
    """DART 수집 관련 오류의 공통 베이스."""


class MissingApiKeyError(DartError):
    """네트워크 호출이 필요한데 DART_API_KEY가 없다."""


class DartApiError(DartError):
    """DART API가 에러 status를 반환했다."""

    def __init__(self, status: str, message: str):
        super().__init__(f"DART API 오류 status={status}: {message}")
        self.status = status
        self.message = message


def _default_http_get(url: str) -> bytes:
    with urlopen(url, timeout=60) as response:
        return response.read()


def classify_document_response(data: bytes) -> Optional[tuple[str, str]]:
    """zip이 아니면 <result><status>/<message>를 (status, message)로 분류."""
    if data[:2] == b"PK":
        return None
    try:
        root = ElementTree.fromstring(data.decode("utf-8", errors="replace").strip())
        status = (root.findtext(".//status") or "").strip()
        message = (root.findtext(".//message") or "").strip()
        if status:
            return status, message
    except ElementTree.ParseError:
        pass
    return ("unknown", f"zip도 XML 에러 응답도 아님 (선두 바이트: {data[:16]!r})")


class DartClient:
    def __init__(
        self,
        cache_dir: Path,
        api_key: Optional[str] = None,
        http_get: Callable[[str], bytes] = _default_http_get,
        sleep: Callable[[float], None] = time.sleep,
        throttle_seconds: float = THROTTLE_SECONDS,
    ):
        self.cache_dir = Path(cache_dir)
        self._api_key = api_key if api_key is not None else os.environ.get("DART_API_KEY")
        self._http_get = http_get
        self._sleep = sleep
        self._throttle_seconds = throttle_seconds
        self._last_request_at = 0.0
        self._corp_index: Optional[dict[str, CorpInfo]] = None

    # ── 네트워크 기반 (throttle + 명시 키 요구) ──────────────────────────

    def _require_key(self, purpose: str) -> str:
        if not self._api_key:
            raise MissingApiKeyError(
                f"{purpose}에 네트워크 호출이 필요하지만 DART_API_KEY 환경변수가 없다. "
                "캐시를 채우거나 키를 설정하라 (조용한 실패 금지)."
            )
        return self._api_key

    def _get(self, endpoint: str, purpose: str, **params: str) -> bytes:
        key = self._require_key(purpose)
        now = time.monotonic()
        wait = self._throttle_seconds - (now - self._last_request_at)
        if wait > 0:
            self._sleep(wait)
        self._last_request_at = time.monotonic()
        query = urlencode({"crtfc_key": key, **params})
        return self._http_get(f"{DART_BASE_URL}/{endpoint}?{query}")

    # ── corpCode 해석 ────────────────────────────────────────────────────

    def _corp_code_zip_path(self) -> Path:
        return self.cache_dir / "corpCode.zip"

    def load_corp_index(self) -> dict[str, CorpInfo]:
        """corpCode.zip(캐시 우선)에서 stock_code → CorpInfo 매핑을 만든다.

        같은 stock_code가 여러 corp에 매핑되면 modify_date 최신 우선.
        """
        if self._corp_index is not None:
            return self._corp_index
        path = self._corp_code_zip_path()
        if not path.exists():
            data = self._get("corpCode.xml", "corpCode 다운로드")
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        with zipfile.ZipFile(path) as archive:
            xml_bytes = archive.read("CORPCODE.xml")
        index: dict[str, CorpInfo] = {}
        for _, element in ElementTree.iterparse(BytesIO(xml_bytes)):
            if element.tag != "list":
                continue
            stock_code = (element.findtext("stock_code") or "").strip()
            if not stock_code:
                element.clear()
                continue
            info = CorpInfo(
                stock_code=stock_code,
                corp_code=(element.findtext("corp_code") or "").strip(),
                corp_name=(element.findtext("corp_name") or "").strip(),
                modify_date=(element.findtext("modify_date") or "").strip(),
            )
            existing = index.get(stock_code)
            if existing is None or info.modify_date > existing.modify_date:
                index[stock_code] = info
            element.clear()
        self._corp_index = index
        return index

    def resolve_corp(self, stock_code: str) -> CorpInfo:
        info = self.load_corp_index().get(stock_code)
        if info is None:
            raise DartError(f"corpCode.xml에서 종목코드 {stock_code}를 찾지 못했다")
        return info

    # ── 사업보고서 rcept_no 선택 ─────────────────────────────────────────

    def _list_reports(self, corp_code: str, last_reprt_at: str) -> list[dict]:
        data = self._get(
            "list.json",
            f"corp_code={corp_code} 공시목록 조회",
            corp_code=corp_code,
            bgn_de="20150101",
            pblntf_ty="A",
            pblntf_detail_ty="A001",
            last_reprt_at=last_reprt_at,
            page_no="1",
            page_count="100",
        )
        payload = json.loads(data.decode("utf-8"))
        status = payload.get("status")
        if status == "013":  # 조회 데이터 없음
            return []
        if status != "000":
            raise DartApiError(str(status), payload.get("message", ""))
        return list(payload.get("list", []))

    @staticmethod
    def _business_report_candidates(items: list[dict]) -> list[dict]:
        """report_nm에 "사업보고서" 포함만 남기고 rcept_no 최신순 정렬."""
        filtered = [
            item for item in items if BUSINESS_REPORT_KEYWORD in item.get("report_nm", "")
        ]
        return sorted(filtered, key=lambda item: item.get("rcept_no", ""), reverse=True)

    def fetch_document_zip(self, rcept_no: str) -> bytes:
        data = self._get(
            "document.xml", f"rcept_no={rcept_no} 원문 수신", rcept_no=rcept_no
        )
        error = classify_document_response(data)
        if error is not None:
            raise DartApiError(*error)
        return data

    def fetch_latest_business_report(self, corp_code: str) -> tuple[ReportMeta, bytes]:
        """최신 사업보고서 (메타, zip bytes). 정정본 014 시 원본 fallback."""
        latest = self._business_report_candidates(
            self._list_reports(corp_code, last_reprt_at="Y")
        )
        if not latest:
            raise DartError(f"corp_code={corp_code}: 사업보고서 공시를 찾지 못했다")
        chosen = latest[0]
        try:
            data = self.fetch_document_zip(chosen["rcept_no"])
            meta = ReportMeta(
                corp_code=corp_code,
                rcept_no=chosen["rcept_no"],
                report_nm=chosen.get("report_nm", ""),
                rcept_dt=chosen.get("rcept_dt", ""),
            )
            return meta, data
        except DartApiError as exc:
            if exc.status != _STATUS_NO_FILE:
                raise
        # 최종본(정정) rcept_no에 원문 파일이 없는 실측 케이스(014)
        # → last_reprt_at=N 재조회, 후보 최신순으로 첫 zip 채택.
        note = (
            f"최종본 rcept_no={chosen['rcept_no']} document.xml status 014 → "
            "last_reprt_at=N 원본으로 fallback"
        )
        for candidate in self._business_report_candidates(
            self._list_reports(corp_code, last_reprt_at="N")
        ):
            if candidate["rcept_no"] == chosen["rcept_no"]:
                continue
            try:
                data = self.fetch_document_zip(candidate["rcept_no"])
            except DartApiError as exc:
                if exc.status == _STATUS_NO_FILE:
                    continue
                raise
            meta = ReportMeta(
                corp_code=corp_code,
                rcept_no=candidate["rcept_no"],
                report_nm=candidate.get("report_nm", ""),
                rcept_dt=candidate.get("rcept_dt", ""),
                note=note,
            )
            return meta, data
        raise DartError(
            f"corp_code={corp_code}: 모든 사업보고서 후보가 document.xml 원문 없음(014)"
        )

    # ── 캐시 우선 패키지 획득 ────────────────────────────────────────────

    def _manifest_path(self) -> Path:
        return self.cache_dir / "manifest.json"

    def _load_manifest(self) -> list[dict]:
        path = self._manifest_path()
        if not path.exists():
            return []
        return json.loads(path.read_text(encoding="utf-8"))

    def _save_manifest(self, entries: list[dict]) -> None:
        entries = sorted(entries, key=lambda entry: entry.get("stock_code", ""))
        self._manifest_path().write_text(
            json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    def get_report_package(
        self, stock_code: str, force: bool = False
    ) -> tuple[CorpInfo, ReportMeta, Path]:
        """(corp, 보고서 메타, zip 경로). 캐시 히트 시 네트워크 없이 반환."""
        corp = self.resolve_corp(stock_code)
        manifest = self._load_manifest()
        if not force:
            cached = next(
                (entry for entry in manifest if entry.get("stock_code") == stock_code),
                None,
            )
            if cached is not None:
                zip_path = self.cache_dir / cached["zip"]
                if zip_path.exists():
                    meta = ReportMeta(
                        corp_code=cached.get("corp_code", corp.corp_code),
                        rcept_no=cached["rcept_no"],
                        report_nm=cached.get("report_nm", ""),
                        rcept_dt=cached.get("rcept_dt", ""),
                        note=cached.get("note"),
                    )
                    return corp, meta, zip_path
            globbed = sorted(self.cache_dir.glob(f"{stock_code}_*.zip"))
            if globbed:
                zip_path = globbed[-1]
                rcept_no = zip_path.stem.split("_")[-1]
                meta = ReportMeta(
                    corp_code=corp.corp_code,
                    rcept_no=rcept_no,
                    report_nm="",
                    rcept_dt="",
                    note="manifest 항목 없음 — zip 파일명에서 rcept_no 복원",
                )
                return corp, meta, zip_path
        meta, data = self.fetch_latest_business_report(corp.corp_code)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        zip_name = f"{stock_code}_{corp.corp_code}_{meta.rcept_no}.zip"
        zip_path = self.cache_dir / zip_name
        zip_path.write_bytes(data)
        entry = {
            "stock_code": stock_code,
            "corp_code": corp.corp_code,
            "corp_name": corp.corp_name,
            "report_nm": meta.report_nm,
            "rcept_no": meta.rcept_no,
            "rcept_dt": meta.rcept_dt,
            "zip": zip_name,
            "zip_bytes": len(data),
        }
        if meta.note:
            entry["note"] = meta.note
        manifest = [e for e in manifest if e.get("stock_code") != stock_code]
        manifest.append(entry)
        self._save_manifest(manifest)
        return corp, meta, zip_path


_CORPS_META_RE = re.compile(r"^#\s*(?P<meta>[^|]+\|[^|]+(?:\|.*)?)$")


def parse_corps_file(path: Path) -> list:
    """corps.txt 파싱: 6자리 종목코드 줄 + 직전 줄 메타 코멘트.

    메타 코멘트 포맷: "# <카테고리> | <회사명> | <비고>" (posting urls.txt 관례).
    그 외 코멘트/빈 줄은 무시.
    """
    from .models import CorpSpec

    specs: list[CorpSpec] = []
    pending_meta: Optional[tuple[str, str, Optional[str]]] = None
    for raw_line in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            pending_meta = None
            continue
        if line.startswith("#"):
            match = _CORPS_META_RE.match(line)
            if match:
                fields = [field.strip() for field in match.group("meta").split("|")]
                if len(fields) >= 2:
                    pending_meta = (
                        fields[0],
                        fields[1],
                        fields[2] if len(fields) > 2 and fields[2] else None,
                    )
                    continue
            pending_meta = None
            continue
        if re.fullmatch(r"\d{6}", line):
            category, name_hint, comment = pending_meta or ("", "", None)
            specs.append(
                CorpSpec(
                    stock_code=line,
                    category=category,
                    name_hint=name_hint,
                    comment=comment,
                )
            )
            pending_meta = None
    return specs
