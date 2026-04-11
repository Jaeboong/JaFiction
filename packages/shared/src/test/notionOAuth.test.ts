import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";
import {
  buildAuthorizationUrl,
  createCodeChallenge,
  createCodeVerifier,
  getGeminiMcpOauthTokenFilePath,
  performGeminiNotionOAuth,
  StoredOAuthCredential,
  upsertStoredOAuthCredential
} from "../core/notionOAuth";
import { cleanupTempWorkspace, createTempWorkspace } from "./helpers";

test("PKCE verifier uses base64url characters and expected length range", () => {
  const verifier = createCodeVerifier();
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  assert.ok(verifier.length >= 43);
  assert.ok(verifier.length <= 128);
});

test("PKCE challenge matches RFC 7636 example", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = createCodeChallenge(verifier);
  assert.equal(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("oauth credential upsert replaces only matching server entry", () => {
  const existing: StoredOAuthCredential[] = [
    {
      serverName: "alpha",
      token: {
        accessToken: "old-alpha",
        tokenType: "Bearer"
      },
      updatedAt: 1
    },
    {
      serverName: "beta",
      token: {
        accessToken: "old-beta",
        tokenType: "Bearer"
      },
      updatedAt: 2
    }
  ];

  const updated = upsertStoredOAuthCredential(existing, {
    serverName: "beta",
    token: {
      accessToken: "new-beta",
      tokenType: "Bearer"
    },
    updatedAt: 3
  });

  assert.deepEqual(updated, [
    existing[0],
    {
      serverName: "beta",
      token: {
        accessToken: "new-beta",
        tokenType: "Bearer"
      },
      updatedAt: 3
    }
  ]);
});

test("buildAuthorizationUrl includes PKCE and callback parameters", () => {
  const url = new URL(buildAuthorizationUrl({
    authorizationEndpoint: "https://mcp.notion.com/authorize",
    clientId: "client-123",
    redirectUri: "http://127.0.0.1:43123/callback",
    codeChallenge: "challenge-123",
    state: "state-123"
  }));

  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "client-123");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:43123/callback");
  assert.equal(url.searchParams.get("code_challenge"), "challenge-123");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), "state-123");
});

test("performGeminiNotionOAuth registers client, exchanges code, and stores Gemini token format", async (t) => {
  const fakeHome = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(fakeHome));

  let openedUrl = "";
  let registeredRedirectUri = "";
  let exchangedCodeVerifier = "";
  let exchangedClientId = "";
  let exchangedRedirectUri = "";

  await performGeminiNotionOAuth("notion", {
    dependencies: {
      now: () => 1_700_000_000_000,
      homedir: () => fakeHome,
      fetchAuthorizationServerMetadata: async () => ({
        registration_endpoint: "https://mcp.notion.com/register",
        authorization_endpoint: "https://mcp.notion.com/authorize",
        token_endpoint: "https://mcp.notion.com/token"
      }),
      registerClient: async (_url, request) => {
        registeredRedirectUri = request.redirect_uris[0] ?? "";
        return { client_id: "client-123" };
      },
      exchangeAuthorizationCode: async (_url, request) => {
        exchangedCodeVerifier = request.code_verifier;
        exchangedClientId = request.client_id;
        exchangedRedirectUri = request.redirect_uri;
        return {
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "workspace.read"
        };
      },
      createCallbackServer: async () => ({
        callbackUrl: "http://127.0.0.1:43123/callback",
        waitForCallback: async () => {
          const state = new URL(openedUrl).searchParams.get("state");
          return {
            code: "auth-code",
            state: state ?? undefined
          };
        },
        close: async () => {}
      }),
      openBrowser: async (url) => {
        openedUrl = url;
      },
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
    }
  });

  const tokenFilePath = getGeminiMcpOauthTokenFilePath(fakeHome);
  const stored = JSON.parse(await fs.readFile(tokenFilePath, "utf8")) as StoredOAuthCredential[];
  const opened = new URL(openedUrl);

  assert.equal(registeredRedirectUri, "http://127.0.0.1:43123/callback");
  assert.equal(opened.origin + opened.pathname, "https://mcp.notion.com/authorize");
  assert.equal(opened.searchParams.get("client_id"), "client-123");
  assert.equal(opened.searchParams.get("redirect_uri"), "http://127.0.0.1:43123/callback");
  assert.equal(opened.searchParams.get("code_challenge_method"), "S256");
  assert.equal(exchangedClientId, "client-123");
  assert.equal(exchangedRedirectUri, "http://127.0.0.1:43123/callback");
  assert.match(exchangedCodeVerifier, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(stored, [
    {
      serverName: "notion",
      token: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresAt: 1_700_003_600_000,
        tokenType: "Bearer",
        scope: "workspace.read"
      },
      clientId: "client-123",
      tokenUrl: "https://mcp.notion.com/token",
      mcpServerUrl: "https://mcp.notion.com/mcp",
      updatedAt: 1_700_000_000_000
    }
  ]);
});

test("performGeminiNotionOAuth rejects when callback state does not match", async (t) => {
  const fakeHome = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(fakeHome));

  let openedUrl = "";

  await assert.rejects(
    performGeminiNotionOAuth("notion", {
      dependencies: {
        homedir: () => fakeHome,
        fetchAuthorizationServerMetadata: async () => ({
          registration_endpoint: "https://mcp.notion.com/register",
          authorization_endpoint: "https://mcp.notion.com/authorize",
          token_endpoint: "https://mcp.notion.com/token"
        }),
        registerClient: async () => ({ client_id: "client-123" }),
        exchangeAuthorizationCode: async () => {
          throw new Error("token exchange should not run");
        },
        createCallbackServer: async () => ({
          callbackUrl: "http://127.0.0.1:43123/callback",
          waitForCallback: async () => ({
            code: "auth-code",
            state: "wrong-state"
          }),
          close: async () => {}
        }),
        openBrowser: async (url) => {
          openedUrl = url;
        },
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
      }
    }),
    /state mismatch/i
  );

  assert.ok(openedUrl.length > 0);
  await assert.rejects(fs.access(path.join(fakeHome, ".gemini", "mcp-oauth-tokens.json")));
});
