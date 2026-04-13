import type Redis from "ioredis";
import type { SubscribeRedis } from "../ws/browserEvents";

/**
 * Adapts a raw ioredis client to the SubscribeRedis interface expected by
 * registerBrowserEvents. ioredis's native subscribe(...channels, cb?) API
 * does NOT deliver messages via the cb argument — messages arrive on the
 * connection-level "message" event. This adapter fans those out to the
 * per-channel handlers registered by browserEvents.
 */
export function createSubscribeAdapter(redis: Redis): SubscribeRedis {
  const handlers = new Map<string, Set<(message: string) => void>>();

  redis.on("message", (channel: string, message: string) => {
    const set = handlers.get(channel);
    if (!set) return;
    for (const h of set) {
      h(message);
    }
  });

  return {
    async subscribe(channel, handler) {
      let set = handlers.get(channel);
      if (!set) {
        set = new Set();
        handlers.set(channel, set);
        await redis.subscribe(channel);
      }
      set.add(handler);
    },
    async unsubscribe(channel, handler) {
      const set = handlers.get(channel);
      if (!set) return;
      set.delete(handler);
      if (set.size === 0) {
        handlers.delete(channel);
        await redis.unsubscribe(channel);
      }
    }
  };
}
