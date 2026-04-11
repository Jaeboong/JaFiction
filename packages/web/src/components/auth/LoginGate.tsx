/**
 * LoginGate — Stage 11.5
 *
 * Rendered when bootstrap fails with reason "auth_required". Surfaces a
 * single CTA to begin the Google OAuth flow at /auth/google. No client
 * dependency — safe to render before the RunnerClient exists.
 */
import type { ReactNode } from "react";

export interface LoginGateProps {
  readonly loginHref?: string;
  readonly heading?: string;
  readonly description?: ReactNode;
}

const DEFAULT_LOGIN_HREF = "/auth/google";

export function LoginGate({
  loginHref = DEFAULT_LOGIN_HREF,
  heading = "로그인이 필요합니다.",
  description = "Jasojeon hosted 서비스를 사용하려면 Google 계정으로 로그인해 주세요."
}: LoginGateProps) {
  return (
    <section className="app-gate app-gate-auth" aria-labelledby="login-gate-heading">
      <p className="app-gate-kicker">Jasojeon</p>
      <h1 id="login-gate-heading">{heading}</h1>
      <p className="app-gate-description">{description}</p>
      <a className="app-gate-cta" href={loginHref} data-testid="login-gate-cta">
        Google 계정으로 로그인
      </a>
    </section>
  );
}
