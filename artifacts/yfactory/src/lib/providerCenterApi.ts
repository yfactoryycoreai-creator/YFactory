export type ProviderCapability =
  | "chat"
  | "code"
  | "image_generation"
  | "image_editing"
  | "image_understanding"
  | "video_generation"
  | "image_to_video"
  | "audio"
  | "embeddings";

export type ProviderRole =
  | "first_party_api"
  | "model_host"
  | "open_weights_creator"
  | "no_public_api";

export type ModelAccessType =
  | "paid"
  | "free"
  | "free_tier"
  | "open_weights_hosted"
  | "paid_open_weights"
  | "legacy_shutting_down"
  | "shut_down"
  | "research_limited"
  | "no_public_api";

export type ModelAvailability =
  | "active"
  | "pending_verification"
  | "dynamic_host"
  | "legacy"
  | "shut_down"
  | "unavailable";

export type ProviderConnectionStatus =
  | "connected"
  | "failing"
  | "cooldown"
  | "not_configured"
  | "unavailable";

export type ProviderOfficialLinks = {
  website: string | null;
  apiPlatform: string | null;
  docsUrl: string | null;
  apiKeyPage: string | null;
  usageDashboard: string | null;
  billingDashboard: string | null;
  modelsDocsUrl: string | null;
};

export type ProviderConnectionDetails = {
  apiBaseUrl: string | null;
  chatEndpoint: string | null;
  authMethod: string | null;
  passesThroughBackend: boolean;
  externalProxy: string | null;
  verificationStatus: "verified_official" | "pending_verification" | "no_public_api";
};

export type ProviderSummaryItem = {
  id: string;
  name: string;
  shortDescription: string;
  role: ProviderRole;
  capabilities: ProviderCapability[];
  accessTypes: ModelAccessType[];
  maxKeys: number;
  chatAdapterReady: boolean;
  officialLinks: ProviderOfficialLinks;
  connectionDetails: ProviderConnectionDetails;
  pricingSummary: string;
  usageLimitsNote: string;
  modelCount: number;
  activeModelCount: number;
  keyCount: number;
  connectionStatus: ProviderConnectionStatus;
  defaultKeyId: string | null;
  modelNamesPreview: string[];
};

export type ProviderModelItem = {
  id: string;
  providerId: string;
  creatorName: string;
  apiHosts: string[];
  modelName: string;
  modelId: string;
  category: "text_chat" | "image_generation" | "video_generation";
  capabilities: ProviderCapability[];
  accessType: ModelAccessType;
  rawAccessType: string;
  availability: ModelAvailability;
  docsUrl: string;
  notes: string;
  lastVerifiedAt: string;
};

export type ProviderKeyItem = {
  id: string;
  provider: string;
  providerName: string | null;
  label: string;
  maskedValue: string;
  enabled: boolean;
  isDefault: boolean;
  createdAt: number;
  status: "ready" | "failing" | "cooldown";
  cooldownUntil?: number;
  models: string[];
};

export type CatalogAuditSummary = {
  existingProjectProviders: number;
  csvProviderNames: number;
  totalCatalogProviders: number;
  verifiedOfficialProviders: number;
  chatAdapterReadyProviders: number;
  csvTotalModels: number;
  verifiedActiveModels: number;
  dynamicHostPlaceholders: number;
  pendingVerificationModels: number;
  legacyModels: number;
  shutDownModels: number;
  unavailableModels: number;
};

export type ProviderDetailResponse = {
  provider: ProviderSummaryItem;
  keys: ProviderKeyItem[];
  models: ProviderModelItem[];
  inactiveModels: ProviderModelItem[];
};

export class ProviderCenterApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function requestJson<T>(
  path: string,
  idToken: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${idToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new ProviderCenterApiError(
      typeof data.error === "string" ? data.error : "Request failed.",
      typeof data.code === "string" ? data.code : "request_failed",
      response.status,
    );
  }
  return data as T;
}

export async function fetchProviderCatalog(
  idToken: string,
): Promise<{
  providers: ProviderSummaryItem[];
  auditSummary: CatalogAuditSummary;
}> {
  return requestJson("/api/provider-center/catalog", idToken);
}

export async function fetchProviderDetails(
  idToken: string,
  providerId: string,
): Promise<ProviderDetailResponse> {
  return requestJson(
    `/api/provider-center/providers/${encodeURIComponent(providerId)}`,
    idToken,
  );
}

export async function fetchModelRegistry(
  idToken: string,
  params: {
    provider?: string;
    category?: string;
    capability?: string;
    access?: string;
    q?: string;
    includeInactive?: boolean;
  } = {},
): Promise<{ models: ProviderModelItem[]; totalRegistrySize: number }> {
  const qs = new URLSearchParams();
  if (params.provider) qs.set("provider", params.provider);
  if (params.category) qs.set("category", params.category);
  if (params.capability) qs.set("capability", params.capability);
  if (params.access) qs.set("access", params.access);
  if (params.q) qs.set("q", params.q);
  if (params.includeInactive) qs.set("includeInactive", "true");
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return requestJson(`/api/provider-center/models${suffix}`, idToken);
}

export async function addProviderKey(
  idToken: string,
  providerId: string,
  input: { label?: string; value: string; makeDefault?: boolean },
): Promise<ProviderKeyItem> {
  const data = await requestJson<{ key: ProviderKeyItem }>(
    `/api/provider-center/providers/${encodeURIComponent(providerId)}/keys`,
    idToken,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return data.key;
}

export async function updateProviderKey(
  idToken: string,
  providerId: string,
  keyId: string,
  input: { label?: string; value?: string; isDefault?: boolean },
): Promise<ProviderKeyItem> {
  const data = await requestJson<{ key: ProviderKeyItem }>(
    `/api/provider-center/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(keyId)}`,
    idToken,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return data.key;
}

export async function setDefaultProviderKey(
  idToken: string,
  providerId: string,
  keyId: string,
): Promise<ProviderKeyItem> {
  const data = await requestJson<{ key: ProviderKeyItem }>(
    `/api/provider-center/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(keyId)}/default`,
    idToken,
    { method: "POST" },
  );
  return data.key;
}

export async function deleteProviderKey(
  idToken: string,
  providerId: string,
  keyId: string,
): Promise<void> {
  await requestJson(
    `/api/provider-center/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(keyId)}`,
    idToken,
    { method: "DELETE" },
  );
}

export type LiveDiscoveredModel = {
  modelId: string;
  modelName: string;
  pricingTier: "free" | "paid" | "unknown";
  contextLength?: number;
  source: "live_api";
};

export type LiveModelsResponse = {
  providerId: string;
  keyId: string;
  supported: boolean;
  models: LiveDiscoveredModel[];
  httpStatus?: number;
  error?: string;
};

export async function fetchProviderLiveModels(
  idToken: string,
  providerId: string,
  keyId?: string,
): Promise<LiveModelsResponse> {
  const qs = keyId ? `?keyId=${encodeURIComponent(keyId)}` : "";
  return requestJson(
    `/api/provider-center/providers/${encodeURIComponent(providerId)}/live-models${qs}`,
    idToken,
  );
}

export async function addProviderKeyModel(
  idToken: string,
  providerId: string,
  keyId: string,
  modelId: string,
): Promise<ProviderKeyItem> {
  const data = await requestJson<{ key: ProviderKeyItem }>(
    `/api/provider-center/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(keyId)}/models`,
    idToken,
    {
      method: "POST",
      body: JSON.stringify({ modelId }),
    },
  );
  return data.key;
}

export async function removeProviderKeyModel(
  idToken: string,
  providerId: string,
  keyId: string,
  modelId: string,
): Promise<ProviderKeyItem> {
  const data = await requestJson<{ key: ProviderKeyItem }>(
    `/api/provider-center/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(keyId)}/models?modelId=${encodeURIComponent(modelId)}`,
    idToken,
    { method: "DELETE" },
  );
  return data.key;
}

export type ConnectionTestOutcome =
  | "auth_successful"
  | "connection_tested"
  | "connection_failed"
  | "provider_unavailable";

export type ProviderConnectionTestRecord = {
  id: string;
  providerId: string;
  providerName: string;
  endpointUrl: string | null;
  authMethod: string | null;
  endpointVerificationStatus:
    | "verified_official"
    | "pending_verification"
    | "no_public_api";
  outcome: ConnectionTestOutcome;
  authenticated: boolean;
  httpStatus: number | null;
  networkLatencyMs: number | null;
  apiResponseTimeMs: number | null;
  modelGenerationTimeMs: number | null;
  generationTested: boolean;
  generationModel: string | null;
  passesThroughBackend: true;
  externalProxy: null;
  errorMessage: string | null;
  testedAt: number;
};

export type RecommendationTask =
  | "chat"
  | "code"
  | "image_generation"
  | "video_generation";

export type RecommendationPriority = "balanced" | "speed" | "cost";

export type ProviderRecommendationItem = {
  providerId: string;
  providerName: string;
  score: number;
  connectionStatus: "connected" | "cooldown" | "failing" | "not_configured";
  hasReadyKey: boolean;
  hasFreeTier: boolean;
  chatAdapterReady: boolean;
  verifiedOfficial: boolean;
  measuredNetworkMs: number | null;
  measuredApiMs: number | null;
  measuredGenerationMs: number | null;
  lastTestedAt: number | null;
  suggestedModels: Array<{
    modelId: string;
    modelName: string;
    accessType: string;
  }>;
  reasons: string[];
};

export async function testOfficialProviderConnection(
  idToken: string,
  providerId: string,
  options: {
    keyId?: string;
    includeGenerationTest?: boolean;
    modelId?: string;
  } = {},
): Promise<ProviderConnectionTestRecord> {
  const data = await requestJson<{ result: ProviderConnectionTestRecord }>(
    `/api/provider-center/providers/${encodeURIComponent(providerId)}/test-connection`,
    idToken,
    {
      method: "POST",
      body: JSON.stringify(options),
    },
  );
  return data.result;
}

export async function fetchProviderDiagnosticsHistory(
  idToken: string,
  limit = 40,
): Promise<{
  history: ProviderConnectionTestRecord[];
  latestByProvider: ProviderConnectionTestRecord[];
}> {
  return requestJson(
    `/api/provider-center/diagnostics/history?limit=${encodeURIComponent(String(limit))}`,
    idToken,
  );
}

export async function clearProviderDiagnosticsHistory(
  idToken: string,
): Promise<{ cleared: number }> {
  return requestJson("/api/provider-center/diagnostics/history", idToken, {
    method: "DELETE",
  });
}

export async function fetchSmartProviderRecommendations(
  idToken: string,
  task: RecommendationTask,
  priority: RecommendationPriority = "balanced",
): Promise<{
  task: RecommendationTask;
  priority: RecommendationPriority;
  recommendations: ProviderRecommendationItem[];
}> {
  return requestJson(
    `/api/provider-center/recommendations?task=${encodeURIComponent(task)}&priority=${encodeURIComponent(priority)}`,
    idToken,
  );
}
