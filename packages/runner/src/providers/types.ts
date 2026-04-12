export type ProviderId = "claude" | "codex" | "gemini";

export interface ProviderStatus {
  readonly installed: boolean;
  readonly authenticated: boolean;
  readonly email?: string;
  readonly detail?: string;
}

export interface ProviderAuthResult {
  readonly success: boolean;
  /** Claude 전용: 브라우저에서 복사할 인증 URL */
  readonly authUrl?: string;
  readonly message?: string;
}

export interface ProviderAuthHandler {
  checkStatus(): Promise<ProviderStatus>;
  startAuth(): Promise<ProviderAuthResult>;
  /** Claude 전용: 웹에서 받은 코드를 stdin으로 전달 */
  submitCode?(code: string): Promise<ProviderAuthResult>;
}
