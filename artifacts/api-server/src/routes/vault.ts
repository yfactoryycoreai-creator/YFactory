import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  CreateVaultKeyBody,
  CreateVaultKeyResponse,
  DeleteVaultKeyParams,
  ListVaultKeysResponse,
  UpdateVaultKeyBody,
  UpdateVaultKeyParams,
  UpdateVaultKeyResponse,
} from "@workspace/api-zod";
import {
  createVaultKey,
  deleteVaultKey,
  listVaultKeys,
  listProviderConfigs,
  saveProviderConfig,
  updateVaultKey,
  type ProviderKey,
} from "../lib/apiKeyVault";
import { verifyFirebaseIdToken } from "../lib/firebaseAdmin";

const router: IRouter = Router();

router.get("/providers", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  try {
    res.json({ providers: await listProviderConfigs(uid) });
  } catch (error) {
    req.log.error({ reason: error instanceof Error ? error.message : "unknown" }, "Could not load providers.");
    res.status(503).json({ error: "Providers could not be loaded.", code: "providers_unavailable" });
  }
});

router.post("/providers", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  const body = req.body as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const category = body.category;
  const adapter = body.adapter;
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!name || name.length > 80 ||
      (category !== "image" && category !== "storage") ||
      !["agnes", "glm", "zsky", "pollinations", "cloudinary", "openai-compatible"].includes(String(adapter)) ||
      (adapter === "openai-compatible" && (!baseUrl || !model))) {
    res.status(400).json({ error: "Provide a provider name, category, and supported adapter configuration.", code: "invalid_request" });
    return;
  }
  if ((category === "storage") !== (adapter === "cloudinary")) {
    res.status(400).json({ error: "Cloudinary is the only storage adapter; image adapters use the image category.", code: "invalid_request" });
    return;
  }
  const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "provider"}-${randomUUID().slice(0, 6)}`;
  try {
    await saveProviderConfig(uid, {
      id,
      name,
      category,
      adapter: adapter as "agnes" | "glm" | "zsky" | "pollinations" | "cloudinary" | "openai-compatible",
      enabled: body.enabled !== false,
      rotationOrder: Number.isInteger(body.rotationOrder) ? Number(body.rotationOrder) : 10,
      ...(baseUrl ? { baseUrl } : {}),
      ...(model ? { model } : {}),
    });
    res.status(201).json({ providers: await listProviderConfigs(uid) });
  } catch (error) {
    req.log.error({ reason: error instanceof Error ? error.message : "unknown" }, "Could not save provider.");
    res.status(503).json({ error: "Provider could not be saved.", code: "providers_unavailable" });
  }
});

router.patch("/providers/:providerId", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  const providerId = String(req.params.providerId ?? "");
  const current = (await listProviderConfigs(uid)).find((provider) => provider.id === providerId);
  if (!current) {
    res.status(404).json({ error: "Provider not found.", code: "provider_not_found" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const enabled = typeof body.enabled === "boolean" ? body.enabled : current.enabled;
  const rotationOrder = Number.isInteger(body.rotationOrder) ? Number(body.rotationOrder) : current.rotationOrder;
  try {
    await saveProviderConfig(uid, {
      id: current.id,
      name: current.name,
      category: current.category,
      adapter: current.adapter,
      enabled,
      rotationOrder,
      ...(current.baseUrl ? { baseUrl: current.baseUrl } : {}),
      ...(current.model ? { model: current.model } : {}),
    });
    res.json({ providers: await listProviderConfigs(uid) });
  } catch (error) {
    req.log.error({ reason: error instanceof Error ? error.message : "unknown" }, "Could not update provider.");
    res.status(503).json({ error: "Provider could not be updated.", code: "providers_unavailable" });
  }
});

async function authenticatedUid(
  req: Parameters<Parameters<IRouter["get"]>[1]>[0],
  res: Parameters<Parameters<IRouter["get"]>[1]>[1],
): Promise<string | null> {
  const authorization = req.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    res.status(401).json({ error: "Sign in before managing API keys.", code: "unauthorized" });
    return null;
  }
  try {
    const uid = await verifyFirebaseIdToken(token);
    if (!uid) {
      res.status(401).json({ error: "Sign in again before managing API keys.", code: "unauthorized" });
      return null;
    }
    return uid;
  } catch (error) {
    req.log.error(
      { reason: error instanceof Error ? error.message : "Firebase Admin configuration error" },
      "Could not verify Firebase ID token.",
    );
    res.status(503).json({
      error: "The API key vault is not configured.",
      code: "server_configuration",
    });
    return null;
  }
}

router.get("/vault/keys", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  try {
    const response = ListVaultKeysResponse.parse({ keys: await listVaultKeys(uid) });
    res.json(response);
  } catch (error) {
    req.log.error(
      { reason: error instanceof Error ? error.message : "unknown" },
      "Could not load encrypted API key metadata.",
    );
    res.status(503).json({
      error: "The API key vault could not be loaded.",
      code: "vault_unavailable",
    });
  }
});

router.post("/vault/keys", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  const parsed = CreateVaultKeyBody.safeParse(req.body);
  if (
    !parsed.success ||
    !parsed.data.label.trim() ||
    !parsed.data.value.trim()
  ) {
    res.status(400).json({ error: "Provide a provider, key name, and API key.", code: "invalid_request" });
    return;
  }
  const providerConfig = (await listProviderConfigs(uid)).find(
    (provider) => provider.id === parsed.data.provider,
  );
  if (!providerConfig) {
    res.status(400).json({ error: "Add this provider before saving a key.", code: "provider_not_found" });
    return;
  }
  if (
    providerConfig.adapter === "cloudinary" &&
    !/^cloudinary:\/\/[^:]+:.+@[^/]+$/i.test(parsed.data.value.trim())
  ) {
    res.status(400).json({
      error: "Cloudinary keys must use cloudinary://API_KEY:API_SECRET@CLOUD_NAME.",
      code: "invalid_cloudinary_key",
    });
    return;
  }
  try {
    const key = await createVaultKey(
      uid,
      parsed.data.provider as ProviderKey,
      parsed.data.label,
      parsed.data.value,
    );
    res.status(201).json(CreateVaultKeyResponse.parse(key));
  } catch (error) {
    req.log.error(
      { reason: error instanceof Error ? error.message : "unknown" },
      "Could not save encrypted API key.",
    );
    res.status(503).json({
      error: "The API key could not be saved.",
      code: "vault_unavailable",
    });
  }
});

router.patch("/vault/keys/:provider/:keyId", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  const params = UpdateVaultKeyParams.safeParse(req.params);
  const body = UpdateVaultKeyBody.safeParse(req.body);
  if (
    !params.success ||
    !body.success ||
    (body.data.label === undefined && body.data.enabled === undefined) ||
    (body.data.label !== undefined && !body.data.label.trim())
  ) {
    res.status(400).json({ error: "Provide a valid key name or enabled state.", code: "invalid_request" });
    return;
  }
  try {
    const key = await updateVaultKey(
      uid,
      params.data.provider as ProviderKey,
      params.data.keyId,
      body.data,
    );
    if (!key) {
      res.status(404).json({ error: "API key not found.", code: "key_not_found" });
      return;
    }
    res.json(UpdateVaultKeyResponse.parse(key));
  } catch (error) {
    req.log.error(
      { reason: error instanceof Error ? error.message : "unknown" },
      "Could not update encrypted API key.",
    );
    res.status(503).json({
      error: "The API key could not be updated.",
      code: "vault_unavailable",
    });
  }
});

router.delete("/vault/keys/:provider/:keyId", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  const params = DeleteVaultKeyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "The API key reference is invalid.", code: "invalid_request" });
    return;
  }
  try {
    const deleted = await deleteVaultKey(
      uid,
      params.data.provider as ProviderKey,
      params.data.keyId,
    );
    if (!deleted) {
      res.status(404).json({ error: "API key not found.", code: "key_not_found" });
      return;
    }
    res.sendStatus(204);
  } catch (error) {
    req.log.error(
      { reason: error instanceof Error ? error.message : "unknown" },
      "Could not delete encrypted API key.",
    );
    res.status(503).json({
      error: "The API key could not be deleted.",
      code: "vault_unavailable",
    });
  }
});

export default router;
