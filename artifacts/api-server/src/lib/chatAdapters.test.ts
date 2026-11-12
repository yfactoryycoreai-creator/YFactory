import assert from "node:assert/strict";
import test from "node:test";
import { ChatAdapterError, createGeminiChatAdapter } from "./chatAdapters";

const input = {
  apiKey: "mock-user-secret",
  model: "manual-model",
  messages: [{ role: "user" as const, content: "hello" }],
};

test("Gemini adapter uses a mocked compatible endpoint response", async () => {
  let requestUrl = "";
  let requestAuthorization = "";
  const adapter = createGeminiChatAdapter(async (url, init) => {
    requestUrl = String(url);
    requestAuthorization = new Headers(init?.headers).get("Authorization") ?? "";
    return new Response(JSON.stringify({
      choices: [{ message: { content: "mock reply" } }],
    }), { status: 200 });
  });
  assert.equal(await adapter.complete(input), "mock reply");
  assert.equal(
    requestUrl,
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  );
  assert.equal(requestAuthorization, `Bearer ${input.apiKey}`);
});

test("Gemini adapter exposes only status codes for mocked provider failures", async () => {
  for (const status of [429, 401, 403, 400, 503]) {
    const adapter = createGeminiChatAdapter(async () =>
      new Response(JSON.stringify({ error: { message: input.apiKey } }), { status }),
    );
    await assert.rejects(
      adapter.complete(input),
      (error: unknown) =>
        error instanceof ChatAdapterError &&
        error.status === status &&
        !error.message.includes(input.apiKey),
    );
  }
});

test("Gemini adapter maps a mocked timeout without exposing credentials", async () => {
  const hangingFetch: typeof fetch = async (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    });
  const adapter = createGeminiChatAdapter(hangingFetch, 5);
  await assert.rejects(
    adapter.complete(input),
    (error: unknown) =>
      error instanceof ChatAdapterError &&
      error.status === null &&
      !error.message.includes(input.apiKey),
  );
});
