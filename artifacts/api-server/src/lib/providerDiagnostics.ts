import { Timestamp } from "firebase-admin/firestore";
import {
  clearChatVaultKeyFailure,
  getDefaultProviderKeySecret,
  listProviderVaultKeys,
  listVaultKeys,
  recordChatVaultKeyFailure,
  type VaultKeyMetadata,
} from "./apiKeyVault";
import { CHAT_ADAPTERS } from "./chatAdapters";
import { getFirebaseAdmin } from "./firebaseAdmin";
import {
  findCatalogProvider,
  getModelsForProvider,
  PROVIDER_CATALOG,
  type EndpointVerificationStatus,
  type ProviderCapability,
} from "./providerCatalog";

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
  endpointVerificationStatus: EndpointVerificationStatus;
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

const AUTH_PROBE_ENDPOINTS: Record<
  string,
  {
    url: string;
    headerMode: "bearer" | "google" | "anthropic" | "bfl" | "fal";
  }
> = {
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
    headerMode: "google",
  },
  google: {
    url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
    headerMode: "google",
  },
  openai: { url: "https://api.openai.com/v1/models", headerMode: "bearer" },
  openrouter: { url: "https://openrouter.ai/api/v1/models", headerMode: "bearer" },
  anthropic: {
    url: "https://api.anthropic.com/v1/models?limit=1",
    headerMode: "anthropic",
  },
  xai: { url: "https://api.x.ai/v1/models", headerMode: "bearer" },
  deepseek: { url: "https://api.deepseek.com/models", headerMode: "bearer" },
  "mistral-ai": { url: "https://api.mistral.ai/v1/models", headerMode: "bearer" },
  groq: { url: "https://api.groq.com/openai/v1/models", headerMode: "bearer" },
  "together-ai": { url: "https://api.together.xyz/v1/models", headerMode: "bearer" },
  "fireworks-ai": {
    url: "https://api.fireworks.ai/inference/v1/models",
    headerMode: "bearer",
  },
  nvidia: {
    url: "https://integrate.api.nvidia.com/v1/models",
    headerMode: "bearer",
  },
  alibaba: {
    url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models",
    headerMode: "bearer",
  },
  "moonshot-ai": { url: "https://api.moonshot.ai/v1/models", headerMode: "bearer" },
  "01-ai": { url: "https://api.01.ai/v1/models", headerMode: "bearer" },
  "z-ai": {
    url: "https://open.bigmodel.cn/api/paas/v4/models",
    headerMode: "bearer",
  },
  "zhipu-ai": {
    url: "https://open.bigmodel.cn/api/paas/v4/models",
    headerMode: "bearer",
  },
  cohere: { url: "https://api.cohere.com/v1/models", headerMode: "bearer" },
  replicate: { url: "https://api.replicate.com/v1/account", headerMode: "bearer" },
  "stability-ai": {
    url: "https://api.stability.ai/v1/user/account",
    headerMode: "bearer",
  },
};

function connectionTestsCollection(uid: string) {
  const { db } = getFirebaseAdmin();
  return db.collection("users").doc(uid).collection("connectionTests");
}

function buildAuthHeaders(
  mode: "bearer" | "google" | "anthropic" | "bfl" | "fal",
  apiKey: string,
): Record<string, string> {
  if (mode === "google") return { "x-goog-api-key": apiKey };
  if (mode === "anthropic") {
    return { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  }
  if (mode === "bfl") return { "x-key": apiKey };
  if (mode === "fal") return { Authorization: `Key ${apiKey}` };
  return { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
}

function extractOriginUrl(rawUrl: string | null): string | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl.replace("{model}", "ping"));
    return parsed.origin;
  } catch {
    return null;
  }
}

async function measureNetworkLatency(
  targetUrl: string,
): Promise<{ latencyMs: number | null; reachable: boolean; error?: string }> {
  const origin = extractOriginUrl(targetUrl);
  if (!origin) return { latencyMs: null, reachable: false, error: "Invalid endpoint URL." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  const started = performance.now();
  try {
    await fetch(origin, {
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal,
    });
    return {
      latencyMs: Math.max(1, Math.round(performance.now() - started)),
      reachable: true,
    };
  } catch {
    return {
      latencyMs: null,
      reachable: false,
      error: "Host did not respond within timeout.",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function measureAuthenticatedApiCall(
  providerId: string,
  apiKey: string,
): Promise<{
  supported: boolean;
  ok: boolean;
  httpStatus: number | null;
  responseTimeMs: number | null;
  endpointUrl: string | null;
  error?: string;
}> {
  const probe = AUTH_PROBE_ENDPOINTS[providerId];
  if (!probe) {
    return {
      supported: false,
      ok: false,
      httpStatus: null,
      responseTimeMs: null,
      endpointUrl: null,
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  const started = performance.now();
  try {
    const resp = await fetch(probe.url, {
      method: "GET",
      headers: buildAuthHeaders(probe.headerMode, apiKey),
      signal: controller.signal,
    });
    const elapsed = Math.max(1, Math.round(performance.now() - started));
    if (resp.ok) {
      return {
        supported: true,
        ok: true,
        httpStatus: resp.status,
        responseTimeMs: elapsed,
        endpointUrl: probe.url,
      };
    }
    const errText =
      resp.status === 401 || resp.status === 403
        ? "Authentication rejected (invalid or unauthorized API key)."
        : resp.status === 429
          ? "Rate limited by provider (HTTP 429)."
          : `Provider API returned HTTP ${resp.status}.`;
    return {
      supported: true,
      ok: false,
      httpStatus: resp.status,
      responseTimeMs: elapsed,
      endpointUrl: probe.url,
      error: errText,
    };
  } catch {
    return {
      supported: true,
      ok: false,
      httpStatus: null,
      responseTimeMs: null,
      endpointUrl: probe.url,
      error: "Failed to reach official API endpoint.",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function measureModelGenerationTime(
  providerId: string,
  apiKey: string,
  modelId: string,
): Promise<{ generationTimeMs: number | null; error?: string }> {
  const adapter = CHAT_ADAPTERS[providerId];
  if (!adapter) {
    return { generationTimeMs: null, error: "Chat adapter not available for generation probe." };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const started = performance.now();
  try {
    await adapter.complete({
      apiKey,
      model: modelId,
      messages: [{ role: "user", content: "Reply with the single word OK." }],
      signal: controller.signal,
    });
    return {
      generationTimeMs: Math.max(1, Math.round(performance.now() - started)),
    };
  } catch {
    return {
      generationTimeMs: null,
      error: `Model generation probe failed for ${modelId}.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runOfficialConnectionTest(
  uid: string,
  providerId: string,
  options: {
    keyId?: string;
    includeGenerationTest?: boolean;
    modelId?: string;
  } = {},
): Promise<ProviderConnectionTestRecord> {
  const normalized = providerId.trim().toLowerCase();
  const provider = findCatalogProvider(normalized);
  if (!provider) {
    throw new Error("provider_not_found");
  }

  const testedAt = Date.now();
  const targetEndpoint =
    AUTH_PROBE_ENDPOINTS[provider.id]?.url ??
    provider.connectionDetails.chatEndpoint ??
    provider.connectionDetails.apiBaseUrl ??
    provider.officialLinks.apiPlatform ??
    provider.officialLinks.website;

  if (provider.role === "no_public_api" || !targetEndpoint) {
    const unavailableRecord: ProviderConnectionTestRecord = {
      id: `test_${testedAt}_${Math.random().toString(36).slice(2, 8)}`,
      providerId: provider.id,
      providerName: provider.name,
      endpointUrl: null,
      authMethod: provider.connectionDetails.authMethod,
      endpointVerificationStatus: provider.connectionDetails.verificationStatus,
      outcome: "provider_unavailable",
      authenticated: false,
      httpStatus: null,
      networkLatencyMs: null,
      apiResponseTimeMs: null,
      modelGenerationTimeMs: null,
      generationTested: false,
      generationModel: null,
      passesThroughBackend: true,
      externalProxy: null,
      errorMessage: "No official public API endpoint is configured for this provider.",
      testedAt,
    };
    await persistConnectionTest(uid, unavailableRecord);
    return unavailableRecord;
  }

  // Step 1: Strictly measure network reachability latency (zero token cost)
  const net = await measureNetworkLatency(targetEndpoint);

  // Step 2: Check if user has a saved encrypted key and test real auth
  const secret = await getDefaultProviderKeySecret(uid, provider.id, options.keyId);
  let outcome: ConnectionTestOutcome = net.reachable
    ? "connection_tested"
    : "connection_failed";
  let authenticated = false;
  let httpStatus: number | null = null;
  let apiResponseTimeMs: number | null = null;
  let errorMessage: string | null = net.reachable ? null : (net.error ?? "Host unreachable.");
  let usedEndpoint = targetEndpoint;

  if (secret) {
    const authRes = await measureAuthenticatedApiCall(provider.id, secret.value);
    if (authRes.supported) {
      usedEndpoint = authRes.endpointUrl ?? targetEndpoint;
      httpStatus = authRes.httpStatus;
      apiResponseTimeMs = authRes.responseTimeMs;
      if (authRes.ok) {
        authenticated = true;
        outcome = "auth_successful";
        errorMessage = null;
        await clearChatVaultKeyFailure(uid, provider.id, secret.id).catch(() => undefined);
      } else {
        authenticated = false;
        outcome = "connection_failed";
        errorMessage = authRes.error ?? "Authentication failed.";
        if (authRes.httpStatus === 401 || authRes.httpStatus === 403 || authRes.httpStatus === 429) {
          await recordChatVaultKeyFailure(uid, provider.id, secret.id, authRes.httpStatus).catch(
            () => undefined,
          );
        }
      }
    } else if (net.reachable) {
      outcome = "connection_tested";
      errorMessage = "Network reachable. Automated auth probe is not supported for this provider yet.";
    }
  } else if (net.reachable) {
    outcome = "connection_tested";
    errorMessage = "Network reachable. Add an API key to verify authentication.";
  }

  // Step 3: Optional explicit Model Generation Time probe (only when user opts in)
  let modelGenerationTimeMs: number | null = null;
  let generationTested = false;
  let generationModel: string | null = null;

  if (
    options.includeGenerationTest === true &&
    secret &&
    authenticated &&
    provider.chatAdapterReady
  ) {
    let probeModel = options.modelId?.trim() || "";
    if (!probeModel) {
      const savedKeys = await listProviderVaultKeys(uid, provider.id);
      const activeKey = savedKeys.find((k) => k.id === secret.id) ?? savedKeys[0];
      probeModel =
        activeKey?.models[0] ??
        getModelsForProvider(provider.id, false).find(
          (m) => m.category === "text_chat" && m.availability === "active",
        )?.modelId ??
        "";
    }
    if (probeModel) {
      generationTested = true;
      generationModel = probeModel;
      const genRes = await measureModelGenerationTime(
        provider.id,
        secret.value,
        probeModel,
      );
      modelGenerationTimeMs = genRes.generationTimeMs;
      if (genRes.error) {
        errorMessage = genRes.error;
      }
    }
  }

  const record: ProviderConnectionTestRecord = {
    id: `test_${testedAt}_${Math.random().toString(36).slice(2, 8)}`,
    providerId: provider.id,
    providerName: provider.name,
    endpointUrl: usedEndpoint,
    authMethod: provider.connectionDetails.authMethod,
    endpointVerificationStatus: provider.connectionDetails.verificationStatus,
    outcome,
    authenticated,
    httpStatus,
    networkLatencyMs: net.latencyMs,
    apiResponseTimeMs,
    modelGenerationTimeMs,
    generationTested,
    generationModel,
    passesThroughBackend: true,
    externalProxy: null,
    errorMessage,
    testedAt,
  };

  await persistConnectionTest(uid, record);
  return record;
}

async function persistConnectionTest(
  uid: string,
  record: ProviderConnectionTestRecord,
): Promise<void> {
  try {
    await connectionTestsCollection(uid)
      .doc(record.id)
      .set({
        ...record,
        createdAt: Timestamp.fromMillis(record.testedAt),
      });
  } catch {
    // Do not fail diagnostic response if history logging is temporarily unavailable.
  }
}

export async function listProviderConnectionTests(
  uid: string,
  limit = 40,
): Promise<{
  history: ProviderConnectionTestRecord[];
  latestByProvider: ProviderConnectionTestRecord[];
}> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const snapshot = await connectionTestsCollection(uid)
    .orderBy("testedAt", "desc")
    .limit(safeLimit)
    .get();

  const history: ProviderConnectionTestRecord[] = snapshot.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      providerId: String(d.providerId ?? ""),
      providerName: String(d.providerName ?? ""),
      endpointUrl: typeof d.endpointUrl === "string" ? d.endpointUrl : null,
      authMethod: typeof d.authMethod === "string" ? d.authMethod : null,
      endpointVerificationStatus:
        d.endpointVerificationStatus === "verified_official" ||
        d.endpointVerificationStatus === "no_public_api"
          ? d.endpointVerificationStatus
          : "pending_verification",
      outcome:
        d.outcome === "auth_successful" ||
        d.outcome === "connection_tested" ||
        d.outcome === "connection_failed" ||
        d.outcome === "provider_unavailable"
          ? d.outcome
          : "connection_failed",
      authenticated: d.authenticated === true,
      httpStatus: typeof d.httpStatus === "number" ? d.httpStatus : null,
      networkLatencyMs:
        typeof d.networkLatencyMs === "number" ? d.networkLatencyMs : null,
      apiResponseTimeMs:
        typeof d.apiResponseTimeMs === "number" ? d.apiResponseTimeMs : null,
      modelGenerationTimeMs:
        typeof d.modelGenerationTimeMs === "number"
          ? d.modelGenerationTimeMs
          : null,
      generationTested: d.generationTested === true,
      generationModel:
        typeof d.generationModel === "string" ? d.generationModel : null,
      passesThroughBackend: true,
      externalProxy: null,
      errorMessage: typeof d.errorMessage === "string" ? d.errorMessage : null,
      testedAt: typeof d.testedAt === "number" ? d.testedAt : Date.now(),
    };
  });

  const latestMap = new Map<string, ProviderConnectionTestRecord>();
  for (const item of history) {
    if (!latestMap.has(item.providerId)) {
      latestMap.set(item.providerId, item);
    }
  }
  const latestByProvider = [...latestMap.values()].sort((a, b) => {
    const aMs = a.apiResponseTimeMs ?? a.networkLatencyMs ?? Number.MAX_SAFE_INTEGER;
    const bMs = b.apiResponseTimeMs ?? b.networkLatencyMs ?? Number.MAX_SAFE_INTEGER;
    return aMs - bMs;
  });

  return { history, latestByProvider };
}

export async function clearProviderConnectionTests(uid: string): Promise<number> {
  const snapshot = await connectionTestsCollection(uid).limit(200).get();
  if (snapshot.empty) return 0;
  const { db } = getFirebaseAdmin();
  const batch = db.batch();
  for (const doc of snapshot.docs) {
    batch.delete(doc.ref);
  }
  await batch.commit();
  return snapshot.size;
}

function capabilityForTask(task: RecommendationTask): ProviderCapability {
  if (task === "code") return "code";
  if (task === "image_generation") return "image_generation";
  if (task === "video_generation") return "video_generation";
  return "chat";
}

function modelCategoryForTask(
  task: RecommendationTask,
): "text_chat" | "image_generation" | "video_generation" {
  if (task === "image_generation") return "image_generation";
  if (task === "video_generation") return "video_generation";
  return "text_chat";
}

export async function recommendProvidersForTask(
  uid: string,
  task: RecommendationTask,
  priority: RecommendationPriority = "balanced",
): Promise<ProviderRecommendationItem[]> {
  const requiredCap = capabilityForTask(task);
  const targetCategory = modelCategoryForTask(task);

  const [userKeys, diagData] = await Promise.all([
    listVaultKeys(uid),
    listProviderConnectionTests(uid, 60).catch(() => ({
      history: [] as ProviderConnectionTestRecord[],
      latestByProvider: [] as ProviderConnectionTestRecord[],
    })),
  ]);

  const keysByProvider = new Map<string, VaultKeyMetadata[]>();
  for (const k of userKeys) {
    const arr = keysByProvider.get(k.provider) ?? [];
    arr.push(k);
    keysByProvider.set(k.provider, arr);
  }
  const latestByProvider = new Map(
    diagData.latestByProvider.map((rec) => [rec.providerId, rec]),
  );

  const candidates = PROVIDER_CATALOG.filter(
    (p) => p.role !== "no_public_api" && p.capabilities.includes(requiredCap),
  );

  const scored: ProviderRecommendationItem[] = candidates.map((provider) => {
    const pKeys = keysByProvider.get(provider.id) ?? [];
    const enabledKeys = pKeys.filter((k) => k.enabled);
    const hasReadyKey = enabledKeys.some((k) => k.status === "ready");
    const hasCooldown =
      !hasReadyKey && enabledKeys.some((k) => k.status === "cooldown");
    const hasFailing =
      !hasReadyKey && !hasCooldown && enabledKeys.some((k) => k.status === "failing");
    const connectionStatus: ProviderRecommendationItem["connectionStatus"] =
      hasReadyKey
        ? "connected"
        : hasCooldown
          ? "cooldown"
          : hasFailing
            ? "failing"
            : "not_configured";

    const hasFreeTier =
      provider.accessTypes.includes("free_tier") ||
      provider.accessTypes.includes("free");
    const verifiedOfficial =
      provider.connectionDetails.verificationStatus === "verified_official";
    const latestTest = latestByProvider.get(provider.id) ?? null;

    const matchingModels = getModelsForProvider(provider.id, false).filter(
      (m) =>
        m.category === targetCategory &&
        m.modelId !== "various" &&
        m.capabilities.includes(requiredCap),
    );

    let score = 0;
    const reasons: string[] = [];

    if (hasReadyKey) {
      score += 42;
      reasons.push("key_ready");
    } else if (hasCooldown) {
      score += 8;
      reasons.push("key_cooldown");
    } else if (hasFailing) {
      score -= 25;
      reasons.push("key_failing");
    } else {
      reasons.push("key_missing");
    }

    if (task === "chat" || task === "code") {
      if (provider.chatAdapterReady) {
        score += 18;
        reasons.push("adapter_ready");
      }
    }

    if (verifiedOfficial) {
      score += 12;
      reasons.push("verified_official");
    }

    if (hasFreeTier) {
      score += priority === "cost" ? 22 : priority === "balanced" ? 10 : 4;
      reasons.push("free_tier");
    }

    if (matchingModels.length > 0) {
      score += Math.min(8, matchingModels.length * 2);
    }

    if (latestTest && latestTest.outcome !== "connection_failed") {
      const measuredMs =
        latestTest.apiResponseTimeMs ?? latestTest.networkLatencyMs;
      if (measuredMs !== null) {
        const speedBonus = Math.max(
          0,
          Math.min(
            priority === "speed" ? 28 : 14,
            Math.round((1500 - Math.min(measuredMs, 1500)) / (priority === "speed" ? 54 : 108)),
          ),
        );
        score += speedBonus;
        if (latestTest.authenticated) {
          score += 6;
          reasons.push("auth_verified_live");
        }
        reasons.push(`measured_${measuredMs}ms`);
      }
    } else if (latestTest && latestTest.outcome === "connection_failed") {
      score -= 18;
      reasons.push("last_test_failed");
    }

    return {
      providerId: provider.id,
      providerName: provider.name,
      score,
      connectionStatus,
      hasReadyKey,
      hasFreeTier,
      chatAdapterReady: provider.chatAdapterReady,
      verifiedOfficial,
      measuredNetworkMs: latestTest?.networkLatencyMs ?? null,
      measuredApiMs: latestTest?.apiResponseTimeMs ?? null,
      measuredGenerationMs: latestTest?.modelGenerationTimeMs ?? null,
      lastTestedAt: latestTest?.testedAt ?? null,
      suggestedModels: matchingModels.slice(0, 3).map((m) => ({
        modelId: m.modelId,
        modelName: m.modelName,
        accessType: m.rawAccessType,
      })),
      reasons,
    };
  });

  return scored
    .sort((a, b) => b.score - a.score || a.providerName.localeCompare(b.providerName))
    .slice(0, 8);
}
