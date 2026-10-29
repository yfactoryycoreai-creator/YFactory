export type ProviderKey = 'zsky' | 'agnes' | 'glm';
export type ProviderKeyStatus = 'ready' | 'failing' | 'cooldown';

export type VaultKey = {
  id: string;
  provider: ProviderKey;
  label: string;
  maskedValue: string;
  enabled: boolean;
  createdAt: number;
  status: ProviderKeyStatus;
  cooldownUntil?: number;
};

type VaultKeyListResponse = { keys: VaultKey[] };

async function vaultRequest<T>(
  idToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error('The API key service could not be reached.');
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      typeof payload === 'object' &&
      payload !== null &&
      typeof (payload as Record<string, unknown>).error === 'string'
        ? String((payload as Record<string, unknown>).error)
        : 'The API key request failed.';
    throw new Error(error);
  }
  return payload as T;
}

export async function loadVaultKeys(idToken: string): Promise<VaultKey[]> {
  const result = await vaultRequest<VaultKeyListResponse>(
    idToken,
    '/api/vault/keys',
  );
  return result.keys;
}

export function createVaultKey(
  idToken: string,
  input: { provider: ProviderKey; label: string; value: string },
): Promise<VaultKey> {
  return vaultRequest<VaultKey>(idToken, '/api/vault/keys', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateVaultKey(
  idToken: string,
  key: Pick<VaultKey, 'provider' | 'id'>,
  updates: { label?: string; enabled?: boolean },
): Promise<VaultKey> {
  return vaultRequest<VaultKey>(
    idToken,
    `/api/vault/keys/${encodeURIComponent(key.provider)}/${encodeURIComponent(key.id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(updates),
    },
  );
}

export async function deleteVaultKey(
  idToken: string,
  key: Pick<VaultKey, 'provider' | 'id'>,
): Promise<void> {
  const path = `/api/vault/keys/${encodeURIComponent(key.provider)}/${encodeURIComponent(key.id)}`;
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    });
  } catch {
    throw new Error('The API key service could not be reached.');
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const error =
      typeof payload === 'object' &&
      payload !== null &&
      typeof (payload as Record<string, unknown>).error === 'string'
        ? String((payload as Record<string, unknown>).error)
        : 'The API key could not be deleted.';
    throw new Error(error);
  }
}

export function maskNewKey(value: string): string {
  return value.length > 4 ? `••••••${value.slice(-4)}` : '••••';
}
