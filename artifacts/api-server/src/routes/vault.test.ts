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
    createKey: async (uid, provider, label, value, modelType = null, description = null) => {
      const id = `mock-key-${++nextId}`;
      const metadata: VaultKeyMetadata = {
        id,
        provider,
        label: label.trim(),
        modelType,
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
        label: input.label.trim(),
        modelType: input.modelType,
        description: input.description,
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
    `/api/vault/keys/${key.provider}/${key.id}/value`,
    { token: "user-a" },
  );
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
