import { Router } from "express";
import { RunnerContext } from "../runnerContext";

export function createConfigRouter(ctx: RunnerContext): Router {
  const router = Router();

  router.get("/agent-defaults", async (_request, response, next) => {
    try {
      response.json({ agentDefaults: await ctx.config().getAgentDefaults() });
    } catch (error) {
      next(error);
    }
  });

  router.put("/agent-defaults", async (request, response, next) => {
    try {
      await ctx.runBusy("에이전트 배정을 저장하는 중...", async () => {
        await ctx.config().setAgentDefaults(request.body?.agentDefaults);
        await ctx.stateStore.refreshAgentDefaults();
      });
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
