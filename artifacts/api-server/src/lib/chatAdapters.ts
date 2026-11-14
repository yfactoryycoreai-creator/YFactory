export type ChatRole = "system" | "user" | "assistant";
export type ChatMessage = { role: ChatRole; content: string };
export type ChatProvider = "gemini";

export class ChatAdapterError extends Error {
  constructor(
    readonly status: number | null,
    readonly reason: "model_not_found" | null = null,
  ) {
    super("Chat provider request failed.");
    this.name = "ChatAdapterError";
  }
}

export type ChatAdapter = {
  complete(input: {
    apiKey: string;
    model: string;
    messages: ChatMessage[];
  }): Promise<string>;
};

export type ChatAdapterRegistry = Record<ChatProvider, ChatAdapter>;

const CHAT_MODEL_REGISTRY: Array<{ pattern: RegExp; provider: ChatProvider }> = [
  { pattern: /^gemini-[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/i, provider: "gemini" },
];

export function chatProviderForModel(model: string): ChatProvider | null {
  return CHAT_MODEL_REGISTRY.find((entry) => entry.pattern.test(model))?.provider ?? null;
}

const GEMINI_CHAT_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

export function createGeminiChatAdapter(
  fetcher: typeof fetch = fetch,
  timeoutMs = 20_000,
): ChatAdapter {
  return {
    async complete({ apiKey, model, messages }) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetcher(GEMINI_CHAT_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ model, messages }),
            signal: controller.signal,
          });
        } catch {
          throw new ChatAdapterError(null);
        }
        if (!response.ok) {
          let isUnknownModel = response.status === 404;
          if (response.status === 400) {
            const errorBody = await response.clone().text().catch(() => "");
            isUnknownModel =
              /model.{0,100}(?:not found|not supported|unknown|does not exist)|(?:not found|not supported|unknown|does not exist).{0,100}model/i
                .test(errorBody);
          }
          throw new ChatAdapterError(
            response.status,
            isUnknownModel ? "model_not_found" : null,
          );
        }
        const payload: unknown = await response.json().catch(() => null);
        const content =
          typeof payload === "object" && payload !== null &&
          Array.isArray((payload as { choices?: unknown }).choices)
            ? (payload as { choices: Array<{ message?: { content?: unknown } }> })
                .choices[0]?.message?.content
            : undefined;
        if (typeof content !== "string" || !content.trim()) {
          throw new ChatAdapterError(502);
        }
        return content;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

// Add one adapter entry here for each future chat provider.
export const CHAT_ADAPTERS: ChatAdapterRegistry = {
  gemini: createGeminiChatAdapter(),
};

export const API_KEY_PROVIDER_REGISTRY = [
  { id: "gemini", label: "Gemini", adapterStatus: "available" },
] as const satisfies ReadonlyArray<{
  id: ChatProvider;
  label: string;
  adapterStatus: "available";
}>;
