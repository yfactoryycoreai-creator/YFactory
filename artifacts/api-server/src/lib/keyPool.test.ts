import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createKeyPool,
  KeyPoolHttpError,
  type CredentialState,
  type KeyPoolProvider,
  type KeyPoolStateStore,
} from "./keyPool";

class MemoryStateStore implements KeyPoolStateStore {
  private readonly states = new Map<string, CredentialState>();

  async read(provider: KeyPoolProvider, index: number): Promise<CredentialState | null> {
    return this.states.get(`${provider}#${index}`) ?? null;
  }

  async write(
    provider: KeyPoolProvider,
    index: number,
    state: CredentialState,
  ): Promise<void> {
    this.states.set(`${provider}#${index}`, state);
  }
}

test("discovers numbered credentials, unnumbered extras, and complete Cloudflare pairs", async () => {
  const skippedPairs: Array<{ provider: "cloudflare"; index: number }> = [];
  const pool = createKeyPool({
    env: {
      AGNES_API_KEY: "mock-agnes-base",
      AGNES_API_KEY_1: "mock-agnes-one",
      AGNES_API_KEY_3: "mock-agnes-three",
      CLOUDFLARE_API_TOKEN_1: "mock-cloudflare-one",
      CLOUDFLARE_API_TOKEN_2: "mock-cloudflare-two",
      CLOUDFLARE_ACCOUNT_ID_2: "mock-account-two",
      GLM_API_KEY_4: "mock-glm-four",
      MAGIC_HOUR_API_KEY_2: "mock-magic-two",
    },
    stateStore: new MemoryStateStore(),
    onIncompleteCloudflarePair: (provider, index) => {
      skippedPairs.push({ provider, index });
    },
  });

  const status = await pool.readStatus();
  const agnes = status.providers.find((provider) => provider.provider === "agnes");
  const cloudflare = status.providers.find((provider) => provider.provider === "cloudflare");
  const glm = status.providers.find((provider) => provider.provider === "glm");
  const magicHour = status.providers.find((provider) => provider.provider === "magic_hour");

  assert.deepEqual(agnes?.credentials.map((credential) => credential.index), [0, 1, 3]);
  assert.deepEqual(cloudflare?.credentials.map((credential) => credential.index), [2]);
  assert.deepEqual(glm?.credentials.map((credential) => credential.index), [4]);
  assert.deepEqual(magicHour?.credentials.map((credential) => credential.index), [2]);
  assert.deepEqual(skippedPairs, [{ provider: "cloudflare", index: 1 }]);
  assert.equal(JSON.stringify(status).includes("mock-"), false);
  assert.equal(JSON.stringify(status).includes("mock-account"), false);
});

test("429 on Agnes credential 1 cools it and tries credential 2", async () => {
  const store = new MemoryStateStore();
  const pool = createKeyPool({
    env: {
      AGNES_API_KEY_1: "mock-agnes-one",
      AGNES_API_KEY_2: "mock-agnes-two",
    },
    stateStore: store,
    now: () => 1_000,
  });
  const calls: number[] = [];

  const result = await pool.run("agnes", async ({ index }) => {
    calls.push(index);
    if (index === 1) throw new KeyPoolHttpError(429, "rate limit", "120");
    return "mock-image-result";
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(
    result.attempts.map((entry) => entry.outcome),
    ["rate_limited", "ok"],
  );
  if (result.ok) assert.equal(result.value, "mock-image-result");
  const status = await pool.readStatus();
  const agnes = status.providers.find((provider) => provider.provider === "agnes");
  assert.deepEqual(agnes?.credentials, [
    { index: 1, state: "cooldown", until: 121_000 },
    { index: 2, state: "ready" },
  ]);
  assert.equal(JSON.stringify(result).includes("mock-agnes"), false);
});

test("400 returns bad_prompt without trying another credential", async () => {
  const pool = createKeyPool({
    env: {
      AGNES_API_KEY_1: "mock-agnes-one",
      AGNES_API_KEY_2: "mock-agnes-two",
    },
    stateStore: new MemoryStateStore(),
  });
  const calls: number[] = [];

  const result = await pool.run("agnes", async ({ index }) => {
    calls.push(index);
    throw new KeyPoolHttpError(400, "prompt rejected by content policy");
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "bad_prompt");
  assert.deepEqual(calls, [1]);
  assert.equal(JSON.stringify(result).includes("prompt rejected"), false);
  assert.equal(JSON.stringify(result).includes("mock-agnes"), false);
});

test("401 disables only the failing credential and persists its state", async () => {
  const store = new MemoryStateStore();
  const env = {
    AGNES_API_KEY_1: "mock-agnes-one",
    AGNES_API_KEY_2: "mock-agnes-two",
  };
  const pool = createKeyPool({ env, stateStore: store, now: () => 2_000 });
  const calls: number[] = [];

  const result = await pool.run("agnes", async ({ index }) => {
    calls.push(index);
    if (index === 1) throw new KeyPoolHttpError(401, "invalid API key");
    return "ok";
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [1, 2]);
  const restartedPool = createKeyPool({ env, stateStore: store, now: () => 2_000 });
  const status = await restartedPool.readStatus();
  const agnes = status.providers.find((provider) => provider.provider === "agnes");
  assert.equal(agnes?.credentials[0]?.state, "disabled");
  assert.equal(agnes?.credentials[1]?.state, "ready");
  assert.equal(JSON.stringify(result).includes("mock-agnes"), false);
});

test("a timed-out attempt cools its credential and tries the next one", async () => {
  const pool = createKeyPool({
    env: {
      AGNES_API_KEY_1: "mock-agnes-one",
      AGNES_API_KEY_2: "mock-agnes-two",
    },
    stateStore: new MemoryStateStore(),
    attemptTimeoutMs: { agnes: 10 },
    totalDeadlineMs: 1_000,
  });
  const calls: number[] = [];

  const result = await pool.run("agnes", async ({ index }, signal) => {
    calls.push(index);
    if (index === 1) {
      return await new Promise<string>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            const timeoutError = new Error("mock timeout");
            timeoutError.name = "AbortError";
            reject(timeoutError);
          },
          { once: true },
        );
      });
    }
    return "ok";
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(
    result.attempts.map((entry) => entry.outcome),
    ["timeout", "ok"],
  );
  assert.equal(JSON.stringify(result).includes("mock-agnes"), false);
});
