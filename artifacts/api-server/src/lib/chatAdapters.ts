export type ChatRole = "system" | "user" | "assistant";
export type ChatImageAttachment = {
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  dataUrl: string;
};

export type ChatMessage = {
  role: ChatRole;
  content: string;
  images?: ChatImageAttachment[];
};

function toOpenAiMessages(messages: ChatMessage[]) {
  return messages.map((msg) => {
    if (!msg.images || msg.images.length === 0 || msg.role !== "user") {
      return { role: msg.role, content: msg.content };
    }
    return {
      role: msg.role,
      content: [
        { type: "text", text: msg.content },
        ...msg.images.map((img) => ({
          type: "image_url",
          image_url: { url: img.dataUrl },
        })),
      ],
    };
  });
}

function toAnthropicMessages(messages: ChatMessage[]) {
  return messages
    .filter((item) => item.role !== "system")
    .map((item) => {
      if (!item.images || item.images.length === 0 || item.role !== "user") {
        return { role: item.role, content: item.content };
      }
      const blocks: Array<Record<string, unknown>> = [];
      for (const img of item.images) {
        const commaIdx = img.dataUrl.indexOf(",");
        const base64Data = commaIdx > 0 ? img.dataUrl.slice(commaIdx + 1) : "";
        if (base64Data) {
          blocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: img.mimeType,
              data: base64Data,
            },
          });
        }
      }
      blocks.push({ type: "text", text: item.content });
      return { role: item.role, content: blocks };
    });
}

export type ChatProvider =
  | "gemini"
  | "google"
  | "openai"
  | "openrouter"
  | "anthropic"
  | "xai"
  | "deepseek"
  | "alibaba"
  | "mistral-ai"
  | "meta"
  | "cohere"
  | "amazon"
  | "microsoft"
  | "ibm"
  | "nvidia"
  | "ai21-labs"
  | "z-ai"
  | "minimax"
  | "moonshot-ai"
  | "bytedance"
  | "baidu"
  | "tencent"
  | "01-ai"
  | "zhipu-ai"
  | "together-ai"
  | "replicate"
  | "fal"
  | "fireworks-ai"
  | "groq"
  | "perplexity"
  | "sarvam-ai"
  | "krutrim"
  | "tii"
  | "g42-inception"
  | "sdaia"
  | "black-forest-labs"
  | "stability-ai"
  | "ideogram"
  | "recraft"
  | "adobe"
  | "leonardo-ai"
  | "luma-ai"
  | "krea"
  | "freepik"
  | "getty-images"
  | "shutterstock"
  | "bria"
  | "kuaishou"
  | "runway"
  | "pika"
  | "higgsfield"
  | "heygen"
  | "synthesia"
  | "colossyan"
  | "d-id"
  | "vidnoz"
  | "kaiber"
  | "genmo"
  | "haiper"
  | "pixverse"
  | "vidu"
  | "dreamina"
  | "runway-dev";

export class ChatAdapterError extends Error {
  constructor(
    readonly status: number | null,
    readonly reason: "model_not_found" | null = null,
  ) {
    super("Chat provider request failed.");
    this.name = "ChatAdapterError";
  }
}

export class ChatAbortError extends Error {
  constructor() {
    super("Chat request aborted.");
    this.name = "ChatAbortError";
  }
}

export type ChatCompleteInput = {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
};

export type ChatStreamInput = ChatCompleteInput & {
  onChunk: (delta: string) => void;
};

export type ChatAdapter = {
  complete(input: ChatCompleteInput): Promise<string>;
  completeStream?(input: ChatStreamInput): Promise<string>;
};

export type ChatAdapterRegistry = Record<string, ChatAdapter>;

export const API_KEY_PROVIDER_REGISTRY = [
  { id: "gemini", label: "Gemini", adapterStatus: "available" },
  { id: "google", label: "Google", adapterStatus: "available" },
  { id: "openai", label: "OpenAI", adapterStatus: "available" },
  { id: "openrouter", label: "OpenRouter", adapterStatus: "available" },
  { id: "anthropic", label: "Anthropic", adapterStatus: "available" },
  { id: "xai", label: "xAI", adapterStatus: "available" },
  { id: "deepseek", label: "DeepSeek", adapterStatus: "available" },
  { id: "alibaba", label: "Alibaba", adapterStatus: "available" },
  { id: "mistral-ai", label: "Mistral AI", adapterStatus: "available" },
  { id: "meta", label: "Meta", adapterStatus: "available" },
  { id: "cohere", label: "Cohere", adapterStatus: "available" },
  { id: "amazon", label: "Amazon", adapterStatus: "available" },
  { id: "microsoft", label: "Microsoft", adapterStatus: "available" },
  { id: "ibm", label: "IBM", adapterStatus: "available" },
  { id: "nvidia", label: "NVIDIA", adapterStatus: "available" },
  { id: "ai21-labs", label: "AI21 Labs", adapterStatus: "available" },
  { id: "z-ai", label: "Z.ai", adapterStatus: "available" },
  { id: "minimax", label: "MiniMax", adapterStatus: "available" },
  { id: "moonshot-ai", label: "Moonshot AI", adapterStatus: "available" },
  { id: "bytedance", label: "ByteDance", adapterStatus: "available" },
  { id: "baidu", label: "Baidu", adapterStatus: "available" },
  { id: "tencent", label: "Tencent", adapterStatus: "available" },
  { id: "01-ai", label: "01.AI", adapterStatus: "available" },
  { id: "zhipu-ai", label: "Zhipu AI", adapterStatus: "available" },
  { id: "together-ai", label: "Together AI", adapterStatus: "available" },
  { id: "replicate", label: "Replicate", adapterStatus: "available" },
  { id: "fal", label: "fal", adapterStatus: "available" },
  { id: "fireworks-ai", label: "Fireworks AI", adapterStatus: "available" },
  { id: "groq", label: "Groq", adapterStatus: "available" },
  { id: "perplexity", label: "Perplexity", adapterStatus: "available" },
  { id: "sarvam-ai", label: "Sarvam AI", adapterStatus: "available" },
  { id: "krutrim", label: "Krutrim", adapterStatus: "available" },
  { id: "tii", label: "TII", adapterStatus: "available" },
  { id: "g42-inception", label: "G42 / Inception", adapterStatus: "available" },
  { id: "sdaia", label: "SDAIA", adapterStatus: "available" },
  { id: "black-forest-labs", label: "Black Forest Labs", adapterStatus: "available" },
  { id: "stability-ai", label: "Stability AI", adapterStatus: "available" },
  { id: "ideogram", label: "Ideogram", adapterStatus: "available" },
  { id: "recraft", label: "Recraft", adapterStatus: "available" },
  { id: "adobe", label: "Adobe", adapterStatus: "available" },
  { id: "leonardo-ai", label: "Leonardo AI", adapterStatus: "available" },
  { id: "luma-ai", label: "Luma AI", adapterStatus: "available" },
  { id: "krea", label: "Krea", adapterStatus: "available" },
  { id: "freepik", label: "Freepik", adapterStatus: "available" },
  { id: "getty-images", label: "Getty Images", adapterStatus: "available" },
  { id: "shutterstock", label: "Shutterstock", adapterStatus: "available" },
  { id: "bria", label: "Bria", adapterStatus: "available" },
  { id: "kuaishou", label: "Kuaishou", adapterStatus: "available" },
  { id: "runway", label: "Runway", adapterStatus: "available" },
  { id: "pika", label: "Pika", adapterStatus: "available" },
  { id: "higgsfield", label: "Higgsfield", adapterStatus: "available" },
  { id: "heygen", label: "HeyGen", adapterStatus: "available" },
  { id: "synthesia", label: "Synthesia", adapterStatus: "available" },
  { id: "colossyan", label: "Colossyan", adapterStatus: "available" },
  { id: "d-id", label: "D-ID", adapterStatus: "available" },
  { id: "vidnoz", label: "Vidnoz", adapterStatus: "available" },
  { id: "kaiber", label: "Kaiber", adapterStatus: "available" },
  { id: "genmo", label: "Genmo", adapterStatus: "available" },
  { id: "haiper", label: "Haiper", adapterStatus: "available" },
  { id: "pixverse", label: "PixVerse", adapterStatus: "available" },
  { id: "vidu", label: "Vidu", adapterStatus: "available" },
  { id: "dreamina", label: "Dreamina", adapterStatus: "available" },
  { id: "runway-dev", label: "Runway Dev", adapterStatus: "available" },
] as const satisfies ReadonlyArray<{
  id: ChatProvider;
  label: string;
  adapterStatus: "available";
}>;

const CHAT_MODEL_REGISTRY: Array<{ pattern: RegExp; provider: ChatProvider }> = [
  { pattern: /^[a-z0-9][a-z0-9._-]{0,60}\/[A-Za-z0-9][A-Za-z0-9._:-]{0,126}$/i, provider: "openrouter" },
  { pattern: /^gemini-[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/i, provider: "gemini" },
  { pattern: /^(?:google:|veo-|imagen-)[A-Za-z0-9._:-]{1,160}$/i, provider: "google" },
  { pattern: /^(?:openai:|gpt-|o1-|o1$|o3-|o3$|o4-|chatgpt-|ft:gpt-)[A-Za-z0-9._:-]{0,160}$/i, provider: "openai" },
  { pattern: /^(?:anthropic:|claude-)[A-Za-z0-9._:-]{1,160}$/i, provider: "anthropic" },
  { pattern: /^(?:xai:|grok-)[A-Za-z0-9._:-]{1,160}$/i, provider: "xai" },
  { pattern: /^(?:deepseek:|deepseek-)[A-Za-z0-9._:-]{1,160}$/i, provider: "deepseek" },
  { pattern: /^(?:alibaba:|qwen|qwq-|wan-)[A-Za-z0-9._:-]{1,160}$/i, provider: "alibaba" },
  { pattern: /^(?:mistral-ai:|mistral-|ministral-|codestral-|pixtral-|open-mistral-|open-mixtral-|magistral-)[A-Za-z0-9._:-]{1,160}$/i, provider: "mistral-ai" },
  { pattern: /^(?:meta:|llama-|meta-llama-)[A-Za-z0-9._:-]{1,160}$/i, provider: "meta" },
  { pattern: /^(?:cohere:|command)[A-Za-z0-9._:-]{0,160}$/i, provider: "cohere" },
  { pattern: /^(?:amazon:|amazon\.|nova-)[A-Za-z0-9._:-]{1,160}$/i, provider: "amazon" },
  { pattern: /^(?:microsoft:|azure-|phi-)[A-Za-z0-9._:-]{1,160}$/i, provider: "microsoft" },
  { pattern: /^(?:ibm:|granite-)[A-Za-z0-9._:-]{1,160}$/i, provider: "ibm" },
  { pattern: /^(?:nvidia:|nemotron-|cosmos-)[A-Za-z0-9._:-]{1,160}$/i, provider: "nvidia" },
  { pattern: /^(?:ai21-labs:|jamba-)[A-Za-z0-9._:-]{1,160}$/i, provider: "ai21-labs" },
  { pattern: /^(?:z-ai:)[A-Za-z0-9._:-]{1,160}$/i, provider: "z-ai" },
  { pattern: /^(?:minimax:|minimax-|abab|hailuo-)[A-Za-z0-9._:-]{1,160}$/i, provider: "minimax" },
  { pattern: /^(?:moonshot-ai:|moonshot-|kimi-)[A-Za-z0-9._:-]{1,160}$/i, provider: "moonshot-ai" },
  { pattern: /^(?:bytedance:|doubao-|seed-|seedream-|seedance-|ep-)[A-Za-z0-9._:-]{1,160}$/i, provider: "bytedance" },
  { pattern: /^(?:baidu:|ernie-)[A-Za-z0-9._:-]{1,160}$/i, provider: "baidu" },
  { pattern: /^(?:tencent:|hunyuan-)[A-Za-z0-9._:-]{1,160}$/i, provider: "tencent" },
  { pattern: /^(?:01-ai:|yi-)[A-Za-z0-9._:-]{1,160}$/i, provider: "01-ai" },
  { pattern: /^(?:zhipu-ai:|glm-|chatglm-|cogview-|cogvideo)[A-Za-z0-9._:-]{1,160}$/i, provider: "zhipu-ai" },
  { pattern: /^(?:together-ai:)[A-Za-z0-9._:-]{1,160}$/i, provider: "together-ai" },
  { pattern: /^(?:replicate:)[A-Za-z0-9._:-]{1,160}$/i, provider: "replicate" },
  { pattern: /^(?:fal:)[A-Za-z0-9._:-]{1,160}$/i, provider: "fal" },
  { pattern: /^(?:fireworks-ai:|fireworks-)[A-Za-z0-9._:-]{1,160}$/i, provider: "fireworks-ai" },
  { pattern: /^(?:groq:)[A-Za-z0-9._:-]{1,160}$/i, provider: "groq" },
  { pattern: /^(?:perplexity:|sonar)[A-Za-z0-9._:-]{0,160}$/i, provider: "perplexity" },
  { pattern: /^(?:sarvam-ai:|sarvam-)[A-Za-z0-9._:-]{1,160}$/i, provider: "sarvam-ai" },
  { pattern: /^(?:krutrim:|krutrim-)[A-Za-z0-9._:-]{1,160}$/i, provider: "krutrim" },
  { pattern: /^(?:tii:|falcon-)[A-Za-z0-9._:-]{1,160}$/i, provider: "tii" },
  { pattern: /^(?:g42-inception:|jais-)[A-Za-z0-9._:-]{1,160}$/i, provider: "g42-inception" },
  { pattern: /^(?:sdaia:|allam-)[A-Za-z0-9._:-]{1,160}$/i, provider: "sdaia" },
  { pattern: /^(?:black-forest-labs:|flux-)[A-Za-z0-9._:-]{1,160}$/i, provider: "black-forest-labs" },
  { pattern: /^(?:stability-ai:|sd3|stable-)[A-Za-z0-9._:-]{1,160}$/i, provider: "stability-ai" },
  { pattern: /^(?:ideogram:|ideogram-)[A-Za-z0-9._:-]{1,160}$/i, provider: "ideogram" },
  { pattern: /^(?:recraft:|recraft-)[A-Za-z0-9._:-]{1,160}$/i, provider: "recraft" },
  { pattern: /^(?:adobe:|firefly-)[A-Za-z0-9._:-]{1,160}$/i, provider: "adobe" },
  { pattern: /^(?:leonardo-ai:|leonardo-)[A-Za-z0-9._:-]{1,160}$/i, provider: "leonardo-ai" },
  { pattern: /^(?:luma-ai:|photon-|ray-)[A-Za-z0-9._:-]{1,160}$/i, provider: "luma-ai" },
  { pattern: /^(?:krea:|krea-)[A-Za-z0-9._:-]{1,160}$/i, provider: "krea" },
  { pattern: /^(?:freepik:|freepik-)[A-Za-z0-9._:-]{1,160}$/i, provider: "freepik" },
  { pattern: /^(?:getty-images:|getty-)[A-Za-z0-9._:-]{1,160}$/i, provider: "getty-images" },
  { pattern: /^(?:shutterstock:|shutterstock-)[A-Za-z0-9._:-]{1,160}$/i, provider: "shutterstock" },
  { pattern: /^(?:bria:|bria-)[A-Za-z0-9._:-]{1,160}$/i, provider: "bria" },
  { pattern: /^(?:kuaishou:|kling-)[A-Za-z0-9._:-]{1,160}$/i, provider: "kuaishou" },
  { pattern: /^(?:runway:|gen4|gen-4)[A-Za-z0-9._:-]{0,160}$/i, provider: "runway" },
  { pattern: /^(?:pika:|pika-)[A-Za-z0-9._:-]{1,160}$/i, provider: "pika" },
  { pattern: /^(?:higgsfield:|higgsfield-)[A-Za-z0-9._:-]{1,160}$/i, provider: "higgsfield" },
  { pattern: /^(?:heygen:|heygen-)[A-Za-z0-9._:-]{1,160}$/i, provider: "heygen" },
  { pattern: /^(?:synthesia:|synthesia-)[A-Za-z0-9._:-]{1,160}$/i, provider: "synthesia" },
  { pattern: /^(?:colossyan:|colossyan-)[A-Za-z0-9._:-]{1,160}$/i, provider: "colossyan" },
  { pattern: /^(?:d-id:|did-)[A-Za-z0-9._:-]{1,160}$/i, provider: "d-id" },
  { pattern: /^(?:vidnoz:|vidnoz-)[A-Za-z0-9._:-]{1,160}$/i, provider: "vidnoz" },
  { pattern: /^(?:kaiber:|kaiber-)[A-Za-z0-9._:-]{1,160}$/i, provider: "kaiber" },
  { pattern: /^(?:genmo:|mochi-)[A-Za-z0-9._:-]{1,160}$/i, provider: "genmo" },
  { pattern: /^(?:haiper:|haiper-)[A-Za-z0-9._:-]{1,160}$/i, provider: "haiper" },
  { pattern: /^(?:pixverse:|pixverse-)[A-Za-z0-9._:-]{1,160}$/i, provider: "pixverse" },
  { pattern: /^(?:vidu:|vidu-)[A-Za-z0-9._:-]{1,160}$/i, provider: "vidu" },
  { pattern: /^(?:dreamina:|dreamina-)[A-Za-z0-9._:-]{1,160}$/i, provider: "dreamina" },
  { pattern: /^(?:runway-dev:)[A-Za-z0-9._:-]{1,160}$/i, provider: "runway-dev" },
];

export function chatProviderForModel(model: string): ChatProvider | null {
  return CHAT_MODEL_REGISTRY.find((entry) => entry.pattern.test(model))?.provider ?? null;
}

function stripProviderPrefix(model: string): string {
  const colonIndex = model.indexOf(":");
  if (colonIndex <= 0) return model;
  const candidate = model.slice(0, colonIndex).toLowerCase();
  const isKnownProvider = API_KEY_PROVIDER_REGISTRY.some((item) => item.id === candidate);
  return isKnownProvider ? model.slice(colonIndex + 1) : model;
}

function createLinkedSignal(timeoutMs: number, externalSignal?: AbortSignal): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }
  return {
    controller,
    cleanup: () => {
      clearTimeout(timeout);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
    },
  };
}

async function throwIfNotOk(response: Response): Promise<void> {
  if (response.ok) return;
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

function extractOpenAiContent(payload: unknown): string | undefined {
  if (
    typeof payload === "object" &&
    payload !== null &&
    Array.isArray((payload as { choices?: unknown }).choices)
  ) {
    const first = (
      payload as {
        choices: Array<{
          message?: { content?: unknown };
          delta?: { content?: unknown };
        }>;
      }
    ).choices[0];
    if (typeof first?.delta?.content === "string") {
      return first.delta.content;
    }
    if (typeof first?.message?.content === "string") {
      return first.message.content;
    }
  }
  return undefined;
}

const GEMINI_CHAT_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

export function createOpenAiCompatibleChatAdapter(
  endpointUrl: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 20_000,
): ChatAdapter {
  const streamTimeoutMs = Math.max(timeoutMs, 90_000);
  return {
    async complete({ apiKey, model, messages, signal }) {
      const { controller, cleanup } = createLinkedSignal(timeoutMs, signal);
      const targetModel = stripProviderPrefix(model);
      try {
        let response: Response;
        try {
          response = await fetcher(endpointUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ model: targetModel, messages: toOpenAiMessages(messages) }),
            signal: controller.signal,
          });
        } catch {
          if (signal?.aborted) throw new ChatAbortError();
          throw new ChatAdapterError(null);
        }
        await throwIfNotOk(response);
        const payload: unknown = await response.json().catch(() => null);
        const content = extractOpenAiContent(payload);
        if (typeof content !== "string" || !content.trim()) {
          throw new ChatAdapterError(502);
        }
        return content;
      } finally {
        cleanup();
      }
    },

    async completeStream({ apiKey, model, messages, signal, onChunk }) {
      const { controller, cleanup } = createLinkedSignal(streamTimeoutMs, signal);
      const targetModel = stripProviderPrefix(model);
      try {
        let response: Response;
        try {
          response = await fetcher(endpointUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body: JSON.stringify({ model: targetModel, messages: toOpenAiMessages(messages), stream: true }),
            signal: controller.signal,
          });
        } catch {
          if (signal?.aborted) throw new ChatAbortError();
          throw new ChatAdapterError(null);
        }
        await throwIfNotOk(response);

        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json") || !response.body) {
          const payload: unknown = await response.json().catch(() => null);
          const content = extractOpenAiContent(payload);
          if (typeof content !== "string" || !content.trim()) {
            throw new ChatAdapterError(502);
          }
          onChunk(content);
          return content;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let fullText = "";

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";
            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line.startsWith("data:")) continue;
              const dataText = line.slice(5).trim();
              if (!dataText || dataText === "[DONE]") continue;
              let parsed: unknown;
              try {
                parsed = JSON.parse(dataText);
              } catch {
                continue;
              }
              const delta = extractOpenAiContent(parsed);
              if (delta) {
                fullText += delta;
                onChunk(delta);
              }
            }
          }
          buffer += decoder.decode();
          if (buffer.trim().startsWith("data:")) {
            const dataText = buffer.trim().slice(5).trim();
            if (dataText && dataText !== "[DONE]") {
              try {
                const delta = extractOpenAiContent(JSON.parse(dataText));
                if (delta) {
                  fullText += delta;
                  onChunk(delta);
                }
              } catch {
                // Ignore trailing incomplete JSON frame.
              }
            }
          }
        } catch (error) {
          if (signal?.aborted) {
            throw new ChatAbortError();
          }
          if (error instanceof ChatAdapterError) throw error;
          if (fullText.trim()) return fullText;
          throw new ChatAdapterError(null);
        } finally {
          reader.releaseLock();
        }

        if (signal?.aborted) {
          throw new ChatAbortError();
        }
        if (!fullText.trim()) {
          throw new ChatAdapterError(502);
        }
        return fullText;
      } finally {
        cleanup();
      }
    },
  };
}

export function createGeminiChatAdapter(
  fetcher: typeof fetch = fetch,
  timeoutMs = 20_000,
): ChatAdapter {
  return createOpenAiCompatibleChatAdapter(GEMINI_CHAT_URL, fetcher, timeoutMs);
}

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

export function createAnthropicChatAdapter(
  fetcher: typeof fetch = fetch,
  timeoutMs = 20_000,
): ChatAdapter {
  const streamTimeoutMs = Math.max(timeoutMs, 90_000);
  const preparePayload = (model: string, messages: ChatMessage[], stream: boolean) => {
    const targetModel = stripProviderPrefix(model);
    const systemMessages = messages
      .filter((item) => item.role === "system")
      .map((item) => item.content)
      .join("\n\n");
    const conversationMessages = toAnthropicMessages(messages);
    return {
      model: targetModel,
      max_tokens: 4096,
      ...(systemMessages ? { system: systemMessages } : {}),
      messages: conversationMessages,
      ...(stream ? { stream: true } : {}),
    };
  };

  return {
    async complete({ apiKey, model, messages, signal }) {
      const { controller, cleanup } = createLinkedSignal(timeoutMs, signal);
      try {
        let response: Response;
        try {
          response = await fetcher(ANTHROPIC_MESSAGES_URL, {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(preparePayload(model, messages, false)),
            signal: controller.signal,
          });
        } catch {
          if (signal?.aborted) throw new ChatAbortError();
          throw new ChatAdapterError(null);
        }
        await throwIfNotOk(response);
        const payload: unknown = await response.json().catch(() => null);
        const contentBlocks =
          typeof payload === "object" &&
          payload !== null &&
          Array.isArray((payload as { content?: unknown }).content)
            ? (payload as { content: Array<{ type?: unknown; text?: unknown }> }).content
            : [];
        const textBlock = contentBlocks.find(
          (block) => typeof block?.text === "string" && block.text.trim().length > 0,
        );
        if (!textBlock || typeof textBlock.text !== "string") {
          throw new ChatAdapterError(502);
        }
        return textBlock.text;
      } finally {
        cleanup();
      }
    },

    async completeStream({ apiKey, model, messages, signal, onChunk }) {
      const { controller, cleanup } = createLinkedSignal(streamTimeoutMs, signal);
      try {
        let response: Response;
        try {
          response = await fetcher(ANTHROPIC_MESSAGES_URL, {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body: JSON.stringify(preparePayload(model, messages, true)),
            signal: controller.signal,
          });
        } catch {
          if (signal?.aborted) throw new ChatAbortError();
          throw new ChatAdapterError(null);
        }
        await throwIfNotOk(response);

        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json") || !response.body) {
          const payload: unknown = await response.json().catch(() => null);
          const contentBlocks =
            typeof payload === "object" &&
            payload !== null &&
            Array.isArray((payload as { content?: unknown }).content)
              ? (payload as { content: Array<{ type?: unknown; text?: unknown }> }).content
              : [];
          const textBlock = contentBlocks.find(
            (block) => typeof block?.text === "string" && block.text.trim().length > 0,
          );
          if (!textBlock || typeof textBlock.text !== "string") {
            throw new ChatAdapterError(502);
          }
          onChunk(textBlock.text);
          return textBlock.text;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let fullText = "";

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";
            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line.startsWith("data:")) continue;
              const dataText = line.slice(5).trim();
              if (!dataText) continue;
              let parsed: unknown;
              try {
                parsed = JSON.parse(dataText);
              } catch {
                continue;
              }
              if (typeof parsed !== "object" || parsed === null) continue;
              const event = parsed as {
                type?: unknown;
                delta?: { type?: unknown; text?: unknown };
              };
              if (
                event.type === "content_block_delta" &&
                event.delta?.type === "text_delta" &&
                typeof event.delta.text === "string"
              ) {
                fullText += event.delta.text;
                onChunk(event.delta.text);
              }
            }
          }
        } catch (error) {
          if (signal?.aborted) throw new ChatAbortError();
          if (error instanceof ChatAdapterError) throw error;
          if (fullText.trim()) return fullText;
          throw new ChatAdapterError(null);
        } finally {
          reader.releaseLock();
        }

        if (signal?.aborted) throw new ChatAbortError();
        if (!fullText.trim()) {
          throw new ChatAdapterError(502);
        }
        return fullText;
      } finally {
        cleanup();
      }
    },
  };
}

function createUnsupportedChatAdapter(): ChatAdapter {
  return {
    async complete() {
      throw new ChatAdapterError(404, "model_not_found");
    },
    async completeStream() {
      throw new ChatAdapterError(404, "model_not_found");
    },
  };
}

export const CHAT_ADAPTERS: ChatAdapterRegistry = {
  gemini: createGeminiChatAdapter(),
  google: createGeminiChatAdapter(),
  openai: createOpenAiCompatibleChatAdapter("https://api.openai.com/v1/chat/completions"),
  openrouter: createOpenAiCompatibleChatAdapter("https://openrouter.ai/api/v1/chat/completions"),
  anthropic: createAnthropicChatAdapter(),
  xai: createOpenAiCompatibleChatAdapter("https://api.x.ai/v1/chat/completions"),
  deepseek: createOpenAiCompatibleChatAdapter("https://api.deepseek.com/chat/completions"),
  alibaba: createOpenAiCompatibleChatAdapter(
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
  ),
  "mistral-ai": createOpenAiCompatibleChatAdapter("https://api.mistral.ai/v1/chat/completions"),
  meta: createOpenAiCompatibleChatAdapter("https://api.llama.com/compat/v1/chat/completions"),
  cohere: createOpenAiCompatibleChatAdapter("https://api.cohere.com/compatibility/v1/chat/completions"),
  amazon: createUnsupportedChatAdapter(),
  microsoft: createUnsupportedChatAdapter(),
  ibm: createUnsupportedChatAdapter(),
  nvidia: createOpenAiCompatibleChatAdapter(
    "https://integrate.api.nvidia.com/v1/chat/completions",
  ),
  "ai21-labs": createOpenAiCompatibleChatAdapter(
    "https://api.ai21.com/studio/v1/chat/completions",
  ),
  "z-ai": createOpenAiCompatibleChatAdapter(
    "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  ),
  minimax: createOpenAiCompatibleChatAdapter(
    "https://api.minimax.io/v1/text/chatcompletion_v2",
  ),
  "moonshot-ai": createOpenAiCompatibleChatAdapter(
    "https://api.moonshot.ai/v1/chat/completions",
  ),
  bytedance: createOpenAiCompatibleChatAdapter(
    "https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions",
  ),
  baidu: createUnsupportedChatAdapter(),
  tencent: createUnsupportedChatAdapter(),
  "01-ai": createOpenAiCompatibleChatAdapter("https://api.01.ai/v1/chat/completions"),
  "zhipu-ai": createOpenAiCompatibleChatAdapter(
    "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  ),
  "together-ai": createOpenAiCompatibleChatAdapter(
    "https://api.together.xyz/v1/chat/completions",
  ),
  replicate: createUnsupportedChatAdapter(),
  fal: createUnsupportedChatAdapter(),
  "fireworks-ai": createOpenAiCompatibleChatAdapter(
    "https://api.fireworks.ai/inference/v1/chat/completions",
  ),
  groq: createOpenAiCompatibleChatAdapter(
    "https://api.groq.com/openai/v1/chat/completions",
  ),
  perplexity: createOpenAiCompatibleChatAdapter(
    "https://api.perplexity.ai/chat/completions",
  ),
  "sarvam-ai": createOpenAiCompatibleChatAdapter(
    "https://api.sarvam.ai/v1/chat/completions",
  ),
  krutrim: createOpenAiCompatibleChatAdapter(
    "https://cloud.olakrutrim.com/v1/chat/completions",
  ),
  tii: createUnsupportedChatAdapter(),
  "g42-inception": createUnsupportedChatAdapter(),
  sdaia: createUnsupportedChatAdapter(),
  "black-forest-labs": createUnsupportedChatAdapter(),
  "stability-ai": createUnsupportedChatAdapter(),
  ideogram: createUnsupportedChatAdapter(),
  recraft: createUnsupportedChatAdapter(),
  adobe: createUnsupportedChatAdapter(),
  "leonardo-ai": createUnsupportedChatAdapter(),
  "luma-ai": createUnsupportedChatAdapter(),
  krea: createUnsupportedChatAdapter(),
  freepik: createUnsupportedChatAdapter(),
  "getty-images": createUnsupportedChatAdapter(),
  shutterstock: createUnsupportedChatAdapter(),
  bria: createUnsupportedChatAdapter(),
  kuaishou: createUnsupportedChatAdapter(),
  runway: createUnsupportedChatAdapter(),
  pika: createUnsupportedChatAdapter(),
  higgsfield: createUnsupportedChatAdapter(),
  heygen: createUnsupportedChatAdapter(),
  synthesia: createUnsupportedChatAdapter(),
  colossyan: createUnsupportedChatAdapter(),
  "d-id": createUnsupportedChatAdapter(),
  vidnoz: createUnsupportedChatAdapter(),
  kaiber: createUnsupportedChatAdapter(),
  genmo: createUnsupportedChatAdapter(),
  haiper: createUnsupportedChatAdapter(),
  pixverse: createUnsupportedChatAdapter(),
  vidu: createUnsupportedChatAdapter(),
  dreamina: createUnsupportedChatAdapter(),
  "runway-dev": createUnsupportedChatAdapter(),
};
