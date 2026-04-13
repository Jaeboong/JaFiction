import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  COOKIE_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PUBLIC_BASE_URL: z.string().url(),
  // 로그인 후 리다이렉트 URL. dev에서는 프론트(4124), prod에서는 PUBLIC_BASE_URL과 동일.
  WEB_BASE_URL: z.string().url().optional(),
  // 금융감독원 OpenDART API 키 — 서버 운영자가 관리, 전 사용자 공유.
  DART_API_KEY: z.string().min(1),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const missing = result.error.errors
      .map((e) => `${e.path.join(".")}: ${e.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${missing}`);
  }
  return result.data;
}
