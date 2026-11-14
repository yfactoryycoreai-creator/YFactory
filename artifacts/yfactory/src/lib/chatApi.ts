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
      cache: 'no-store',
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
    input,
  );
  return result.reply;
}
