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
      body: <Body>Claude, GPT, Codex 중 원하는 AI 를 붙여서 나만의 에이전트로 씁니다</Body>
    },
    {
      id: "overview-3",
      title: "지원서 단위 관리",
      body: <Body>회사/공고마다 지원서를 만들어 문서/분석/대화를 한 곳에</Body>
    },
    {
      id: "overview-4",
      title: "컨텍스트 업로드 + 인사이트 자동 생성",
      body: <Body>이력서·포트폴리오 업로드 → AI 가 회사/직무 인사이트 생성</Body>
    },
    {
      id: "overview-5",
      title: "에이전트 대화로 자소서 완성",
      body: <Body>실행 탭에서 AI 와 대화하며 자소서를 씁니다</Body>
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
    title: "왜 프로바이더인가",
    body: <Body>사용자 계정으로 AI 호출, 비용/속도/모델 자유</Body>
  },
  {
    id: "providers-2",
    title: "지원 프로바이더",
    body: <Body>Claude Code / Codex / Gemini / Notion MCP</Body>
  },
  {
    id: "providers-3",
    title: "CLI 설치 + 인증",
    body: <Body>설치 후 자소전에서 "연결 테스트" 버튼 누르면 상태 자동 감지</Body>
  },
  {
    id: "providers-4",
    title: "Notion 연동 (선택)",
    body: <Body>컨텍스트 문서를 Notion 페이지로 가져오기</Body>
  }
];

// ── Projects Intro (6장) ──────────────────────────────────────────────────────

export const PROJECTS_INTRO_SLIDES: readonly OnboardingSlide[] = [
  {
    id: "projects-1",
    title: "지원서 만들기",
    body: <Body>우측 "새 지원서" 버튼</Body>
  },
  {
    id: "projects-2",
    title: "공고 URL 붙여넣고 자동 분석",
    body: <Body>"공고 분석" 버튼</Body>
  },
  {
    id: "projects-3",
    title: "자소서 문항 입력",
    body: <Body>공고에 있는 문항들</Body>
  },
  {
    id: "projects-4",
    title: "이력서·포트폴리오 업로드",
    body: <Body>드래그&드롭 또는 "+ 파일 추가"</Body>
  },
  {
    id: "projects-5",
    title: "인사이트 생성 버튼",
    body: <Body>30초~2분 소요, 기다리는 동안 다른 작업 가능</Body>
  },
  {
    id: "projects-6",
    title: "인사이트 결과 보기 + 재생성",
    body: <Body>생성된 인사이트를 확인하고 필요하면 재생성할 수 있습니다</Body>
  }
];

// ── Runs Intro (5장) ──────────────────────────────────────────────────────────

export const RUNS_INTRO_SLIDES: readonly OnboardingSlide[] = [
  {
    id: "runs-1",
    title: "에이전트 대화란",
    body: <Body>지원서의 인사이트 + 문서를 바탕으로 AI 와 대화</Body>
  },
  {
    id: "runs-2",
    title: "러너 상태 확인",
    body: <Body>상단 "LOCAL ENGINE ONLINE" 표시</Body>
  },
  {
    id: "runs-3",
    title: "대화 시작",
    body: <Body>지원서 선택 → 프로바이더 선택 → 문항 선택</Body>
  },
  {
    id: "runs-4",
    title: "실시간 스트리밍 / 중간 개입",
    body: <Body>사용자가 방향 전환 가능</Body>
  },
  {
    id: "runs-5",
    title: "완료 후 결과 저장 + 자소서 복사",
    body: <Body>생성된 자소서를 저장하고 복사해서 사용합니다</Body>
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
      body: <Body>한번 보시고 실행 탭에서 AI 와 대화를 시작하세요</Body>,
      primaryAction: { label: "실행 탭으로", onClick: options.onGoToRuns }
    }
  ];
}
