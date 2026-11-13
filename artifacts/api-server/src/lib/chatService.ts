import {
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
  onFailure: (keyId: string, status: number | null) => Promise<void>;
  onSuccess: (keyId: string) => Promise<void>;
}): Promise<string> {
  if (input.keys.length === 0) throw new ChatServiceError("missing_key");
  let lastFailure: ChatFailureCode = "timeout";

  for (const key of input.keys) {
    try {
      const reply = await input.adapters[input.provider].complete({
        apiKey: key.value,
        model: input.model,
        messages: input.messages,
      });
      await input.onSuccess(key.id).catch(() => undefined);
      return reply;
    } catch (error) {
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
