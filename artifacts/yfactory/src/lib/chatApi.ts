export type ChatProviderOption = { id: 'gemini'; name: string };
export type ChatRole = 'system' | 'user' | 'assistant';
export type ChatMessageInput = { role: ChatRole; content: string };
export type ChatFailureCode =
  | 'missing_key'
  | 'rate_limited'
  | 'auth_failed'
  | 'timeout'
  | 'bad_prompt';

const failureCodes: ChatFailureCode[] = [
  'missing_key',
  'rate_limited',
  'auth_failed',
  'timeout',
  'bad_prompt',
];

export class ChatApiError extends Error {
  constructor(readonly code: ChatFailureCode) {
    super(code);
    this.name = 'ChatApiError';
  }
}

async function request<T>(
  idToken: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ChatApiError('timeout');
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      typeof payload === 'object' && payload !== null &&
      failureCodes.includes((payload as { code?: ChatFailureCode }).code as ChatFailureCode)
        ? (payload as { code: ChatFailureCode }).code
        : 'bad_prompt';
    throw new ChatApiError(code);
  }
  return payload as T;
}

export async function loadChatProviders(idToken: string): Promise<ChatProviderOption[]> {
  const result = await request<{ providers: ChatProviderOption[] }>(
    idToken,
    '/api/chat/providers',
  );
  return result.providers;
}

export async function sendChatCompletion(
  idToken: string,
  input: {
    provider: ChatProviderOption['id'];
    model: string;
    messages: ChatMessageInput[];
  },
): Promise<string> {
  const result = await request<{ reply: string }>(
    idToken,
    '/api/chat/completions',
    input,
  );
  return result.reply;
}
