import type { FastifyInstance } from "fastify";
import fastifyOauth2 from "@fastify/oauth2";
import type { Env } from "../env";

export async function registerGoogleOauth(
  app: FastifyInstance,
  env: Pick<Env, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "PUBLIC_BASE_URL">
): Promise<void> {
  await app.register(fastifyOauth2, {
    name: "googleOAuth2",
    scope: ["openid", "email", "profile"],
    credentials: {
      client: {
        id: env.GOOGLE_CLIENT_ID,
        secret: env.GOOGLE_CLIENT_SECRET,
      },
      auth: fastifyOauth2.GOOGLE_CONFIGURATION,
    },
    startRedirectPath: "/auth/google",
    callbackUri: `${env.PUBLIC_BASE_URL}/auth/google/callback`,
  });
}
