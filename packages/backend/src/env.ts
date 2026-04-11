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
}).strict();

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
