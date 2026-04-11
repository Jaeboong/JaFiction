import { Router } from "express";
import { ProviderId, ProviderRuntimeState, providerIds } from "@jasojeon/shared";
import { RunnerContext } from "../runnerContext";

export function createProvidersRouter(ctx: RunnerContext): Router {
  const router = Router();

  router.get("/", async (_request, response, next) => {
    try {
      response.json(await ctx.registry().listRuntimeStates());
    } catch (error) {
      next(error);
    }
  });

  router.post("/:providerId/test", async (request, response, next) => {
    try {
      const providerId = requireProviderId(String(request.params.providerId));
      await ctx.runBusy("도구 연결을 확인하는 중...", async () => {
        await ctx.registry().testProvider(providerId);
        await ctx.stateStore.refreshProvider(providerId);
      });
      response.json(await ctx.registry().refreshRuntimeState(providerId));
    } catch (error) {
      next(error);
    }
  });

  router.put("/:providerId/config", async (request, response, next) => {
    try {
      const providerId = requireProviderId(String(request.params.providerId));
      const { authMode, model, effort, command } = request.body as {
        authMode?: "cli" | "apiKey";
        model?: string;
        effort?: string;
        command?: string;
      };

      await ctx.runBusy("프로바이더 설정을 저장하는 중...", async () => {
        if (typeof authMode === "string") {
          await ctx.registry().setAuthMode(providerId, authMode);
        }
        if (typeof model === "string") {
          await ctx.registry().setModel(providerId, model);
        }
        if (typeof effort === "string") {
          await ctx.registry().setEffort(providerId, effort);
        }
        if (typeof command === "string") {
          await ctx.config().set(`providers.${providerId}.command`, command.trim());
        }
        await ctx.stateStore.refreshProvider(providerId);
      });

      response.json(await ctx.registry().refreshRuntimeState(providerId));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:providerId/apikey", async (request, response, next) => {
    try {
      const providerId = requireProviderId(String(request.params.providerId));
      const apiKey = String(request.body?.apiKey ?? "").trim();
      if (!apiKey) {
        throw new Error("API 키를 입력하세요.");
      }

      await ctx.runBusy("API 키를 저장하는 중...", async () => {
        await ctx.registry().saveApiKey(providerId, apiKey);
        await ctx.stateStore.refreshProvider(providerId);
      });
      response.json(await ctx.registry().refreshRuntimeState(providerId));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:providerId/apikey", async (request, response, next) => {
    try {
      const providerId = requireProviderId(String(request.params.providerId));
      await ctx.runBusy("API 키를 삭제하는 중...", async () => {
        await ctx.registry().clearApiKey(providerId);
        await ctx.stateStore.refreshProvider(providerId);
      });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post("/:providerId/notion-token", async (request, response, next) => {
    try {
      const providerId = requireProviderId(String(request.params.providerId));
      const token = String(request.body?.token ?? "").trim();

      await ctx.runBusy("Notion Integration Token을 저장하는 중...", async () => {
        await ctx.registry().saveNotionToken(token);
        await ctx.stateStore.refreshProvider(providerId);
      });

      response.json(await ctx.registry().refreshRuntimeState(providerId));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:providerId/notion-token", async (request, response, next) => {
    try {
      const providerId = requireProviderId(String(request.params.providerId));

      await ctx.runBusy("Notion Integration Token을 삭제하는 중...", async () => {
        await ctx.registry().saveNotionToken("");
        await ctx.stateStore.refreshProvider(providerId);
      });

      response.json(await ctx.registry().refreshRuntimeState(providerId));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:providerId/notion", async (request, response, next) => {
    try {
      const providerId = requireProviderId(String(request.params.providerId));
      let runtimeState: ProviderRuntimeState | undefined;
      await ctx.runBusy("Notion MCP 상태를 확인하는 중...", async () => {
        await ctx.registry().checkNotionMcp(providerId);
        runtimeState = await ctx.registry().refreshRuntimeState(providerId);
        await ctx.stateStore.refreshProvider(providerId);
      });
      if (!runtimeState) {
        throw new Error("Notion MCP 상태를 갱신하지 못했습니다.");
      }
      response.json(runtimeState);
    } catch (error) {
      next(error);
    }
  });

  router.post("/:providerId/notion/connect", async (request, response, next) => {
    try {
      const providerId = requireProviderId(String(request.params.providerId));
      let runtimeState: ProviderRuntimeState | undefined;
      await ctx.runBusy("Notion MCP를 연결하는 중...", async () => {
        runtimeState = await ctx.registry().connectNotionMcp(providerId);
        await ctx.stateStore.refreshProvider(providerId);
      });
      if (!runtimeState) {
        throw new Error("Notion MCP 연결 결과를 확인하지 못했습니다.");
      }
      response.json(runtimeState);
    } catch (error) {
      next(error);
    }
  });

  router.post("/:providerId/notion/disconnect", async (request, response, next) => {
    try {
      const providerId = requireProviderId(String(request.params.providerId));
      let runtimeState: ProviderRuntimeState | undefined;
      await ctx.runBusy("Notion MCP 연결을 해제하는 중...", async () => {
        runtimeState = await ctx.registry().disconnectNotionMcp(providerId);
        await ctx.stateStore.refreshProvider(providerId);
      });
      if (!runtimeState) {
        throw new Error("Notion MCP 해제 결과를 확인하지 못했습니다.");
      }
      response.json(runtimeState);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function requireProviderId(value: string): ProviderId {
  if (!providerIds.includes(value as ProviderId)) {
    throw new Error(`지원하지 않는 providerId입니다: ${value}`);
  }
  return value as ProviderId;
}
