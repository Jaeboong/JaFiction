import { Router } from "express";
import { OpenDartClient } from "@jafiction/shared";
import { openDartSecretKey, RunnerContext } from "../runnerContext";

export function createOpenDartRouter(ctx: RunnerContext): Router {
  const router = Router();

  router.get("/status", async (_request, response, next) => {
    try {
      response.json({
        configured: Boolean(await ctx.secrets().get(openDartSecretKey))
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/apikey", async (request, response, next) => {
    try {
      const apiKey = String(request.body?.apiKey ?? "").trim();
      if (!apiKey) {
        throw new Error("OpenDART API 키는 비워둘 수 없습니다.");
      }
      await ctx.runBusy("OpenDART API 키를 저장하는 중...", async () => {
        await ctx.secrets().store(openDartSecretKey, apiKey);
        await ctx.stateStore.refreshOpenDartConfigured();
      });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.delete("/apikey", async (_request, response, next) => {
    try {
      await ctx.runBusy("OpenDART API 키를 삭제하는 중...", async () => {
        await ctx.secrets().delete(openDartSecretKey);
        await ctx.stateStore.refreshOpenDartConfigured();
      });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post("/test", async (_request, response, next) => {
    try {
      const apiKey = await ctx.secrets().get(openDartSecretKey);
      if (!apiKey) {
        response.status(400).json({ ok: false, message: "OpenDART API 키를 먼저 저장하세요." });
        return;
      }
      const result = await new OpenDartClient(ctx.storageRoot, apiKey).testConnection();
      ctx.stateStore.setOpenDartConnectionState({
        status: result.ok ? "healthy" : "unhealthy",
        lastCheckAt: new Date().toISOString(),
        lastError: result.ok ? undefined : result.message
      });
      await ctx.pushState();
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
