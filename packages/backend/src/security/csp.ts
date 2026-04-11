/**
 * csp.ts
 *
 * Phase 9 — strict security headers for hosted backend.
 *
 * Baseline policy: deny everything by default, allow only same-origin scripts,
 * styles, images, connect, and fonts. Blocks inline scripts, frames, and
 * cross-origin form posts.
 *
 * We reuse `@fastify/helmet` (already a dep) rather than hand-rolling headers,
 * so other Helmet defaults (nosniff, frame-deny, referrer policy, HSTS, etc.)
 * are applied consistently.
 *
 * CSP is primarily meaningful for HTML responses, but Helmet applies the
 * headers to every response. JSON APIs are unaffected by CSP semantics —
 * browsers only enforce CSP when parsing HTML/JS — so setting these headers
 * on JSON responses is safe and costs nothing.
 */

import type { FastifyInstance } from "fastify";
import fastifyHelmet from "@fastify/helmet";

/**
 * Register @fastify/helmet with strict CSP + security headers.
 *
 * Call this instead of `app.register(fastifyHelmet, ...)` from app builders.
 */
export async function registerStrictSecurityHeaders(app: FastifyInstance): Promise<void> {
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'none'"],
        "script-src": ["'self'"],
        "style-src": ["'self'"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        "font-src": ["'self'"],
        "frame-ancestors": ["'none'"],
        "base-uri": ["'none'"],
        "form-action": ["'self'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
    xContentTypeOptions: true,
    frameguard: { action: "deny" },
    // Helmet defaults handle X-DNS-Prefetch-Control, X-Download-Options, etc.
  });
}
