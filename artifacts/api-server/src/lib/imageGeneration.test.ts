import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createKeyPool,
  type CredentialState,
  type KeyPoolProvider,
  type KeyPoolStateStore,
} from "./keyPool";
import {
  generateImageWithFallback,
  ImageGenerationFailure,
} from "./imageGeneration";

class MemoryStateStore implements KeyPoolStateStore {
  private readonly states = new Map<string, CredentialState>();

  async read(
    provider: KeyPoolProvider,
    index: number,
  ): Promise<CredentialState | null> {
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

const promptRestriction =
  "single image, one scene only, no grid, no collage, no panels, no text overlay";

function response(
  status: number,
  body: string | Uint8Array = "",
  contentType = "application/json",
) {
  return new Response(body, {
    status,
    headers: { "content-type": contentType },
  });
}

test("image fallback rotates credentials and visits providers in order", async () => {
  const calls: string[] = [];
  const pool = createKeyPool({
    env: {
      AGNES_API_KEY_1: "agnes-one",
      AGNES_API_KEY_2: "agnes-two",
      CLOUDFLARE_API_TOKEN_1: "cloudflare-one",
      CLOUDFLARE_ACCOUNT_ID_1: "cf-account-one",
      CLOUDFLARE_API_TOKEN_2: "cloudflare-two",
      CLOUDFLARE_ACCOUNT_ID_2: "cf-account-two",
      GLM_API_KEY_1: "glm-one",
      GLM_API_KEY_2: "glm-two",
    },
    stateStore: new MemoryStateStore(),
  });
  const fetchMock: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    const submittedPrompt =
      typeof body.prompt === "string"
        ? body.prompt
        : decodeURIComponent(url.pathname.split("/prompt/")[1] ?? "");

    assert.ok(submittedPrompt.includes(promptRestriction));

    if (url.hostname === "apihub.agnes-ai.com") {
      const credential = authorization === "Bearer agnes-one" ? "agnes#1" : "agnes#2";
      calls.push(credential);
      return response(credential === "agnes#1" ? 429 : 503);
    }
    if (url.hostname === "api.cloudflare.com") {
      const credential =
        authorization === "Bearer cloudflare-one" ? "cloudflare#1" : "cloudflare#2";
      calls.push(credential);
      return response(credential === "cloudflare#1" ? 429 : 503);
    }
    if (url.hostname === "open.bigmodel.cn") {
      const credential = authorization === "Bearer glm-one" ? "glm#1" : "glm#2";
      calls.push(credential);
      return response(503);
    }
    if (url.hostname === "image.pollinations.ai") {
      calls.push("pollinations");
      return response(
        200,
        new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
        "image/jpeg",
      );
    }
    throw new Error("Unexpected provider endpoint.");
  };

  const image = await generateImageWithFallback(
    "A fox reading in a quiet garden.",
    fetchMock,
    undefined,
    pool,
  );

  assert.deepEqual(calls, [
    "agnes#1",
    "agnes#2",
    "cloudflare#1",
    "cloudflare#2",
    "glm#1",
    "glm#2",
    "pollinations",
  ]);
  assert.equal(image.provider, "pollinations");
  assert.equal(image.mimeType, "image/jpeg");
});

test("HTTP 400 stops credential rotation and provider fallback", async () => {
  let calls = 0;
  const pool = createKeyPool({
    env: {
      AGNES_API_KEY_1: "agnes-one",
      AGNES_API_KEY_2: "agnes-two",
      GLM_API_KEY_1: "glm-one",
    },
    stateStore: new MemoryStateStore(),
  });
  const fetchMock: typeof fetch = async () => {
    calls += 1;
    return response(400);
  };

  await assert.rejects(
    generateImageWithFallback(
      "A prompt rejected by the provider.",
      fetchMock,
      undefined,
      pool,
    ),
    (error: unknown) =>
      error instanceof ImageGenerationFailure && error.code === "bad_prompt",
  );
  assert.equal(calls, 1);
});
