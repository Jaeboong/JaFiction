import type { FastifyInstance } from "fastify";
import type { SessionStore } from "../auth/session";
import { makeRequireSession } from "../auth/session";
import type { AuthenticatedRequest } from "../auth/session";
import type { Env } from "../env";

export async function registerMe(
  app: FastifyInstance,
  deps: { store: SessionStore; env: Pick<Env, "NODE_ENV"> }
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
}
