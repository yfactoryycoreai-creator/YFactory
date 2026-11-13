import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
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
    listKeys: async () => {
      keyReads += 1;
      return [];
    },
    getKey: async () => null,
  });
  const app = createTestApp(router);
  const modelsResponse = await request(app, "/api/chat/models");
  assert.equal(modelsResponse.status, 401);
  assert.deepEqual(await modelsResponse.json(), { code: "auth_failed" });
  const completionResponse = await request(app, "/api/chat/completions", {
    body: {
      provider: "custom",
      keyId: "user-a-key",
      messages: [{ role: "user", content: "hello" }],
    },
  });
  assert.equal(completionResponse.status, 401);
  assert.deepEqual(await completionResponse.json(), { code: "auth_failed" });
  assert.equal(keyReads, 0);
});

test("Chat lists supported user-owned models and uses only the selected owner's key", async () => {
  const reads: string[] = [];
  const used: string[] = [];
  const modelsForUser = (uid: string) => [{
    provider: "custom",
    id: `${uid}-key`,
    modelName: "gemini-2.5-flash",
    enabled: true,
    failed: false,
    unsupported: {
      provider: "custom",
      id: `${uid}-unsupported`,
      modelName: "other-model",
      enabled: true,
      failed: false,
    },
  }];
  const adapters: ChatAdapterRegistry = {
    gemini: {
      complete: async ({ apiKey }) => {
        used.push(apiKey);
        return "mock reply";
      },
    },
  };
  const router = createChatRouter({
    verifyIdToken: async (token) =>
      token === "user-a-token" ? "user-a" : token === "user-b-token" ? "user-b" : null,
    listKeys: async (uid) => {
      reads.push(uid);
      const { unsupported, ...supported } = modelsForUser(uid)[0]!;
      return [supported, unsupported];
    },
    getKey: async (uid, provider, keyId) => {
      reads.push(uid);
      if (provider !== "custom" || keyId !== `${uid}-key`) return null;
      return {
        id: keyId,
        provider,
        modelName: "gemini-2.5-flash",
        value: uid === "user-a" ? userAKey : userBKey,
        enabled: true,
        failed: false,
      };
    },
    adapters,
  });
  const app = createTestApp(router);
  const modelsResponse = await request(app, "/api/chat/models", { token: "user-a-token" });
  const modelsJson = await modelsResponse.text();
  assert.deepEqual(JSON.parse(modelsJson), {
    models: [{
      provider: "custom",
      id: "user-a-key",
      modelName: "gemini-2.5-flash",
    }],
  });
  assert.ok(!modelsJson.includes(userAKey) && !modelsJson.includes(userBKey));

  const completionResponse = await request(app, "/api/chat/completions", {
    token: "user-a-token",
    body: {
      uid: "user-b",
      provider: "custom",
      keyId: "user-a-key",
      messages: [{ role: "user", content: "hello" }],
    },
  });
  const completionJson = await completionResponse.text();
  assert.equal(completionResponse.status, 200);
  assert.deepEqual(JSON.parse(completionJson), { reply: "mock reply" });
  assert.ok(!completionJson.includes(userAKey) && !completionJson.includes(userBKey));
  assert.deepEqual(reads, ["user-a", "user-a"]);
  assert.deepEqual(used, [userAKey]);

  const userBCrossRead = await request(app, "/api/chat/completions", {
    token: "user-a-token",
    body: {
      uid: "user-b",
      provider: "custom",
      keyId: "user-b-key",
      messages: [{ role: "user", content: "hello" }],
    },
  });
  assert.equal(userBCrossRead.status, 404);
  assert.deepEqual(await userBCrossRead.json(), { code: "missing_key" });
  assert.deepEqual(used, [userAKey]);

  const userBModels = await request(app, "/api/chat/models", { token: "user-b-token" });
  assert.deepEqual(await userBModels.json(), {
    models: [{
      provider: "custom",
      id: "user-b-key",
      modelName: "gemini-2.5-flash",
    }],
  });
});

test("unknown or unsupported saved model IDs return a sanitized model_not_found code", async () => {
  const router = createChatRouter({
    verifyIdToken: async () => "user-a",
    listKeys: async () => [],
    getKey: async () => ({
      id: "unknown-model-key",
      provider: "custom",
      modelName: "not-a-supported-model",
      value: userAKey,
      enabled: true,
      failed: false,
    }),
  });
  const response = await request(createTestApp(router), "/api/chat/completions", {
    token: "user-a-token",
    body: {
      provider: "custom",
      keyId: "unknown-model-key",
      messages: [{ role: "user", content: "hello" }],
    },
  });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { code: "model_not_found" });
});
