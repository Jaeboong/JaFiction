import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";

const notionOAuthMetadataUrl = "https://mcp.notion.com/.well-known/oauth-authorization-server";
const notionRegisterEndpoint = "https://mcp.notion.com/register";
const notionAuthorizeEndpoint = "https://mcp.notion.com/authorize";
const notionTokenEndpoint = "https://mcp.notion.com/token";
const notionMcpServerUrl = "https://mcp.notion.com/mcp";
const callbackPath = "/callback";
const defaultTimeoutMs = 5 * 60 * 1000;

export interface OAuthAuthorizationServerMetadata {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
}

export interface OAuthClientRegistrationRequest {
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
  client_name: string;
}

export interface OAuthClientRegistrationResponse {
  client_id: string;
}

export interface OAuthTokenEndpointResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
  scope?: string;
}

export interface StoredOAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
  scope?: string;
}

export interface StoredOAuthCredential {
  serverName: string;
  token: StoredOAuthToken;
  clientId?: string;
  tokenUrl?: string;
  mcpServerUrl?: string;
  updatedAt: number;
}

interface OAuthCallbackResponse {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

interface OAuthCallbackServer {
  callbackUrl: string;
  waitForCallback(timeoutMs: number): Promise<OAuthCallbackResponse>;
  close(): Promise<void>;
}

interface TokenExchangeRequest {
  grant_type: "authorization_code";
  code: string;
  redirect_uri: string;
  client_id: string;
  code_verifier: string;
}

interface GeminiNotionOAuthDependencies {
  now(): number;
  homedir(): string;
  fetchAuthorizationServerMetadata(url: string): Promise<OAuthAuthorizationServerMetadata>;
  registerClient(url: string, request: OAuthClientRegistrationRequest): Promise<OAuthClientRegistrationResponse>;
  exchangeAuthorizationCode(url: string, request: TokenExchangeRequest): Promise<OAuthTokenEndpointResponse>;
  createCallbackServer(): Promise<OAuthCallbackServer>;
  openBrowser(url: string): Promise<void>;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, contents: string, mode: number): Promise<void>;
  mkdir(dirPath: string): Promise<void>;
  chmod(filePath: string, mode: number): Promise<void>;
}

export interface PerformGeminiNotionOAuthOptions {
  timeoutMs?: number;
  dependencies?: Partial<GeminiNotionOAuthDependencies>;
}

const defaultDependencies: GeminiNotionOAuthDependencies = {
  now: () => Date.now(),
  homedir: () => os.homedir(),
  fetchAuthorizationServerMetadata: async (url) => {
    return requestJson<OAuthAuthorizationServerMetadata>("GET", url);
  },
  registerClient: async (url, request) => {
    return requestJson<OAuthClientRegistrationResponse>(
      "POST",
      url,
      JSON.stringify(request),
      {
        "Content-Type": "application/json"
      }
    );
  },
  exchangeAuthorizationCode: async (url, request) => {
    const form = new URLSearchParams();
    form.set("grant_type", request.grant_type);
    form.set("code", request.code);
    form.set("redirect_uri", request.redirect_uri);
    form.set("client_id", request.client_id);
    form.set("code_verifier", request.code_verifier);
    return requestJson<OAuthTokenEndpointResponse>(
      "POST",
      url,
      form.toString(),
      {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    );
  },
  createCallbackServer: createLocalCallbackServer,
  openBrowser: openBrowser,
  readFile: async (filePath) => fs.readFile(filePath, "utf8"),
  writeFile: async (filePath, contents, mode) => {
    await fs.writeFile(filePath, contents, { mode });
  },
  mkdir: async (dirPath) => {
    await fs.mkdir(dirPath, { recursive: true });
  },
  chmod: async (filePath, mode) => {
    await fs.chmod(filePath, mode);
  }
};

export function createCodeVerifier(byteLength = 64): string {
  return randomBytes(byteLength).toString("base64url");
}

export function createCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export function createOAuthState(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

export function buildAuthorizationUrl(input: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}): string {
  const url = new URL(input.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export function toStoredOAuthToken(
  response: OAuthTokenEndpointResponse,
  nowMs: number
): StoredOAuthToken {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: typeof response.expires_in === "number"
      ? nowMs + (response.expires_in * 1000)
      : undefined,
    tokenType: response.token_type,
    scope: response.scope
  };
}

export function upsertStoredOAuthCredential(
  credentials: StoredOAuthCredential[],
  nextCredential: StoredOAuthCredential
): StoredOAuthCredential[] {
  const existingIndex = credentials.findIndex((credential) => credential.serverName === nextCredential.serverName);
  if (existingIndex === -1) {
    return [...credentials, nextCredential];
  }

  return credentials.map((credential, index) => index === existingIndex ? nextCredential : credential);
}

export function getGeminiMcpOauthTokenFilePath(homeDir: string): string {
  return path.join(homeDir, ".gemini", "mcp-oauth-tokens.json");
}

export async function performGeminiNotionOAuth(
  serverName: string,
  options: PerformGeminiNotionOAuthOptions = {}
): Promise<void> {
  const dependencies: GeminiNotionOAuthDependencies = {
    ...defaultDependencies,
    ...options.dependencies
  };
  const callbackServer = await dependencies.createCallbackServer();
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;

  try {
    const metadata = await dependencies.fetchAuthorizationServerMetadata(notionOAuthMetadataUrl);
    const registrationEndpoint = metadata.registration_endpoint ?? notionRegisterEndpoint;
    const authorizationEndpoint = metadata.authorization_endpoint ?? notionAuthorizeEndpoint;
    const tokenEndpoint = metadata.token_endpoint ?? notionTokenEndpoint;
    const redirectUri = callbackServer.callbackUrl;
    const clientRegistration = await dependencies.registerClient(registrationEndpoint, {
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_name: "JaFiction"
    });

    const codeVerifier = createCodeVerifier();
    const codeChallenge = createCodeChallenge(codeVerifier);
    const state = createOAuthState();
    const authorizationUrl = buildAuthorizationUrl({
      authorizationEndpoint,
      clientId: clientRegistration.client_id,
      redirectUri,
      codeChallenge,
      state
    });

    await dependencies.openBrowser(authorizationUrl);
    const callbackResponse = await callbackServer.waitForCallback(timeoutMs);
    if (callbackResponse.error) {
      const description = callbackResponse.errorDescription ? `: ${callbackResponse.errorDescription}` : "";
      throw new Error(`Notion OAuth failed with '${callbackResponse.error}'${description}`);
    }
    if (!callbackResponse.code) {
      throw new Error("Notion OAuth callback did not include an authorization code.");
    }
    if (callbackResponse.state !== state) {
      throw new Error("Notion OAuth state mismatch.");
    }

    const tokenResponse = await dependencies.exchangeAuthorizationCode(tokenEndpoint, {
      grant_type: "authorization_code",
      code: callbackResponse.code,
      redirect_uri: redirectUri,
      client_id: clientRegistration.client_id,
      code_verifier: codeVerifier
    });

    await saveGeminiMcpOauthCredential(
      {
        serverName,
        token: toStoredOAuthToken(tokenResponse, dependencies.now()),
        clientId: clientRegistration.client_id,
        tokenUrl: tokenEndpoint,
        mcpServerUrl: notionMcpServerUrl,
        updatedAt: dependencies.now()
      },
      dependencies
    );
  } finally {
    await callbackServer.close();
  }
}

async function saveGeminiMcpOauthCredential(
  credential: StoredOAuthCredential,
  dependencies: GeminiNotionOAuthDependencies
): Promise<void> {
  const homeDir = dependencies.homedir();
  const filePath = getGeminiMcpOauthTokenFilePath(homeDir);
  const dirPath = path.dirname(filePath);
  await dependencies.mkdir(dirPath);

  const existing = await readStoredOAuthCredentials(filePath, dependencies);
  const next = upsertStoredOAuthCredential(existing, credential);
  await dependencies.writeFile(filePath, JSON.stringify(next, null, 2), 0o600);
  await dependencies.chmod(filePath, 0o600);
}

async function readStoredOAuthCredentials(
  filePath: string,
  dependencies: GeminiNotionOAuthDependencies
): Promise<StoredOAuthCredential[]> {
  try {
    const raw = await dependencies.readFile(filePath);
    return JSON.parse(raw) as StoredOAuthCredential[];
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function createLocalCallbackServer(): Promise<OAuthCallbackServer> {
  return new Promise((resolve, reject) => {
    let resolveCallback: ((value: OAuthCallbackResponse) => void) | undefined;
    let rejectCallback: ((reason?: Error) => void) | undefined;
    const callbackPromise = new Promise<OAuthCallbackResponse>((resolveWait, rejectWait) => {
      resolveCallback = resolveWait;
      rejectCallback = rejectWait;
    });

    const server = http.createServer((request, response) => {
      const url = new URL(request.url ?? callbackPath, "http://127.0.0.1");
      if (url.pathname !== callbackPath) {
        response.statusCode = 404;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end("Not Found");
        return;
      }

      const callbackResponse: OAuthCallbackResponse = {
        code: url.searchParams.get("code") ?? undefined,
        state: url.searchParams.get("state") ?? undefined,
        error: url.searchParams.get("error") ?? undefined,
        errorDescription: url.searchParams.get("error_description") ?? undefined
      };
      response.statusCode = callbackResponse.error ? 400 : 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(buildCallbackPage(Boolean(callbackResponse.error)));

      if (callbackResponse.error || callbackResponse.code || callbackResponse.state) {
        resolveCallback?.(callbackResponse);
        return;
      }

      rejectCallback?.(new Error("Notion OAuth callback did not include OAuth parameters."));
    });

    let listening = false;
    server.once("error", (error) => {
      if (!listening) {
        reject(error);
        return;
      }
      rejectCallback?.(error);
    });

    server.listen(0, "127.0.0.1", () => {
      listening = true;
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to determine OAuth callback port."));
        return;
      }

      resolve({
        callbackUrl: `http://127.0.0.1:${address.port}${callbackPath}`,
        waitForCallback: (timeoutMs) => waitForCallback(callbackPromise, timeoutMs),
        close: () => closeServer(server)
      });
    });
  });
}

function waitForCallback(
  callbackPromise: Promise<OAuthCallbackResponse>,
  timeoutMs: number
): Promise<OAuthCallbackResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for Notion OAuth callback."));
    }, timeoutMs);

    callbackPromise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function buildCallbackPage(hasError: boolean | undefined): string {
  if (hasError) {
    return "<!doctype html><html><body><p>Notion OAuth failed. You can close this window.</p></body></html>";
  }
  return "<!doctype html><html><body><p>Notion OAuth completed. You can close this window.</p></body></html>";
}

interface BrowserOpenCommand {
  readonly command: string;
  readonly args: readonly string[];
}

function browserOpenCandidates(url: string): BrowserOpenCommand[] {
  const platform = process.platform;
  if (platform === "darwin") {
    return [{ command: "open", args: [url] }];
  }
  if (platform === "win32") {
    // rundll32 FileProtocolHandler는 URL 전용이라 cmd의 & 파싱 이슈도 없고
    // explorer.exe처럼 URL을 파일 경로로 오해하지도 않는다.
    return [{ command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] }];
  }
  // linux / WSL — try native openers first, then Windows fallback via /mnt/c
  return [
    { command: "xdg-open", args: [url] },
    { command: "wslview", args: [url] },
    { command: "/mnt/c/Windows/System32/rundll32.exe", args: ["url.dll,FileProtocolHandler", url] }
  ];
}

function spawnBrowser(candidate: BrowserOpenCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(candidate.command, [...candidate.args], {
      detached: true,
      stdio: "ignore"
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function openBrowser(url: string): Promise<void> {
  const candidates = browserOpenCandidates(url);
  const attempted: string[] = [];
  for (const candidate of candidates) {
    try {
      await spawnBrowser(candidate);
      return;
    } catch (error) {
      attempted.push(candidate.command);
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  throw new Error(
    `브라우저를 자동으로 열지 못했습니다. 다음 URL을 직접 열어주세요:\n${url}\n(시도한 명령: ${attempted.join(", ") || "없음"})`
  );
}

function requestJson<T>(
  method: "GET" | "POST",
  requestUrl: string,
  body?: string,
  headers: Record<string, string> = {}
): Promise<T> {
  const parsedUrl = new URL(requestUrl);
  const transport = parsedUrl.protocol === "http:" ? http : https;

  return new Promise((resolve, reject) => {
    const request = transport.request(parsedUrl, {
      method,
      headers: {
        Accept: "application/json",
        ...headers,
        ...(body ? { "Content-Length": Buffer.byteLength(body).toString() } : {})
      }
    }, (response) => {
      const chunks: string[] = [];
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        chunks.push(chunk);
      });
      response.on("end", () => {
        const payload = chunks.join("");
        const statusCode = response.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`Request to ${requestUrl} failed with status ${statusCode}: ${payload}`));
          return;
        }
        try {
          resolve(JSON.parse(payload) as T);
        } catch (error) {
          reject(new Error(`Failed to parse JSON response from ${requestUrl}: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
    });

    request.once("error", reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
