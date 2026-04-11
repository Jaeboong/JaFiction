import type { FastifyInstance } from "fastify";
import "@fastify/oauth2";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import type { SessionStore } from "../auth/session";
import {
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
  makeRequireSession,
} from "../auth/session";
import type { AuthenticatedRequest } from "../auth/session";
import type { Env } from "../env";

export interface GoogleUserInfo {
  readonly sub: string;
  readonly email: string;
  readonly name?: string;
}

export interface GoogleTokenResponse {
  readonly access_token: string;
  readonly token_type: string;
}

// Injected interface so tests can replace the real HTTP fetch with a stub
export type FetchGoogleUserInfo = (
  accessToken: string
) => Promise<GoogleUserInfo>;

export interface AuthDeps {
  readonly db: Db;
  readonly store: SessionStore;
  readonly env: Pick<Env, "NODE_ENV" | "PUBLIC_BASE_URL">;
  readonly fetchGoogleUserInfo?: FetchGoogleUserInfo;
}

const DEFAULT_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

async function defaultFetchGoogleUserInfo(
  accessToken: string
): Promise<GoogleUserInfo> {
  const res = await fetch(DEFAULT_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Google userinfo failed: ${res.status}`);
  }
  return res.json() as Promise<GoogleUserInfo>;
}

export async function registerAuth(
  app: FastifyInstance,
  deps: AuthDeps
): Promise<void> {
  const { db, store, env } = deps;
  const fetchUserInfo = deps.fetchGoogleUserInfo ?? defaultFetchGoogleUserInfo;
  const requireSession = makeRequireSession(store);

  // /auth/google  — handled by @fastify/oauth2, just declare for clarity
  // The plugin mounts the start path automatically.

  // /auth/google/callback
  app.get("/auth/google/callback", async (request, reply) => {
    // Destroy any pre-existing session to prevent session fixation / stale row accumulation
    const existingRaw = request.cookies[SESSION_COOKIE];
    if (existingRaw) {
      try {
        await store.destroySession(existingRaw);
      } catch {
        // Best-effort; old session may already be expired or invalid
      }
    }

    // @fastify/oauth2 attaches getAccessTokenFromAuthorizationCodeFlow to app.oauth2Google
    // The module augmentation in @fastify/oauth2 covers names matching oauth2${UpperCase}${string}
    if (typeof app.oauth2Google?.getAccessTokenFromAuthorizationCodeFlow !== "function") {
      await reply.code(500).send({ error: "OAuth2 plugin not registered" });
      return;
    }

    let tokenResponse: GoogleTokenResponse;
    try {
      const token = await app.oauth2Google.getAccessTokenFromAuthorizationCodeFlow(request);
      tokenResponse = token.token as GoogleTokenResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await reply.code(400).send({ error: "OAuth callback failed", detail: message });
      return;
    }

    let googleUser: GoogleUserInfo;
    try {
      googleUser = await fetchUserInfo(tokenResponse.access_token);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await reply.code(502).send({ error: "Failed to fetch user info", detail: message });
      return;
    }

    // Upsert user keyed on google_sub
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.google_sub, googleUser.sub))
      .limit(1);

    let userId: string;
    if (existing.length > 0) {
      userId = existing[0].id;
    } else {
      const inserted = await db
        .insert(users)
        .values({
          google_sub: googleUser.sub,
          email: googleUser.email,
        })
        .returning({ id: users.id });
      userId = inserted[0].id;
    }

    const { raw } = await store.createSession(userId);
    setSessionCookie(reply, raw, env);

    await reply.redirect(env.PUBLIC_BASE_URL);
  });

  // /auth/logout
  app.post("/auth/logout", { preHandler: requireSession }, async (request, reply) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (raw) {
      await store.destroySession(raw);
    }
    clearSessionCookie(reply);
    await reply.send({ ok: true });
  });

  // Convenience alias for GET logout (browser navigation)
  app.get("/auth/logout", async (request, reply) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (raw) {
      try {
        await store.destroySession(raw);
      } catch {
        // Best-effort
      }
    }
    clearSessionCookie(reply);
    await reply.redirect(env.PUBLIC_BASE_URL);
  });
}
