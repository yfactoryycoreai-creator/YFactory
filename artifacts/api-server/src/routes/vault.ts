import { Router, type IRouter } from "express";
import {
  CreateVaultKeyBody,
  CreateVaultKeyResponse,
  DeleteVaultKeyParams,
  ListVaultKeysResponse,
} from "@workspace/api-zod";
import {
  createVaultKey,
  deleteVaultKey,
  listVaultKeys,
  listProviderConfigs,
  updateVaultKeyValue,
  providerForSecretName,
  type ProviderKey,
} from "../lib/apiKeyVault";
import { keyPool } from "../lib/keyPool";
import { verifyFirebaseIdToken } from "../lib/firebaseAdmin";

const router: IRouter = Router();
const KEY_STATUS_PROVIDERS = ["agnes", "cloudflare", "glm", "magic_hour"] as const;

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

router.get("/vault/key-pool-status", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  try {
    const status = await keyPool.readStatus();
    res.json({
      providers: KEY_STATUS_PROVIDERS.map((provider) => {
        const current = status.providers.find((item) => item.provider === provider);
        return {
          provider,
          credentialCount: current?.credentialCount ?? 0,
          credentials: (current?.credentials ?? []).map((credential) => ({
            index: credential.index,
            state: credential.state,
            ...(credential.state === "ready" ? {} : { until: credential.until }),
          })),
        };
      }),
    });
  } catch (error) {
    req.log.warn(
      { reason: error instanceof Error ? error.name : "unknown" },
      "Could not load provider key status.",
    );
    res.status(503).json({ error: "Provider key status is unavailable.", code: "key_status_unavailable" });
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
    !parsed.data.value.trim() ||
    parsed.data.value.trim().length > 4096
  ) {
    res.status(400).json({ error: "Provide a provider, key name, and API key.", code: "invalid_request" });
    return;
  }
  const secretProvider = providerForSecretName(parsed.data.label);
  if (!secretProvider || parsed.data.provider !== secretProvider) {
    res.status(400).json({
      error: "Use an AGNES_API_KEY or GLM_API_KEY name, with an optional numeric suffix.",
      code: "invalid_secret_name",
    });
    return;
  }
  const providerConfig = (await listProviderConfigs(uid)).find(
    (provider) => provider.id === parsed.data.provider,
  );
  if (!providerConfig) {
    res.status(400).json({ error: "Add this provider before saving a key.", code: "provider_not_found" });
    return;
  }
  try {
    const existingKeys = await listVaultKeys(uid);
    if (existingKeys.some((key) => key.label === parsed.data.label.trim())) {
      res.status(409).json({ error: "A secret with this name already exists.", code: "duplicate_secret_name" });
      return;
    }
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

router.put("/vault/keys/:provider/:keyId/value", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res);
  if (!uid) return;
  const provider = String(req.params.provider ?? "");
  const keyId = String(req.params.keyId ?? "");
  const value = typeof req.body?.value === "string" ? req.body.value.trim() : "";
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(provider) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(keyId) ||
      !value || value.length > 4096) {
    res.status(400).json({ error: "Provide a valid API key value.", code: "invalid_request" });
    return;
  }
  try {
    const key = await updateVaultKeyValue(
      uid,
      provider as ProviderKey,
      keyId,
      value,
    );
    if (!key) {
      res.status(404).json({ error: "API key not found.", code: "key_not_found" });
      return;
    }
    res.json(CreateVaultKeyResponse.parse(key));
  } catch (error) {
    req.log.error(
      { reason: error instanceof Error ? error.message : "unknown" },
      "Could not replace encrypted API key value.",
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
