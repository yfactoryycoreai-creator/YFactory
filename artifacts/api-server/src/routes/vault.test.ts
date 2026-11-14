import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import type { VaultKeyMetadata } from "../lib/apiKeyVault";
import { createVaultRouter } from "./vault";

const originalValue = "mock-only-secret-value";
const updatedValue = "mock-only-updated-value";

async function request(
  app: express.Express,
  path: string,
  options: { token?: string; method?: string; body?: unknown } = {},
): Promise<Response> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
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

function createTestApp() {
  const values = new Map<string, { uid: string; metadata: VaultKeyMetadata; value: string }>();
  let nextId = 0;
  const app = express();
  app.use(express.json());
  app.use("/api", createVaultRouter({
    verifyIdToken: async (token) => token === "user-a"
      ? "uid-a"
      : token === "user-b"
        ? "uid-b"
        : null,
    listProviders: async () => [],
    listKeys: async (uid) =>
      [...values.values()]
        .filter((item) => item.uid === uid)
        .map((item) => item.metadata),
    createKey: async (
      uid,
      provider,
      label,
      value,
      modelType = null,
      description = null,
      modelName = null,
      usage = null,
      providerId = null,
    ) => {
      const id = `mock-key-${++nextId}`;
      const metadata: VaultKeyMetadata = {
        id,
        provider,
        providerName: providerId === "gemini" ? "Gemini" : null,
        label: modelName ?? label.trim(),
        modelType,
        modelName,
        usage,
        chatSupported: usage === "chat" && Boolean(modelName?.startsWith("gemini-")),
        description,
        maskedValue: `••••${value.slice(-4)}`,
        enabled: true,
        createdAt: Date.now(),
        status: "ready",
      };
      values.set(`${uid}:${provider}:${id}`, { uid, metadata, value });
      return metadata;
    },
    updateKey: async (uid, provider, keyId, input) => {
      const stored = values.get(`${uid}:${provider}:${keyId}`);
      if (!stored) return null;
      const value = input.value?.trim() || stored.value;
      const metadata: VaultKeyMetadata = {
        ...stored.metadata,
        ...(input.label === undefined ? {} : { label: input.label.trim() }),
        ...(input.modelType === undefined ? {} : { modelType: input.modelType }),
        ...(input.modelName === undefined ? {} : { modelName: input.modelName }),
        ...(input.usage === undefined ? {} : { usage: input.usage }),
        ...(input.description === undefined ? {} : { description: input.description }),
        chatSupported: (input.usage ?? stored.metadata.usage) === "chat" &&
          (input.modelName ?? stored.metadata.modelName ?? "").startsWith("gemini-"),
        maskedValue: `••••${value.slice(-4)}`,
      };
      values.set(`${uid}:${provider}:${keyId}`, { uid, metadata, value });
      return metadata;
    },
    revealValue: async (uid, provider, keyId) =>
      values.get(`${uid}:${provider}:${keyId}`)?.value ?? null,
    deleteKey: async (uid, provider, keyId) => values.delete(`${uid}:${provider}:${keyId}`),
  }));
  return app;
}

test("vault secrets are owner-isolated, editable, revealable, and deletable", async () => {
  const app = createTestApp();
  const unauthenticated = await request(app, "/api/vault/keys");
  assert.equal(unauthenticated.status, 401);
  const unauthenticatedReveal = await request(
    app,
    "/api/vault/keys/custom/mock-key/reveal",
  );
  assert.equal(unauthenticatedReveal.status, 401);

  const created = await request(app, "/api/vault/keys", {
    token: "user-a",
    body: {
      label: "My Text Key",
      modelType: "text",
      description: "Private test metadata",
      value: originalValue,
    },
  });
  assert.equal(created.status, 201);
  const createdJson = await created.text();
  assert.ok(!createdJson.includes(originalValue));
  const key = JSON.parse(createdJson) as VaultKeyMetadata;

  const userBList = await request(app, "/api/vault/keys", { token: "user-b" });
  assert.deepEqual(await userBList.json(), { keys: [] });
  const userBReveal = await request(
    app,
    `/api/vault/keys/${key.provider}/${key.id}/value`,
    { token: "user-b" },
  );
  assert.equal(userBReveal.status, 404);

  const userAList = await request(app, "/api/vault/keys", { token: "user-a" });
  const listJson = await userAList.text();
  assert.ok(listJson.includes("My Text Key"));
  assert.ok(listJson.includes("Private test metadata"));
  assert.ok(!listJson.includes(originalValue));

  const revealed = await request(
    app,
    `/api/vault/keys/${key.provider}/${key.id}/reveal`,
    { token: "user-a" },
  );
  assert.match(revealed.headers.get("cache-control") ?? "", /no-store/);
  assert.deepEqual(await revealed.json(), { value: originalValue });

  const updated = await request(app, `/api/vault/keys/${key.provider}/${key.id}`, {
    token: "user-a",
    method: "PATCH",
    body: {
      label: "Renamed Text Key",
      modelType: "video",
      description: "Updated test metadata",
      value: updatedValue,
    },
  });
  assert.equal(updated.status, 200);
  const updatedJson = await updated.text();
  assert.ok(updatedJson.includes("Renamed Text Key"));
  assert.ok(updatedJson.includes("video"));
  assert.ok(!updatedJson.includes(updatedValue));

  const persisted = await request(app, "/api/vault/keys", { token: "user-a" });
  const persistedJson = await persisted.text();
  assert.ok(persistedJson.includes("Renamed Text Key"));
  assert.ok(persistedJson.includes("Updated test metadata"));
  assert.ok(!persistedJson.includes(updatedValue));
  const updatedReveal = await request(
    app,
    `/api/vault/keys/${key.provider}/${key.id}/value`,
    { token: "user-a" },
  );
  assert.deepEqual(await updatedReveal.json(), { value: updatedValue });

  const deleted = await request(app, `/api/vault/keys/${key.provider}/${key.id}`, {
    token: "user-a",
    method: "DELETE",
  });
  assert.equal(deleted.status, 204);
  const afterDelete = await request(app, "/api/vault/keys", { token: "user-a" });
  assert.deepEqual(await afterDelete.json(), { keys: [] });
});

test("new chat key metadata preserves the model name exactly and masks its value", async () => {
  const app = createTestApp();
  const response = await request(app, "/api/vault/keys", {
    token: "user-a",
    body: {
      modelName: "gemini-2.5-flash",
      usage: "chat",
      value: "mock-only-chat-secret",
    },
  });
  assert.equal(response.status, 201);
  const responseText = await response.text();
  assert.ok(!responseText.includes("mock-only-chat-secret"));
  const metadata = JSON.parse(responseText) as VaultKeyMetadata;
  assert.equal(metadata.modelName, "gemini-2.5-flash");
  assert.equal(metadata.usage, "chat");
  assert.equal(metadata.chatSupported, true);
});

test("provider registry exposes only configured adapters and saves provider-only keys", async () => {
  const app = createTestApp();
  const providerResponse = await request(app, "/api/vault/providers", { token: "user-a" });
  assert.deepEqual(await providerResponse.json(), {
    providers: [{ id: "gemini", label: "Gemini", adapterStatus: "available" }],
  });

  const created = await request(app, "/api/vault/keys", {
    token: "user-a",
    body: { provider: "gemini", value: "mock-only-provider-key" },
  });
  assert.equal(created.status, 201);
  const createdText = await created.text();
  assert.ok(!createdText.includes("mock-only-provider-key"));
  const key = JSON.parse(createdText) as VaultKeyMetadata;
  assert.equal(key.providerName, "Gemini");
  assert.equal(key.modelName, null);
  assert.equal(key.usage, null);

  const edited = await request(app, `/api/vault/keys/${key.provider}/${key.id}`, {
    token: "user-a",
    method: "PATCH",
    body: { value: null },
  });
  assert.equal(edited.status, 200);
  assert.equal((await edited.json() as VaultKeyMetadata).providerName, "Gemini");
  const revealed = await request(
    app,
    `/api/vault/keys/${key.provider}/${key.id}/reveal`,
    { token: "user-a" },
  );
  assert.deepEqual(await revealed.json(), { value: "mock-only-provider-key" });

  const deleted = await request(app, `/api/vault/keys/${key.provider}/${key.id}`, {
    token: "user-a",
    method: "DELETE",
  });
  assert.equal(deleted.status, 204);
});

test("provider IDs outside the adapter registry cannot be saved", async () => {
  const response = await request(createTestApp(), "/api/vault/keys", {
    token: "user-a",
    body: { provider: "unknown-provider", value: "mock-only-provider-key" },
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "This API key provider is not supported yet.",
    code: "provider_not_supported",
  });
});

test("reveal responses are non-cacheable and rate limited per verified user", async () => {
  const app = createTestApp();
  const created = await request(app, "/api/vault/keys", {
    token: "user-a",
    body: {
      label: "Old key",
      modelType: "text",
      value: originalValue,
    },
  });
  const key = JSON.parse(await created.text()) as VaultKeyMetadata;
  for (let index = 0; index < 12; index += 1) {
    const response = await request(
      app,
      `/api/vault/keys/${key.provider}/${key.id}/reveal`,
      { token: "user-a" },
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  }
  const limited = await request(
    app,
    `/api/vault/keys/${key.provider}/${key.id}/reveal`,
    { token: "user-a" },
  );
  assert.equal(limited.status, 429);
  assert.match(limited.headers.get("cache-control") ?? "", /no-store/);
});
