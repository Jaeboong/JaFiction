import type { ReactNode } from "react";
import type { OnboardingSlide } from "./SlideModal";

// ── helpers ──────────────────────────────────────────────────────────────────

function Body({ children }: { readonly children: ReactNode }) {
  return <p style={{ margin: 0, lineHeight: 1.65 }}>{children}</p>;
}

// ── Overview Deck (6장) ───────────────────────────────────────────────────────

export function buildOverviewDeckSlides(options: {
  hasHealthyProvider: boolean;
  onGoToProviders: () => void;
  onGoToProjects: () => void;
}): readonly OnboardingSlide[] {
  const ctaLabel = options.hasHealthyProvider ? "지원서 만들기" : "프로바이더 연결하기";
  const ctaAction = options.hasHealthyProvider ? options.onGoToProjects : options.onGoToProviders;

  return [
    {
      id: "overview-1",
      title: "환영합니다",
      image: "/jasojeon.png",
      body: <Body>자소전은 AI 로 취업 준비 전 과정을 자동화합니다</Body>
    },
    {
      id: "overview-2",
      title: "AI 프로바이더 연결",
      image: "/onboarding/overview_2.webp",
      body: <Body>Claude Code, Codex, Gemini 중 원하는 CLI 를 연결해서 나만의 에이전트로 씁니다. 프로바이더 탭에서 설치/인증 상태를 한눈에 확인</Body>
    },
    {
      id: "overview-3",
      title: "지원서 단위 관리",
      image: "/onboarding/overview_3.png",
      body: <Body>회사/공고마다 지원서를 만들어 공고·문항·문서·분석 결과를 한 곳에서 관리합니다</Body>
    },
    {
      id: "overview-4",
      title: "컨텍스트 업로드 + 인사이트 자동 생성",
      image: "/onboarding/overview_4.png",
      body: <Body>이력서·포트폴리오 업로드 후 인사이트 생성 버튼을 누르면 OpenDART 재무 데이터까지 포함된 회사·직무 분석이 자동 생성됩니다</Body>
    },
    {
      id: "overview-5",
      title: "에이전트 대화로 자소서 완성",
      image: "/onboarding/overview_5.webp",
      body: <Body>실행 탭에서 여러 역할의 AI 에이전트가 돌아가며 자소서를 함께 작성합니다</Body>
    },
    {
      id: "overview-6",
      title: "시작해 볼까요?",
      body: <Body>모든 준비가 됐습니다. 지금 바로 시작해 보세요.</Body>,
      primaryAction: { label: ctaLabel, onClick: ctaAction }
    }
  ];
}

// ── Providers Intro (4장) ─────────────────────────────────────────────────────

export const PROVIDERS_INTRO_SLIDES: readonly OnboardingSlide[] = [
  {
    id: "providers-1",
    title: "AI 비용은 0원",
    image: "/onboarding/provider_1.webp",
    body: <Body>타 서비스는 월 구독료를 받지만, 자소전은 여러분의 AI 계정을 직접 연결합니다. 중간 마진 없이, 쓴 만큼만.</Body>
  },
  {
    id: "providers-2",
    title: "지원 프로바이더",
    image: "/onboarding/providers-list.webp",
    body: <Body>Claude Code · Codex · Gemini 중 원하는 CLI 를 연결합니다. 좌측 사이드바에서 프로바이더를 선택해 설정</Body>
  },
  {
    id: "providers-3",
    title: "CLI 설치 + 인증",
    image: "/onboarding/provider_3.webp",
    body: <Body>CLI 를 설치하고 "테스트" 버튼을 누르면 INSTALLED · VALID 상태가 자동으로 표시됩니다</Body>
  },
  {
    id: "providers-4",
    title: "Notion 연동 (선택)",
    image: "/onboarding/provider_4.webp",
    body: <Body>Notion MCP 를 연결하면 컨텍스트 문서를 Notion 페이지에서 직접 가져올 수 있습니다</Body>
  }
];

// ── Projects Intro (6장) ──────────────────────────────────────────────────────

export const PROJECTS_INTRO_SLIDES: readonly OnboardingSlide[] = [
  {
    id: "projects-1",
    title: "지원서 만들기",
    image: "/onboarding/apply_1.webp",
    body: <Body>좌측 상단 "새 지원서" 버튼으로 회사/공고별 지원서를 만듭니다</Body>
  },
  {
    id: "projects-2",
    title: "공고 URL 붙여넣고 자동 분석",
    image: "/onboarding/apply_2.webp",
    body: <Body>공고 URL 을 붙여넣고 "공고 분석" 버튼을 누르면 회사·직무·자소서 문항이 자동으로 파싱됩니다</Body>
  },
  {
    id: "projects-3",
    title: "자소서 문항 입력",
    image: "/onboarding/apply_3.webp",
    body: <Body>공고에 있는 자소서 문항이 자동으로 등록되며, 직접 수정·추가도 가능합니다</Body>
  },
  {
    id: "projects-4",
    title: "이력서·포트폴리오 업로드",
    image: "/onboarding/apply_4.webp",
    body: <Body>"+ 파일 추가" 또는 드래그&드롭으로 이력서/포트폴리오 PDF·이미지를 업로드합니다. PDF 텍스트는 자동 추출</Body>
  },
  {
    id: "projects-5",
    title: "인사이트 생성 버튼",
    image: "/onboarding/apply_5.webp",
    body: <Body>"인사이트 생성" 버튼을 누르면 회사 분석·직무 분석·지원 전략·문항 분석이 30초~2분 내에 자동 생성됩니다</Body>
  },
  {
    id: "projects-6",
    title: "인사이트 결과 보기 + 재생성",
    image: "/onboarding/insights-modal-crop.webp",
    body: <Body>생성된 인사이트에는 OpenDART 재무 데이터가 포함되며, 필요하면 언제든 재생성할 수 있습니다</Body>
  }
];

// ── Runs Intro (5장) ──────────────────────────────────────────────────────────

export const RUNS_INTRO_SLIDES: readonly OnboardingSlide[] = [
  {
    id: "runs-1",
    title: "에이전트 대화란",
    image: "/onboarding/runs-main.webp",
    body: <Body>선택한 지원서의 인사이트 + 컨텍스트 문서를 바탕으로 여러 역할의 AI 가 돌아가며 자소서를 작성합니다</Body>
  },
  {
    id: "runs-2",
    title: "러너 상태 확인",
    image: "/onboarding/runs-main.webp",
    body: <Body>화면 하단의 "LOCAL ENGINE ONLINE" 이 보이면 준비 완료입니다</Body>
  },
  {
    id: "runs-3",
    title: "대화 시작",
    image: "/onboarding/runs-main.webp",
    body: <Body>대상 지원서 → 문항 → 역할별 프로바이더 선택 후 ▶ 실행 시작 버튼을 누릅니다</Body>
  },
  {
    id: "runs-4",
    title: "실시간 스트리밍 / 중간 개입",
    image: "/onboarding/runs-main.webp",
    body: <Body>AI 응답이 실시간으로 스트리밍되며, 중간에 개입 메시지를 보내 방향을 전환할 수 있습니다</Body>
  },
  {
    id: "runs-5",
    title: "완료 후 결과 저장 + 자소서 복사",
    image: "/onboarding/runs-main.webp",
    body: <Body>완성된 자소서는 자동 저장되며, 복사해서 지원서에 바로 활용할 수 있습니다</Body>
  }
];

// ── Insights Ready (1장) ──────────────────────────────────────────────────────

export function buildInsightsReadySlides(options: {
  onGoToRuns: () => void;
}): readonly OnboardingSlide[] {
  return [
    {
      id: "insights-ready-1",
      title: "인사이트가 준비됐어요",
      image: "/onboarding/insights-modal-crop.webp",
      body: <Body>한번 보시고 실행 탭에서 AI 와 대화를 시작하세요</Body>,
      primaryAction: { label: "실행 탭으로", onClick: options.onGoToRuns }
    }
  ];
}
