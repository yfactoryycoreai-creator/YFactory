export type ChatModelOption = {
  provider: string;
  id: string;
  providerName: string;
  modelName: string;
};
export type ChatRole = 'system' | 'user' | 'assistant';
export type ChatMessageInput = { role: ChatRole; content: string };
export type ChatFailureCode =
  | 'missing_key'
  | 'rate_limited'
  | 'auth_failed'
  | 'timeout'
  | 'bad_prompt'
  | 'model_not_found';

export type StoredChatFeedback = 'like' | 'dislike' | null;

export type StoredChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  modelName?: string;
  feedback?: StoredChatFeedback;
  stopped?: boolean;
  createdAt: number;
};

export type ChatConversationSummary = {
  id: string;
  title: string;
  pinned: boolean;
  projectName: string | null;
  modelProvider: string | null;
  modelKeyId: string | null;
  modelName: string | null;
  messageCount: number;
  lastMessagePreview: string;
  createdAt: number;
  updatedAt: number;
};

export type ChatConversationDetail = ChatConversationSummary & {
  messages: StoredChatMessage[];
};

const failureCodes: ChatFailureCode[] = [
  'missing_key',
  'rate_limited',
  'auth_failed',
  'timeout',
  'bad_prompt',
  'model_not_found',
];

export class ChatApiError extends Error {
  constructor(readonly code: ChatFailureCode) {
    super(code);
    this.name = 'ChatApiError';
  }
}

export class ChatStreamAbortedError extends Error {
  constructor() {
    super('aborted');
    this.name = 'ChatStreamAbortedError';
  }
}

function parseFailureCode(payload: unknown): ChatFailureCode {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    failureCodes.includes((payload as { code?: ChatFailureCode }).code as ChatFailureCode)
  ) {
    return (payload as { code: ChatFailureCode }).code;
  }
  return 'bad_prompt';
}

async function request<T>(
  idToken: string,
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      cache: 'no-store',
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new ChatApiError('timeout');
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ChatApiError(parseFailureCode(payload));
  }
  return payload as T;
}

export async function loadChatModels(idToken: string): Promise<ChatModelOption[]> {
  const result = await request<{ models: ChatModelOption[] }>(
    idToken,
    '/api/chat/models',
  );
  return result.models;
}

export async function sendChatCompletion(
  idToken: string,
  input: {
    provider: string;
    keyId: string;
    modelName: string;
    messages: ChatMessageInput[];
  },
): Promise<string> {
  const result = await request<{ reply: string }>(
    idToken,
    '/api/chat/completions',
    { method: 'POST', body: input },
  );
  return result.reply;
}

export async function streamChatCompletion(
  idToken: string,
  input: {
    provider: string;
    keyId: string;
    modelName: string;
    messages: ChatMessageInput[];
  },
  options: {
    signal?: AbortSignal;
    onDelta: (chunk: string) => void;
  },
): Promise<string> {
  let response: Response;
  try {
    response = await fetch('/api/chat/completions/stream', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      cache: 'no-store',
      body: JSON.stringify(input),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw new ChatStreamAbortedError();
    }
    throw new ChatApiError('timeout');
  }

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new ChatApiError(parseFailureCode(payload));
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json') || !response.body) {
    const payload: unknown = await response.json().catch(() => null);
    const reply =
      typeof payload === 'object' && payload !== null && typeof (payload as { reply?: unknown }).reply === 'string'
        ? (payload as { reply: string }).reply
        : '';
    if (!reply) throw new ChatApiError('timeout');
    options.onDelta(reply);
    return reply;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let accumulated = '';

  const processEventLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return;
    const dataStr = line.slice(5).trim();
    if (!dataStr) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(dataStr);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const event = parsed as { type?: unknown; content?: unknown; code?: unknown };
    if (event.type === 'delta' && typeof event.content === 'string') {
      accumulated += event.content;
      options.onDelta(event.content);
    } else if (event.type === 'error') {
      throw new ChatApiError(parseFailureCode(event));
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        processEventLine(line);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      for (const line of buffer.split(/\r?\n/)) {
        processEventLine(line);
      }
    }
  } catch (error) {
    if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw new ChatStreamAbortedError();
    }
    if (error instanceof ChatApiError) throw error;
    if (accumulated.trim()) return accumulated;
    throw new ChatApiError('timeout');
  } finally {
    reader.releaseLock();
  }

  if (options.signal?.aborted) {
    throw new ChatStreamAbortedError();
  }
  if (!accumulated.trim()) {
    throw new ChatApiError('timeout');
  }
  return accumulated;
}

export async function listChatConversations(
  idToken: string,
): Promise<ChatConversationSummary[]> {
  const result = await request<{ conversations: ChatConversationSummary[] }>(
    idToken,
    '/api/chat/conversations',
  );
  return result.conversations;
}

export async function getChatConversation(
  idToken: string,
  conversationId: string,
): Promise<ChatConversationDetail> {
  const result = await request<{ conversation: ChatConversationDetail }>(
    idToken,
    `/api/chat/conversations/${encodeURIComponent(conversationId)}`,
  );
  return result.conversation;
}

export async function createChatConversation(
  idToken: string,
  input: {
    title?: string;
    pinned?: boolean;
    projectName?: string | null;
    modelProvider?: string | null;
    modelKeyId?: string | null;
    modelName?: string | null;
    messages?: StoredChatMessage[];
  },
): Promise<ChatConversationDetail> {
  const result = await request<{ conversation: ChatConversationDetail }>(
    idToken,
    '/api/chat/conversations',
    { method: 'POST', body: input },
  );
  return result.conversation;
}

export async function updateChatConversation(
  idToken: string,
  conversationId: string,
  patch: {
    title?: string;
    pinned?: boolean;
    projectName?: string | null;
    modelProvider?: string | null;
    modelKeyId?: string | null;
    modelName?: string | null;
    messages?: StoredChatMessage[];
  },
): Promise<ChatConversationDetail> {
  const result = await request<{ conversation: ChatConversationDetail }>(
    idToken,
    `/api/chat/conversations/${encodeURIComponent(conversationId)}`,
    { method: 'PATCH', body: patch },
  );
  return result.conversation;
}

export async function deleteChatConversation(
  idToken: string,
  conversationId: string,
): Promise<void> {
  await request<void>(
    idToken,
    `/api/chat/conversations/${encodeURIComponent(conversationId)}`,
    { method: 'DELETE' },
  );
}
