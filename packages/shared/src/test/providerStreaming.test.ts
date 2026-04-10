import * as assert from "node:assert/strict";
import test from "node:test";
import { createProviderStreamProcessor, parseProviderFinalText } from "../core/providerStreaming";
import { RunEvent } from "../core/types";

test("provider stream processor converts codex agent messages into chat events", async () => {
  const events: RunEvent[] = [];
  const processor = createProviderStreamProcessor("codex", 1, "reviewer");

  await processor.handleStdout(
    [
      JSON.stringify({ type: "item.started", item: { id: "item_1", type: "agent_message" } }),
      JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: "첫 번째 의견입니다." } })
    ].join("\n") + "\n",
    async (event) => {
      events.push(event);
    }
  );
  await processor.finalize("", async (event) => {
    events.push(event);
  });

  assert.deepEqual(
    events.map((event) => event.type),
    ["chat-message-started", "chat-message-delta", "chat-message-completed"]
  );
  assert.equal(events[1].message, "첫 번째 의견입니다.");
});

test("provider stream processor namespaces repeated codex item ids across turns", async () => {
  const firstTurnEvents: RunEvent[] = [];
  const secondTurnEvents: RunEvent[] = [];
  const firstProcessor = createProviderStreamProcessor("codex", 0, "coordinator");
  const secondProcessor = createProviderStreamProcessor("codex", 3, "coordinator");

  const stdout = [
    JSON.stringify({ type: "item.started", item: { id: "item_0", type: "agent_message" } }),
    JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "첫 번째 조정 응답" } })
  ].join("\n") + "\n";

  await firstProcessor.handleStdout(stdout, async (event) => {
    firstTurnEvents.push(event);
  });
  await secondProcessor.handleStdout(stdout, async (event) => {
    secondTurnEvents.push(event);
  });

  assert.equal(firstTurnEvents[0].messageId, "codex-coordinator-round-0-item_0");
  assert.equal(secondTurnEvents[0].messageId, "codex-coordinator-round-3-item_0");
  assert.notEqual(firstTurnEvents[0].messageId, secondTurnEvents[0].messageId);
});

test("provider stream processor streams plain text chunks for claude", async () => {
  const events: RunEvent[] = [];
  const processor = createProviderStreamProcessor("claude", 2, "coordinator");

  await processor.handleStdout("첫 문장", async (event) => {
    events.push(event);
  });
  await processor.handleStdout(" 이어짐", async (event) => {
    events.push(event);
  });
  await processor.finalize("첫 문장 이어짐", async (event) => {
    events.push(event);
  });

  assert.equal(events[0].type, "chat-message-started");
  assert.equal(events[1].type, "chat-message-delta");
  assert.equal(events[1].message, "첫 문장");
  assert.equal(events[2].message, " 이어짐");
  assert.equal(events.at(-1)?.type, "chat-message-completed");
});

test("provider stream processor does not duplicate codex final text after streamed deltas", async () => {
  const events: RunEvent[] = [];
  const processor = createProviderStreamProcessor("codex", 1, "reviewer");

  await processor.handleStdout(
    [
      JSON.stringify({ type: "response.output_text.delta", item_id: "item_7", delta: "첫 문장" }),
      JSON.stringify({ type: "response.output_text.delta", item_id: "item_7", delta: " 이어짐" }),
      JSON.stringify({ type: "response.output_text.done", item_id: "item_7", text: "첫 문장 이어짐" })
    ].join("\n") + "\n",
    async (event) => {
      events.push(event);
    }
  );
  await processor.finalize("", async (event) => {
    events.push(event);
  });

  assert.deepEqual(
    events.map((event) => event.type),
    ["chat-message-started", "chat-message-delta", "chat-message-delta", "chat-message-completed"]
  );
  assert.equal(
    events
      .filter((event) => event.type === "chat-message-delta")
      .map((event) => event.message)
      .join(""),
    "첫 문장 이어짐"
  );
});

test("provider stream processor streams gemini stream-json assistant deltas", async () => {
  const events: RunEvent[] = [];
  const processor = createProviderStreamProcessor("gemini", 2, "reviewer");
  const stdout = [
    JSON.stringify({
      type: "init",
      timestamp: "2026-04-09T00:00:00.000Z",
      session_id: "session-1",
      model: "gemini-2.5-pro"
    }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-04-09T00:00:00.100Z",
      role: "user",
      content: "사용자 입력"
    }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-04-09T00:00:00.200Z",
      role: "assistant",
      content: "첫 문장",
      delta: true
    }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-04-09T00:00:00.300Z",
      role: "assistant",
      content: " 이어짐",
      delta: true
    }),
    JSON.stringify({
      type: "result",
      timestamp: "2026-04-09T00:00:00.400Z",
      status: "success"
    })
  ].join("\n");

  await processor.handleStdout(stdout + "\n", async (event) => {
    events.push(event);
  });
  await processor.finalize(stdout, async (event) => {
    events.push(event);
  });

  assert.deepEqual(
    events.map((event) => event.type),
    ["chat-message-started", "chat-message-delta", "chat-message-delta", "chat-message-completed"]
  );
  assert.equal(
    events
      .filter((event) => event.type === "chat-message-delta")
      .map((event) => event.message)
      .join(""),
    "첫 문장 이어짐"
  );
});

test("provider final text parser still extracts natural text from JSON stdout", () => {
  const text = parseProviderFinalText(
    "gemini",
    JSON.stringify({
      output: {
        text: "정리된 최종 답변"
      }
    })
  );

  assert.match(text, /정리된 최종 답변/);
});

test("provider final text parser extracts only gemini response from multiline json", () => {
  const text = parseProviderFinalText(
    "gemini",
    JSON.stringify(
      {
        session_id: "84fbaeec-5bbc-4c74-9839-94ebffe72685",
        response: "이것만 최종 응답으로 보여야 합니다.",
        stats: {
          models: {
            "gemini-3-flash-preview": {
              api: {
                totalRequests: 1
              }
            }
          }
        }
      },
      null,
      2
    )
  );

  assert.equal(text, "이것만 최종 응답으로 보여야 합니다.");
});

test("provider final text parser extracts only gemini assistant text from stream-json output", () => {
  const text = parseProviderFinalText(
    "gemini",
    [
      JSON.stringify({
        type: "init",
        timestamp: "2026-04-09T00:00:00.000Z",
        session_id: "session-1",
        model: "gemini-2.5-pro"
      }),
      JSON.stringify({
        type: "message",
        timestamp: "2026-04-09T00:00:00.100Z",
        role: "user",
        content: "사용자 입력"
      }),
      JSON.stringify({
        type: "message",
        timestamp: "2026-04-09T00:00:00.200Z",
        role: "assistant",
        content: "첫 문장",
        delta: true
      }),
      JSON.stringify({
        type: "message",
        timestamp: "2026-04-09T00:00:00.300Z",
        role: "assistant",
        content: " 이어짐",
        delta: true
      }),
      JSON.stringify({
        type: "result",
        timestamp: "2026-04-09T00:00:00.400Z",
        status: "success"
      })
    ].join("\n")
  );

  assert.equal(text, "첫 문장 이어짐");
});

test("provider final text parser ignores codex metadata lines and keeps agent messages", () => {
  const text = parseProviderFinalText(
    "codex",
    [
      JSON.stringify({ type: "thread.started", thread_id: "thread_123" }),
      JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: "첫 번째 리뷰입니다." } }),
      JSON.stringify({ type: "item.completed", item: { id: "item_2", type: "command_execution", command: "ls" } })
    ].join("\n")
  );

  assert.equal(text, "첫 번째 리뷰입니다.");
});
