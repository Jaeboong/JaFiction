import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { SessionStore } from "../auth/session";
import { makeRequireSession, SESSION_COOKIE, clearSessionCookie } from "../auth/session";
import type { AuthenticatedRequest } from "../auth/session";
import type { Env } from "../env";
import type { Db } from "../db/client";
import { users } from "../db/schema";

export async function registerMe(
  app: FastifyInstance,
  deps: { store: SessionStore; env: Pick<Env, "NODE_ENV">; db?: Db }
): Promise<void> {
  const requireSession = makeRequireSession(deps.store);

  app.get(
    "/api/me",
    { preHandler: requireSession },
    async (request, reply) => {
      const { user } = (request as AuthenticatedRequest).sessionData;
      await reply.send({
        user: {
          id: user.id,
          email: user.email,
        },
      });
    }
  );

  app.delete(
    "/api/me",
    { preHandler: requireSession },
    async (request, reply) => {
      const { user, session } = (request as AuthenticatedRequest).sessionData;

      if (deps.db) {
        await deps.db.delete(users).where(eq(users.id, user.id));
      }

      await deps.store.destroySession(
        request.cookies[SESSION_COOKIE] ?? session.cookie_hash
      );

      clearSessionCookie(reply);
      await reply.code(204).send();
    }
  );
}
