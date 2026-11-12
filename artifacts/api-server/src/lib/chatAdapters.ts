export type ChatRole = "system" | "user" | "assistant";
export type ChatMessage = { role: ChatRole; content: string };
export type ChatProvider = "gemini";

export class ChatAdapterError extends Error {
  constructor(readonly status: number | null) {
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
        if (!response.ok) throw new ChatAdapterError(response.status);
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
