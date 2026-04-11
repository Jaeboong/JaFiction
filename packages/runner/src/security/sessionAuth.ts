import type { IncomingHttpHeaders } from "node:http";

export const runnerSessionCookieName = "jasojeon_runner_session";

const defaultDevWebPort = 4124;
const sessionCookieMaxAgeSeconds = 60 * 60 * 8;
const trustedLoopbackHosts = ["127.0.0.1", "localhost", "[::1]"] as const;

export interface SessionAuthConfig {
  sessionToken: string;
  runnerPort: number;
  devWebPort?: number;
}

export interface SessionAuthRequestLike {
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
}

export interface SessionAuthResult {
  ok: boolean;
  status?: 401 | 403;
  error?: "forbidden_origin" | "unauthorized";
  message?: string;
}

export interface SessionAuth {
  readonly trustedOrigins: string[];
  isTrustedOrigin(origin: string): boolean;
  authorizeSessionBootstrap(request: SessionAuthRequestLike): SessionAuthResult;
  authorizeAuthenticatedRequest(request: SessionAuthRequestLike): SessionAuthResult;
  sessionCookie(): string;
}

export function createSessionAuth(config: SessionAuthConfig): SessionAuth {
  const trustedOrigins = resolveTrustedOrigins(config);
  const trustedOriginSet = new Set(trustedOrigins);

  const validateBrowserOrigin = (request: SessionAuthRequestLike): SessionAuthResult => {
    const origin = firstHeaderValue(request.headers, "origin");
    if (!origin) {
      const secFetchSite = firstHeaderValue(request.headers, "sec-fetch-site");
      if (!secFetchSite || secFetchSite === "same-origin" || secFetchSite === "same-site" || secFetchSite === "none") {
        return { ok: true };
      }

      return {
        ok: false,
        status: 403,
        error: "forbidden_origin",
        message: "Runner requests must originate from an approved local Jasojeon UI."
      };
    }

    if (trustedOriginSet.has(normalizeOrigin(origin))) {
      return { ok: true };
    }

    return {
      ok: false,
      status: 403,
      error: "forbidden_origin",
      message: "Runner requests must originate from an approved local Jasojeon UI."
    };
  };

  return {
    trustedOrigins,
    isTrustedOrigin: (origin) => trustedOriginSet.has(normalizeOrigin(origin)),
    authorizeSessionBootstrap: validateBrowserOrigin,
    authorizeAuthenticatedRequest: (request) => {
      const originCheck = validateBrowserOrigin(request);
      if (!originCheck.ok) {
        return originCheck;
      }

      const sessionToken = readCookieValue(request.headers, runnerSessionCookieName);
      if (sessionToken !== config.sessionToken) {
        return {
          ok: false,
          status: 401,
          error: "unauthorized",
          message: "Authenticate with /api/session before calling the runner."
        };
      }

      return { ok: true };
    },
    sessionCookie: () => serializeSessionCookie(config.sessionToken)
  };
}

export function resolveTrustedOrigins(config: Pick<SessionAuthConfig, "runnerPort" | "devWebPort">): string[] {
  const ports = [config.runnerPort, config.devWebPort ?? resolveDevWebPort()]
    .filter((value): value is number => Number.isInteger(value) && value > 0);

  return Array.from(
    new Set(
      ports.flatMap((port) => trustedLoopbackHosts.map((host) => normalizeOrigin(`http://${host}:${port}`)))
    )
  );
}

export function serializeSessionCookie(sessionToken: string): string {
  return [
    `${runnerSessionCookieName}=${encodeURIComponent(sessionToken)}`,
    "Path=/",
    `Max-Age=${sessionCookieMaxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Strict"
  ].join("; ");
}

function resolveDevWebPort(): number {
  const candidate = Number(process.env.JASOJEON_WEB_PORT ?? defaultDevWebPort);
  return Number.isInteger(candidate) && candidate > 0 ? candidate : defaultDevWebPort;
}

function normalizeOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.origin;
  } catch {
    return "";
  }
}

function firstHeaderValue(
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" ? value : undefined;
}

function readCookieValue(
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const cookieHeader = firstHeaderValue(headers, "cookie");
  if (!cookieHeader) {
    return undefined;
  }

  for (const entry of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = entry.trim().split("=");
    if (rawKey !== name) {
      continue;
    }
    return decodeURIComponent(rawValue.join("="));
  }

  return undefined;
}
