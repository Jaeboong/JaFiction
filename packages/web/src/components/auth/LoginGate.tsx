export interface LoginGateProps {
  readonly loginHref?: string;
}

const DEFAULT_LOGIN_HREF = "/auth/google";

export function LoginGate({ loginHref = DEFAULT_LOGIN_HREF }: LoginGateProps) {
  return (
    <div className="login-page" aria-label="로그인">
      {/* 왼쪽 — 브랜드 패널 */}
      <div className="login-brand-panel">
        <div className="login-brand-inner">
          <div className="login-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none">
              <rect x="6" y="8" width="36" height="32" rx="3" fill="white" fillOpacity="0.15" />
              <rect x="6" y="8" width="17" height="32" rx="3" fill="white" fillOpacity="0.25" />
              <line x1="23" y1="8" x2="23" y2="40" stroke="white" strokeOpacity="0.5" strokeWidth="1.5" />
              <line x1="12" y1="17" x2="20" y2="17" stroke="white" strokeOpacity="0.6" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="12" y1="22" x2="20" y2="22" stroke="white" strokeOpacity="0.6" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="12" y1="27" x2="18" y2="27" stroke="white" strokeOpacity="0.6" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="27" y1="17" x2="38" y2="17" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="27" y1="22" x2="38" y2="22" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="27" y1="27" x2="34" y2="27" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="login-brand-name">자소전</h1>
          <p className="login-brand-tagline">
            이력서 분석부터 기업 조사까지<br />
            AI가 취업 준비의 전 과정을 자동화합니다.
          </p>
        </div>
      </div>

      {/* 오른쪽 — 로그인 패널 */}
      <div className="login-form-panel">
        <div className="login-form-inner">
          <p className="login-form-kicker">자소전</p>
          <h2 className="login-form-heading">시작하기</h2>
          <p className="login-form-desc">Google 계정으로 로그인하면 바로 사용할 수 있습니다.</p>
          <a className="google-signin-btn" href={loginHref} data-testid="login-gate-cta">
            <svg className="google-signin-logo" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            <span>Google 계정으로 로그인</span>
          </a>
        </div>
      </div>
    </div>
  );
}
