import { Router, type IRouter, type Request, type Response } from "express";
import { verifyFirebaseIdToken } from "../lib/firebaseAdmin";
import {
  addProviderKeyModel,
  createProviderVaultKey,
  deleteProviderVaultKey,
  getDefaultProviderKeySecret,
  getProviderKeyLimit,
  isValidVaultModelId,
  listProviderVaultKeys,
  listVaultKeys,
  ProviderKeyLimitError,
  removeProviderKeyModel,
  renameVaultKey,
  setDefaultVaultKey,
  updateVaultKeyValue,
  type VaultKeyMetadata,
} from "../lib/apiKeyVault";
import {
  findCatalogProvider,
  getCatalogAuditSummary,
  getModelsForProvider,
  MODEL_REGISTRY,
  PROVIDER_CATALOG,
  queryModelRegistry,
  type ModelAccessType,
  type ModelCategory,
  type ProviderCapability,
} from "../lib/providerCatalog";

function isValidProviderId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

function isValidKeyId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function computeConnectionStatus(
  keys: VaultKeyMetadata[],
  hasPublicApi: boolean,
): "connected" | "failing" | "cooldown" | "not_configured" | "unavailable" {
  if (!hasPublicApi) return "unavailable";
  if (keys.length === 0) return "not_configured";
  const enabled = keys.filter((k) => k.enabled);
  if (enabled.length === 0) return "not_configured";
  if (enabled.some((k) => k.status === "ready")) return "connected";
  if (enabled.some((k) => k.status === "cooldown")) return "cooldown";
  return "failing";
}

type LiveDiscoveredModel = {
  modelId: string;
  modelName: string;
  pricingTier: "free" | "paid" | "unknown";
  contextLength?: number;
  source: "live_api";
};

const OPENAI_STYLE_MODELS_URLS: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1/models",
  groq: "https://api.groq.com/openai/v1/models",
  openai: "https://api.openai.com/v1/models",
  xai: "https://api.x.ai/v1/models",
  deepseek: "https://api.deepseek.com/models",
  "mistral-ai": "https://api.mistral.ai/v1/models",
  "together-ai": "https://api.together.xyz/v1/models",
  "fireworks-ai": "https://api.fireworks.ai/inference/v1/models",
  nvidia: "https://integrate.api.nvidia.com/v1/models",
  alibaba: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models",
  "moonshot-ai": "https://api.moonshot.ai/v1/models",
  "01-ai": "https://api.01.ai/v1/models",
  "z-ai": "https://open.bigmodel.cn/api/paas/v4/models",
  "zhipu-ai": "https://open.bigmodel.cn/api/paas/v4/models",
};

function isZeroPrice(val: unknown): boolean {
  if (val === 0 || val === "0") return true;
  if (typeof val === "string") {
    const num = Number(val);
    return Number.isFinite(num) && num === 0;
  }
  return false;
}

async function fetchLiveModelsFromProvider(
  providerId: string,
  apiKey: string,
): Promise<{
  supported: boolean;
  models: LiveDiscoveredModel[];
  httpStatus?: number;
  error?: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14_000);
  try {
    if (providerId === "gemini" || providerId === "google") {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200`;
      const resp = await fetch(url, {
        headers: { "x-goog-api-key": apiKey },
        signal: controller.signal,
      });
      if (!resp.ok) {
        return {
          supported: true,
          models: [],
          httpStatus: resp.status,
          error:
            resp.status === 401 || resp.status === 403
              ? "API key rejected by Google Gemini API."
              : `Provider returned HTTP ${resp.status}.`,
        };
      }
      const data = (await resp.json().catch(() => ({}))) as {
        models?: Array<{
          name?: string;
          displayName?: string;
          supportedGenerationMethods?: string[];
          inputTokenLimit?: number;
        }>;
      };
      const items = (data.models ?? [])
        .filter(
          (m) =>
            typeof m.name === "string" &&
            Array.isArray(m.supportedGenerationMethods) &&
            m.supportedGenerationMethods.includes("generateContent"),
        )
        .map((m) => {
          const id = (m.name ?? "").replace(/^models\//, "");
          const isFlash = /flash/i.test(id);
          return {
            modelId: id,
            modelName: m.displayName?.trim() || id,
            pricingTier: isFlash ? ("free" as const) : ("paid" as const),
            ...(typeof m.inputTokenLimit === "number"
              ? { contextLength: m.inputTokenLimit }
              : {}),
            source: "live_api" as const,
          };
        })
        .sort((a, b) => a.modelId.localeCompare(b.modelId));
      return { supported: true, models: items, httpStatus: resp.status };
    }

    if (providerId === "anthropic") {
      const resp = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: controller.signal,
      });
      if (!resp.ok) {
        return {
          supported: true,
          models: [],
          httpStatus: resp.status,
          error:
            resp.status === 401 || resp.status === 403
              ? "API key rejected by Anthropic."
              : `Provider returned HTTP ${resp.status}.`,
        };
      }
      const data = (await resp.json().catch(() => ({}))) as {
        data?: Array<{ id?: string; display_name?: string }>;
      };
      const items = (data.data ?? [])
        .filter((m) => typeof m.id === "string" && m.id.trim().length > 0)
        .map((m) => ({
          modelId: m.id!.trim(),
          modelName: m.display_name?.trim() || m.id!.trim(),
          pricingTier: "paid" as const,
          source: "live_api" as const,
        }));
      return { supported: true, models: items, httpStatus: resp.status };
    }

    const endpoint = OPENAI_STYLE_MODELS_URLS[providerId];
    if (!endpoint) {
      return { supported: false, models: [] };
    }

    const resp = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!resp.ok) {
      return {
        supported: true,
        models: [],
        httpStatus: resp.status,
        error:
          resp.status === 401 || resp.status === 403
            ? "API key rejected by provider."
            : `Provider returned HTTP ${resp.status}.`,
      };
    }

    const raw = (await resp.json().catch(() => null)) as
      | { data?: Array<Record<string, unknown>> }
      | Array<Record<string, unknown>>
      | null;
    const rawList = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.data)
        ? raw.data
        : [];

    const items: LiveDiscoveredModel[] = [];
    const seen = new Set<string>();

    if (providerId === "openrouter") {
      items.push({
        modelId: "openrouter/free",
        modelName: "OpenRouter Free Models Router",
        pricingTier: "free",
        source: "live_api",
      });
      items.push({
        modelId: "openrouter/auto",
        modelName: "OpenRouter Auto Router",
        pricingTier: "paid",
        source: "live_api",
      });
      seen.add("openrouter/free");
      seen.add("openrouter/auto");
    }

    for (const entry of rawList) {
      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      if (!id || seen.has(id)) continue;
      if (
        providerId === "openai" &&
        /^(text-embedding|tts-|whisper-|dall-e|babbage|davinci|omni-moderation)/i.test(id)
      ) {
        continue;
      }
      if (providerId === "groq" && /^whisper/i.test(id)) {
        continue;
      }
      seen.add(id);

      const displayName =
        typeof entry.name === "string" && entry.name.trim()
          ? entry.name.trim()
          : id;
      let pricingTier: "free" | "paid" | "unknown" = "paid";
      if (providerId === "openrouter") {
        const pricing = entry.pricing as
          | { prompt?: unknown; completion?: unknown }
          | undefined;
        if (
          id.endsWith(":free") ||
          (pricing && isZeroPrice(pricing.prompt) && isZeroPrice(pricing.completion))
        ) {
          pricingTier = "free";
        }
      } else if (providerId === "groq") {
        pricingTier = "free";
      }

      const ctx =
        typeof entry.context_length === "number"
          ? entry.context_length
          : typeof entry.context_window === "number"
            ? entry.context_window
            : undefined;

      items.push({
        modelId: id,
        modelName: displayName,
        pricingTier,
        ...(ctx ? { contextLength: ctx } : {}),
        source: "live_api",
      });
    }

    items.sort((a, b) => {
      if (a.pricingTier !== b.pricingTier) {
        if (a.pricingTier === "free") return -1;
        if (b.pricingTier === "free") return 1;
      }
      return a.modelName.localeCompare(b.modelName);
    });

    return { supported: true, models: items.slice(0, 350), httpStatus: resp.status };
  } catch {
    return {
      supported: true,
      models: [],
      error: "Could not reach the provider models API right now.",
    };
  } finally {
    clearTimeout(timer);
  }
}

export function createProviderCenterRouter(): IRouter {
  const router: IRouter = Router();

  const authenticatedUid = async (
    req: Request,
    res: Response,
  ): Promise<string | null> => {
    const token = (req.get("authorization") ?? "").match(
      /^Bearer\s+(.+)$/i,
    )?.[1];
    if (!token) {
      res
        .status(401)
        .json({ error: "Sign in to access Provider Center.", code: "auth_failed" });
      return null;
    }
    try {
      const uid = await verifyFirebaseIdToken(token);
      if (uid) return uid;
    } catch {
      // Do not expose auth internals.
    }
    res
      .status(401)
      .json({ error: "Sign in again to access Provider Center.", code: "auth_failed" });
    return null;
  };

  router.get("/provider-center/catalog", async (req, res): Promise<void> => {
    const uid = await authenticatedUid(req, res);
    if (!uid) return;
    try {
      const userKeys = await listVaultKeys(uid);
      const keysByProvider = new Map<string, VaultKeyMetadata[]>();
      for (const key of userKeys) {
        const list = keysByProvider.get(key.provider) ?? [];
        list.push(key);
        keysByProvider.set(key.provider, list);
      }

      const q =
        typeof req.query.q === "string"
          ? req.query.q.trim().toLowerCase()
          : "";
      const capability =
        typeof req.query.capability === "string"
          ? (req.query.capability.trim() as ProviderCapability)
          : undefined;
      const access =
        typeof req.query.access === "string"
          ? (req.query.access.trim() as ModelAccessType)
          : undefined;
      const connectedOnly = req.query.connected === "true";

      const providers = PROVIDER_CATALOG.map((provider) => {
        const pKeys = keysByProvider.get(provider.id) ?? [];
        const pModels = getModelsForProvider(provider.id, false);
        const connectionStatus = computeConnectionStatus(
          pKeys,
          provider.role !== "no_public_api",
        );
        return {
          ...provider,
          modelCount: pModels.length,
          activeModelCount: pModels.filter((m) => m.availability === "active").length,
          keyCount: pKeys.length,
          connectionStatus,
          defaultKeyId: pKeys.find((k) => k.isDefault)?.id ?? pKeys[0]?.id ?? null,
          modelNamesPreview: pModels.slice(0, 6).map((m) => m.modelName),
        };
      }).filter((provider) => {
        if (capability && !provider.capabilities.includes(capability)) {
          return false;
        }
        if (access && !provider.accessTypes.includes(access)) {
          return false;
        }
        if (connectedOnly && provider.connectionStatus !== "connected") {
          return false;
        }
        if (q) {
          const pModels = getModelsForProvider(provider.id, true);
          const haystack = [
            provider.id,
            provider.name,
            provider.shortDescription,
            ...provider.capabilities,
            ...pModels.map((m) => `${m.modelName} ${m.modelId}`),
          ]
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      });

      res.json({
        providers,
        auditSummary: getCatalogAuditSummary(),
      });
    } catch {
      res.status(500).json({
        error: "Could not load Provider Center catalog.",
        code: "catalog_load_failed",
      });
    }
  });

  router.get(
    "/provider-center/providers/:providerId",
    async (req, res): Promise<void> => {
      const uid = await authenticatedUid(req, res);
      if (!uid) return;
      const providerId = String(req.params.providerId ?? "").trim().toLowerCase();
      if (!isValidProviderId(providerId)) {
        res.status(400).json({ error: "Invalid provider ID.", code: "invalid_provider" });
        return;
      }
      const provider = findCatalogProvider(providerId);
      if (!provider) {
        res.status(404).json({ error: "Provider not found.", code: "provider_not_found" });
        return;
      }
      try {
        const keys = await listProviderVaultKeys(uid, provider.id);
        const allModels = getModelsForProvider(provider.id, true);
        const activeModels = allModels.filter(
          (m) =>
            m.availability === "active" ||
            m.availability === "pending_verification" ||
            m.availability === "dynamic_host",
        );
        const inactiveModels = allModels.filter(
          (m) =>
            m.availability === "shut_down" ||
            m.availability === "legacy" ||
            m.availability === "unavailable",
        );
        const connectionStatus = computeConnectionStatus(
          keys,
          provider.role !== "no_public_api",
        );

        res.json({
          provider: {
            ...provider,
            maxKeys: getProviderKeyLimit(provider.id),
            keyCount: keys.length,
            modelCount: activeModels.length,
            connectionStatus,
          },
          keys,
          models: activeModels,
          inactiveModels,
        });
      } catch {
        res.status(500).json({
          error: "Could not load provider details.",
          code: "provider_load_failed",
        });
      }
    },
  );

  router.get(
    "/provider-center/providers/:providerId/live-models",
    async (req, res): Promise<void> => {
      const uid = await authenticatedUid(req, res);
      if (!uid) return;
      const providerId = String(req.params.providerId ?? "").trim().toLowerCase();
      if (!isValidProviderId(providerId)) {
        res.status(400).json({ error: "Invalid provider ID.", code: "invalid_provider" });
        return;
      }
      const preferredKeyId =
        typeof req.query.keyId === "string" && isValidKeyId(req.query.keyId)
          ? req.query.keyId
          : undefined;
      try {
        const secret = await getDefaultProviderKeySecret(
          uid,
          providerId,
          preferredKeyId,
        );
        if (!secret) {
          res.status(404).json({
            error: "Add an API key for this provider first.",
            code: "missing_key",
          });
          return;
        }
        const result = await fetchLiveModelsFromProvider(providerId, secret.value);
        res.json({
          providerId,
          keyId: secret.id,
          supported: result.supported,
          models: result.models,
          ...(result.httpStatus ? { httpStatus: result.httpStatus } : {}),
          ...(result.error ? { error: result.error } : {}),
        });
      } catch {
        res.status(500).json({
          error: "Could not fetch live models from provider.",
          code: "live_models_failed",
        });
      }
    },
  );

  router.get("/provider-center/models", async (req, res): Promise<void> => {
    const uid = await authenticatedUid(req, res);
    if (!uid) return;
    const models = queryModelRegistry({
      providerId:
        typeof req.query.provider === "string" ? req.query.provider : undefined,
      category:
        typeof req.query.category === "string"
          ? (req.query.category as ModelCategory)
          : undefined,
      capability:
        typeof req.query.capability === "string"
          ? (req.query.capability as ProviderCapability)
          : undefined,
      accessType:
        typeof req.query.access === "string"
          ? (req.query.access as ModelAccessType)
          : undefined,
      query: typeof req.query.q === "string" ? req.query.q : undefined,
      includeInactive: req.query.includeInactive === "true",
    });
    res.json({
      models,
      totalRegistrySize: MODEL_REGISTRY.length,
    });
  });

  router.post(
    "/provider-center/providers/:providerId/keys",
    async (req, res): Promise<void> => {
      const uid = await authenticatedUid(req, res);
      if (!uid) return;
      const providerId = String(req.params.providerId ?? "").trim().toLowerCase();
      const provider = findCatalogProvider(providerId);
      if (!provider) {
        res.status(404).json({ error: "Provider not found.", code: "provider_not_found" });
        return;
      }
      if (provider.role === "no_public_api") {
        res.status(400).json({
          error: "This provider does not offer an official public API.",
          code: "no_public_api",
        });
        return;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const rawValue = typeof body.value === "string" ? body.value.trim() : "";
      const rawLabel = typeof body.label === "string" ? body.label.trim() : undefined;
      const makeDefault = body.makeDefault === true;

      if (!rawValue || rawValue.length > 4096) {
        res.status(400).json({
          error: "Enter a valid API key value.",
          code: "invalid_key_value",
        });
        return;
      }

      try {
        const defaultModels = getModelsForProvider(provider.id, false)
          .filter((m) => m.category === "text_chat" && m.availability === "active")
          .map((m) => m.modelId);
        const created = await createProviderVaultKey(uid, provider.id, {
          label: rawLabel,
          value: rawValue,
          makeDefault,
          ...(defaultModels.length > 0 ? { models: defaultModels } : {}),
        });
        res.status(201).json({ key: created });
      } catch (error) {
        if (error instanceof ProviderKeyLimitError) {
          res.status(409).json({
            error: error.message,
            code: error.code,
            limit: error.limit,
          });
          return;
        }
        res.status(500).json({
          error: "Could not save API key.",
          code: "key_save_failed",
        });
      }
    },
  );

  router.patch(
    "/provider-center/providers/:providerId/keys/:keyId",
    async (req, res): Promise<void> => {
      const uid = await authenticatedUid(req, res);
      if (!uid) return;
      const providerId = String(req.params.providerId ?? "").trim().toLowerCase();
      const keyId = String(req.params.keyId ?? "").trim();
      if (!isValidProviderId(providerId) || !isValidKeyId(keyId)) {
        res.status(400).json({ error: "Invalid key reference.", code: "validation_failed" });
        return;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const newLabel = typeof body.label === "string" ? body.label.trim() : "";
      const newValue = typeof body.value === "string" ? body.value.trim() : "";
      const makeDefault = body.isDefault === true;

      try {
        let updated: VaultKeyMetadata | null = null;
        if (newValue) {
          if (newValue.length > 4096) {
            res.status(400).json({ error: "API key is too long.", code: "invalid_key_value" });
            return;
          }
          updated = await updateVaultKeyValue(uid, providerId, keyId, newValue);
          if (!updated) {
            res.status(404).json({ error: "API key not found.", code: "key_not_found" });
            return;
          }
        }
        if (newLabel) {
          updated = await renameVaultKey(uid, providerId, keyId, newLabel);
          if (!updated) {
            res.status(404).json({ error: "API key not found.", code: "key_not_found" });
            return;
          }
        }
        if (makeDefault) {
          updated = await setDefaultVaultKey(uid, providerId, keyId);
          if (!updated) {
            res.status(404).json({ error: "API key not found.", code: "key_not_found" });
            return;
          }
        }
        if (!updated) {
          res.status(400).json({ error: "No valid changes provided.", code: "validation_failed" });
          return;
        }
        res.json({ key: updated });
      } catch {
        res.status(500).json({
          error: "Could not update API key.",
          code: "key_update_failed",
        });
      }
    },
  );

  router.post(
    "/provider-center/providers/:providerId/keys/:keyId/default",
    async (req, res): Promise<void> => {
      const uid = await authenticatedUid(req, res);
      if (!uid) return;
      const providerId = String(req.params.providerId ?? "").trim().toLowerCase();
      const keyId = String(req.params.keyId ?? "").trim();
      if (!isValidProviderId(providerId) || !isValidKeyId(keyId)) {
        res.status(400).json({ error: "Invalid key reference.", code: "validation_failed" });
        return;
      }
      try {
        const updated = await setDefaultVaultKey(uid, providerId, keyId);
        if (!updated) {
          res.status(404).json({ error: "API key not found.", code: "key_not_found" });
          return;
        }
        res.json({ key: updated });
      } catch {
        res.status(500).json({
          error: "Could not set default API key.",
          code: "key_update_failed",
        });
      }
    },
  );

  router.post(
    "/provider-center/providers/:providerId/keys/:keyId/models",
    async (req, res): Promise<void> => {
      const uid = await authenticatedUid(req, res);
      if (!uid) return;
      const providerId = String(req.params.providerId ?? "").trim().toLowerCase();
      const keyId = String(req.params.keyId ?? "").trim();
      const body = (req.body ?? {}) as Record<string, unknown>;
      const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
      if (!isValidProviderId(providerId) || !isValidKeyId(keyId) || !isValidVaultModelId(modelId)) {
        res.status(400).json({ error: "Enter a valid model ID.", code: "invalid_model_id" });
        return;
      }
      try {
        const updated = await addProviderKeyModel(uid, providerId, keyId, modelId);
        if (!updated) {
          res.status(404).json({ error: "API key not found.", code: "key_not_found" });
          return;
        }
        res.json({ key: updated });
      } catch {
        res.status(500).json({ error: "Could not save model.", code: "model_save_failed" });
      }
    },
  );

  router.delete(
    "/provider-center/providers/:providerId/keys/:keyId/models",
    async (req, res): Promise<void> => {
      const uid = await authenticatedUid(req, res);
      if (!uid) return;
      const providerId = String(req.params.providerId ?? "").trim().toLowerCase();
      const keyId = String(req.params.keyId ?? "").trim();
      const body = (req.body ?? {}) as Record<string, unknown>;
      const rawModel =
        typeof body.modelId === "string"
          ? body.modelId
          : typeof req.query.modelId === "string"
            ? req.query.modelId
            : "";
      const modelId = rawModel.trim();
      if (!isValidProviderId(providerId) || !isValidKeyId(keyId) || !isValidVaultModelId(modelId)) {
        res.status(400).json({ error: "Invalid model ID.", code: "invalid_model_id" });
        return;
      }
      try {
        const updated = await removeProviderKeyModel(uid, providerId, keyId, modelId);
        if (!updated) {
          res.status(404).json({ error: "API key not found.", code: "key_not_found" });
          return;
        }
        res.json({ key: updated });
      } catch {
        res.status(500).json({ error: "Could not remove model.", code: "model_remove_failed" });
      }
    },
  );

  router.delete(
    "/provider-center/providers/:providerId/keys/:keyId",
    async (req, res): Promise<void> => {
      const uid = await authenticatedUid(req, res);
      if (!uid) return;
      const providerId = String(req.params.providerId ?? "").trim().toLowerCase();
      const keyId = String(req.params.keyId ?? "").trim();
      if (!isValidProviderId(providerId) || !isValidKeyId(keyId)) {
        res.status(400).json({ error: "Invalid key reference.", code: "validation_failed" });
        return;
      }
      try {
        const deleted = await deleteProviderVaultKey(uid, providerId, keyId);
        if (!deleted) {
          res.status(404).json({ error: "API key not found.", code: "key_not_found" });
          return;
        }
        res.json({ deleted: true, id: keyId });
      } catch {
        res.status(500).json({
          error: "Could not delete API key.",
          code: "key_delete_failed",
        });
      }
    },
  );

  return router;
}

export default createProviderCenterRouter();
