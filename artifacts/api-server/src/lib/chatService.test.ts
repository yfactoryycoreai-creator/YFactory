import assert from "node:assert/strict";
import test from "node:test";
import { ChatAdapterError, type ChatAdapterRegistry, type ChatMessage } from "./chatAdapters";
import { ChatServiceError, completeWithRotation } from "./chatService";

const messages: ChatMessage[] = [{ role: "user", content: "hello" }];
const keys = [
  { id: "key-1", value: "user-a-secret-1" },
  { id: "key-2", value: "user-a-secret-2" },
];

function adaptersFor(handler: (apiKey: string) => Promise<string>): ChatAdapterRegistry {
  return {
    gemini: {
      complete: ({ apiKey }) => handler(apiKey),
    },
  };
}

async function runWithFirstFailure(status: number | null) {
  const attempted: string[] = [];
  const failures: Array<{ id: string; status: number | null }> = [];
  const reply = await completeWithRotation({
    provider: "gemini",
    model: "manual-model",
    messages,
    keys,
    adapters: adaptersFor(async (apiKey) => {
      attempted.push(apiKey);
      if (apiKey === keys[0]?.value) throw new ChatAdapterError(status);
      return "mock reply";
    }),
    onFailure: async (id, failureStatus) => {
      failures.push({ id, status: failureStatus });
    },
    onSuccess: async () => undefined,
  });
  return { reply, attempted, failures };
}

test("429 cools the first key and rotates to the next key", async () => {
  const result = await runWithFirstFailure(429);
  assert.equal(result.reply, "mock reply");
  assert.deepEqual(result.attempted, keys.map((key) => key.value));
  assert.deepEqual(result.failures, [{ id: "key-1", status: 429 }]);
});

test("401 disables the first key and rotates to the next key", async () => {
  const result = await runWithFirstFailure(401);
  assert.equal(result.reply, "mock reply");
  assert.deepEqual(result.failures, [{ id: "key-1", status: 401 }]);
});

test("400 prompt errors do not rotate", async () => {
  const attempted: string[] = [];
  await assert.rejects(
    completeWithRotation({
      provider: "gemini",
      model: "manual-model",
      messages,
      keys,
      adapters: adaptersFor(async (apiKey) => {
        attempted.push(apiKey);
        throw new ChatAdapterError(400);
      }),
      onFailure: async () => undefined,
      onSuccess: async () => undefined,
    }),
    (error: unknown) => error instanceof ChatServiceError && error.code === "bad_prompt",
  );
  assert.deepEqual(attempted, [keys[0]?.value]);
});

test("unknown model errors use model_not_found and do not rotate", async () => {
  const attempted: string[] = [];
  await assert.rejects(
    completeWithRotation({
      provider: "gemini",
      model: "gemini-unknown-model",
      messages,
      keys,
      adapters: adaptersFor(async (apiKey) => {
        attempted.push(apiKey);
        throw new ChatAdapterError(400, "model_not_found");
      }),
      onFailure: async () => undefined,
      onSuccess: async () => undefined,
    }),
    (error: unknown) =>
      error instanceof ChatServiceError && error.code === "model_not_found",
  );
  assert.deepEqual(attempted, [keys[0]?.value]);
});

test("5xx failures cool a key and rotate", async () => {
  const result = await runWithFirstFailure(503);
  assert.equal(result.reply, "mock reply");
  assert.deepEqual(result.failures, [{ id: "key-1", status: 503 }]);
});

test("timeouts cool a key and rotate", async () => {
  const result = await runWithFirstFailure(null);
  assert.equal(result.reply, "mock reply");
  assert.deepEqual(result.failures, [{ id: "key-1", status: null }]);
});
