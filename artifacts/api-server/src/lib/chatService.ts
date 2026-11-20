import {
  ChatAbortError,
  ChatAdapterError,
  type ChatAdapterRegistry,
  type ChatMessage,
  type ChatProvider,
} from "./chatAdapters";
import type { GeminiChatKey } from "./apiKeyVault";

export type ChatFailureCode =
  | "missing_key"
  | "rate_limited"
  | "auth_failed"
  | "timeout"
  | "bad_prompt"
  | "model_not_found";

export class ChatServiceError extends Error {
  constructor(readonly code: ChatFailureCode) {
    super(code);
    this.name = "ChatServiceError";
  }
}

export async function completeWithRotation(input: {
  provider: ChatProvider;
  model: string;
  messages: ChatMessage[];
  keys: GeminiChatKey[];
  adapters: ChatAdapterRegistry;
  signal?: AbortSignal;
  onFailure: (keyId: string, status: number | null) => Promise<void>;
  onSuccess: (keyId: string) => Promise<void>;
}): Promise<string> {
  if (input.keys.length === 0) throw new ChatServiceError("missing_key");
  const adapter = input.adapters[input.provider];
  if (!adapter) throw new ChatServiceError("model_not_found");
  let lastFailure: ChatFailureCode = "timeout";

  for (const key of input.keys) {
    try {
      const reply = await adapter.complete({
        apiKey: key.value,
        model: input.model,
        messages: input.messages,
        signal: input.signal,
      });
      await input.onSuccess(key.id).catch(() => undefined);
      return reply;
    } catch (error) {
      if (error instanceof ChatAbortError || input.signal?.aborted) {
        throw new ChatAbortError();
      }
      const status = error instanceof ChatAdapterError ? error.status : null;
      if (
        error instanceof ChatAdapterError &&
        (error.reason === "model_not_found" || status === 404)
      ) {
        throw new ChatServiceError("model_not_found");
      }
      if (status === 400 || (status !== null && status >= 400 && status < 500 &&
        status !== 401 && status !== 403 && status !== 429)) {
        throw new ChatServiceError("bad_prompt");
      }
      if (status === 401 || status === 403) {
        lastFailure = "auth_failed";
      } else if (status === 429) {
        lastFailure = "rate_limited";
      } else {
        lastFailure = "timeout";
      }
      await input.onFailure(key.id, status);
    }
  }

  throw new ChatServiceError(lastFailure);
}

export async function streamWithRotation(input: {
  provider: ChatProvider;
  model: string;
  messages: ChatMessage[];
  keys: GeminiChatKey[];
  adapters: ChatAdapterRegistry;
  signal?: AbortSignal;
  onChunk: (delta: string) => void;
  onFailure: (keyId: string, status: number | null) => Promise<void>;
  onSuccess: (keyId: string) => Promise<void>;
}): Promise<string> {
  if (input.keys.length === 0) throw new ChatServiceError("missing_key");
  const adapter = input.adapters[input.provider];
  if (!adapter) throw new ChatServiceError("model_not_found");
  let lastFailure: ChatFailureCode = "timeout";

  for (const key of input.keys) {
    let emittedAnyChunk = false;
    const emitChunk = (delta: string) => {
      if (!delta) return;
      emittedAnyChunk = true;
      input.onChunk(delta);
    };
    try {
      const reply = adapter.completeStream
        ? await adapter.completeStream({
            apiKey: key.value,
            model: input.model,
            messages: input.messages,
            signal: input.signal,
            onChunk: emitChunk,
          })
        : await (async () => {
            const full = await adapter.complete({
              apiKey: key.value,
              model: input.model,
              messages: input.messages,
              signal: input.signal,
            });
            emitChunk(full);
            return full;
          })();
      await input.onSuccess(key.id).catch(() => undefined);
      return reply;
    } catch (error) {
      if (error instanceof ChatAbortError || input.signal?.aborted) {
        throw new ChatAbortError();
      }
      if (emittedAnyChunk) {
        throw new ChatServiceError("timeout");
      }
      const status = error instanceof ChatAdapterError ? error.status : null;
      if (
        error instanceof ChatAdapterError &&
        (error.reason === "model_not_found" || status === 404)
      ) {
        throw new ChatServiceError("model_not_found");
      }
      if (status === 400 || (status !== null && status >= 400 && status < 500 &&
        status !== 401 && status !== 403 && status !== 429)) {
        throw new ChatServiceError("bad_prompt");
      }
      if (status === 401 || status === 403) {
        lastFailure = "auth_failed";
      } else if (status === 429) {
        lastFailure = "rate_limited";
      } else {
        lastFailure = "timeout";
      }
      await input.onFailure(key.id, status);
    }
  }

  throw new ChatServiceError(lastFailure);
}
