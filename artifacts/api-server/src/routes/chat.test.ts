import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import type { GeminiChatKeyPool } from "../lib/apiKeyVault";
import type { ChatAdapterRegistry } from "../lib/chatAdapters";
import { createChatRouter } from "./chat";

const userAKey = "user-a-secret";
const userBKey = "user-b-secret";

async function request(
  app: express.Express,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<Response> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: options.body === undefined ? "GET" : "POST",
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
}

function createTestApp(router: ReturnType<typeof createChatRouter>) {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

test("chat endpoints reject requests without an ID token", async () => {
  let keyReads = 0;
  const router = createChatRouter({
    getKeyPool: async () => {
      keyReads += 1;
      return { keys: [], hasAny: false, hasAuthFailed: false, hasCooldown: false };
    },
  });
  const app = createTestApp(router);
  const providerResponse = await request(app, "/api/chat/providers");
  assert.equal(providerResponse.status, 401);
  assert.deepEqual(await providerResponse.json(), { code: "auth_failed" });
  const completionResponse = await request(app, "/api/chat/completions", {
    body: {
      provider: "gemini",
      model: "manual-model",
      messages: [{ role: "user", content: "hello" }],
    },
  });
  assert.equal(completionResponse.status, 401);
  assert.deepEqual(await completionResponse.json(), { code: "auth_failed" });
  assert.equal(keyReads, 0);
});

test("user A can only list and use user A's key; responses never contain key values", async () => {
  const reads: string[] = [];
  const used: string[] = [];
  const poolForUser = (uid: string): GeminiChatKeyPool => ({
    keys: [{ id: `${uid}-key`, value: uid === "user-a" ? userAKey : userBKey }],
    hasAny: true,
    hasAuthFailed: false,
    hasCooldown: false,
  });
  const adapters: ChatAdapterRegistry = {
    gemini: {
      complete: async ({ apiKey }) => {
        used.push(apiKey);
        return "mock reply";
      },
    },
  };
  const router = createChatRouter({
    verifyIdToken: async (token) => token === "user-a-token" ? "user-a" : null,
    getKeyPool: async (uid) => {
      reads.push(uid);
      return poolForUser(uid);
    },
    adapters,
  });
  const app = createTestApp(router);
  const providersResponse = await request(app, "/api/chat/providers", { token: "user-a-token" });
  const providersJson = await providersResponse.text();
  assert.deepEqual(JSON.parse(providersJson), { providers: [{ id: "gemini", name: "Gemini" }] });
  assert.ok(!providersJson.includes(userAKey) && !providersJson.includes(userBKey));

  const completionResponse = await request(app, "/api/chat/completions", {
    token: "user-a-token",
    body: {
      uid: "user-b",
      provider: "gemini",
      model: "manual-model",
      messages: [{ role: "user", content: "hello" }],
    },
  });
  const completionJson = await completionResponse.text();
  assert.equal(completionResponse.status, 200);
  assert.deepEqual(JSON.parse(completionJson), { reply: "mock reply" });
  assert.ok(!completionJson.includes(userAKey) && !completionJson.includes(userBKey));
  assert.deepEqual(reads, ["user-a", "user-a"]);
  assert.deepEqual(used, [userAKey]);
});
