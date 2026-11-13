import { Router, type IRouter } from "express";
import {
  CreateVaultKeyBody,
  CreateVaultKeyResponse,
  DeleteVaultKeyParams,
  ListVaultKeysResponse,
  RevealVaultKeyValueParams,
  RevealVaultKeyValueResponse,
  UpdateVaultKeyBody,
  UpdateVaultKeyParams,
  UpdateVaultKeyResponse,
} from "@workspace/api-zod";
import {
  createVaultKey,
  deleteVaultKey,
  getVaultKeyValue,
  listVaultKeys,
  listProviderConfigs,
  updateVaultKey,
  updateVaultKeyValue,
  providerForSecretName,
  type ProviderKey,
} from "../lib/apiKeyVault";
import { keyPool } from "../lib/keyPool";
import { verifyFirebaseIdToken } from "../lib/firebaseAdmin";

const KEY_STATUS_PROVIDERS = ["agnes", "cloudflare", "glm", "magic_hour"] as const;
type VaultRouterDependencies = {
  verifyIdToken: typeof verifyFirebaseIdToken;
  listProviders: typeof listProviderConfigs;
  listKeys: typeof listVaultKeys;
  createKey: typeof createVaultKey;
  updateKey: typeof updateVaultKey;
  updateValue: typeof updateVaultKeyValue;
  revealValue: typeof getVaultKeyValue;
  deleteKey: typeof deleteVaultKey;
  readKeyPoolStatus: typeof keyPool.readStatus;
};

export function createVaultRouter(
  overrides: Partial<VaultRouterDependencies> = {},
): IRouter {
  const dependencies: VaultRouterDependencies = {
    verifyIdToken: verifyFirebaseIdToken,
    listProviders: listProviderConfigs,
    listKeys: listVaultKeys,
    createKey: createVaultKey,
    updateKey: updateVaultKey,
    updateValue: updateVaultKeyValue,
    revealValue: getVaultKeyValue,
    deleteKey: deleteVaultKey,
    readKeyPoolStatus: () => keyPool.readStatus(),
    ...overrides,
  };
  const router: IRouter = Router();

router.get("/providers", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res, dependencies.verifyIdToken);
  if (!uid) return;
  try {
    res.json({ providers: await dependencies.listProviders(uid) });
  } catch (error) {
    req.log.error({ reason: error instanceof Error ? error.message : "unknown" }, "Could not load providers.");
    res.status(503).json({ error: "Providers could not be loaded.", code: "providers_unavailable" });
  }
});

router.get("/vault/key-pool-status", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res, dependencies.verifyIdToken);
  if (!uid) return;
  try {
    const status = await dependencies.readKeyPoolStatus();
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
  verifyIdToken: typeof verifyFirebaseIdToken = verifyFirebaseIdToken,
): Promise<string | null> {
  const authorization = req.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    res.status(401).json({ error: "Sign in before managing API keys.", code: "unauthorized" });
    return null;
  }
  try {
    const uid = await verifyIdToken(token);
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
  const uid = await authenticatedUid(req, res, dependencies.verifyIdToken);
  if (!uid) return;
  try {
    const response = ListVaultKeysResponse.parse({ keys: await dependencies.listKeys(uid) });
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
  const uid = await authenticatedUid(req, res, dependencies.verifyIdToken);
  if (!uid) return;
  const parsed = CreateVaultKeyBody.safeParse(req.body);
  if (
    !parsed.success ||
    !parsed.data.label.trim() ||
    parsed.data.label.trim().length > 100 ||
    /[\u0000-\u001f\u007f]/.test(parsed.data.label) ||
    !parsed.data.value.trim() ||
    parsed.data.value.trim().length > 4096 ||
    (parsed.data.modelType !== undefined &&
      !["images", "video", "text"].includes(parsed.data.modelType)) ||
    (parsed.data.description !== undefined && parsed.data.description.length > 500)
  ) {
    res.status(400).json({ error: "Provide a valid name, model type, and API key.", code: "invalid_request" });
    return;
  }
  const secretProvider = providerForSecretName(parsed.data.label);
  const providerConfig = (await dependencies.listProviders(uid)).find(
    (provider) => provider.id === secretProvider,
  );
  if (secretProvider !== "custom" && secretProvider !== "gemini" && !providerConfig) {
    res.status(400).json({ error: "Add this provider before saving a key.", code: "provider_not_found" });
    return;
  }
  try {
    const existingKeys = await dependencies.listKeys(uid);
    if (existingKeys.some((key) => key.label.trim().toLocaleLowerCase() === parsed.data.label.trim().toLocaleLowerCase())) {
      res.status(409).json({ error: "A secret with this name already exists.", code: "duplicate_secret_name" });
      return;
    }
    if (existingKeys.length >= 100) {
      res.status(409).json({ error: "The secret limit has been reached.", code: "secret_limit" });
      return;
    }
    const key = await dependencies.createKey(
      uid,
      secretProvider as ProviderKey,
      parsed.data.label,
      parsed.data.value,
      parsed.data.modelType ?? null,
      parsed.data.description?.trim() || null,
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
  const uid = await authenticatedUid(req, res, dependencies.verifyIdToken);
  if (!uid) return;
  const params = UpdateVaultKeyParams.safeParse(req.params);
  const parsed = UpdateVaultKeyBody.safeParse(req.body);
  const label = parsed.success ? parsed.data.label.trim() : "";
  const value = parsed.success ? parsed.data.value : null;
  if (
    !params.success ||
    !parsed.success ||
    !label ||
    label.length > 100 ||
    /[\u0000-\u001f\u007f]/.test(label) ||
    (value !== null && (!value.trim() || value.trim().length > 4096)) ||
    (parsed.success && parsed.data.description !== null && parsed.data.description.length > 500)
  ) {
    res.status(400).json({ error: "Provide valid secret details.", code: "invalid_request" });
    return;
  }
  try {
    const existingKeys = await dependencies.listKeys(uid);
    if (existingKeys.some((key) =>
      key.label.trim().toLocaleLowerCase() === label.toLocaleLowerCase() &&
      !(key.provider === params.data.provider && key.id === params.data.keyId)
    )) {
      res.status(409).json({ error: "A secret with this name already exists.", code: "duplicate_secret_name" });
      return;
    }
    const updated = await dependencies.updateKey(
      uid,
      params.data.provider as ProviderKey,
      params.data.keyId,
      {
        label,
        modelType: parsed.data.modelType,
        description: parsed.data.description,
        value: value?.trim() || null,
      },
    );
    if (!updated) {
      res.status(404).json({ error: "API key not found.", code: "key_not_found" });
      return;
    }
    res.json(UpdateVaultKeyResponse.parse(updated));
  } catch (error) {
    req.log.error(
      { reason: error instanceof Error ? error.name : "unknown" },
      "Could not update encrypted API key metadata.",
    );
    res.status(503).json({
      error: "The API key could not be updated.",
      code: "vault_unavailable",
    });
  }
});

router.get("/vault/keys/:provider/:keyId/value", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res, dependencies.verifyIdToken);
  if (!uid) return;
  const params = RevealVaultKeyValueParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "The API key reference is invalid.", code: "invalid_request" });
    return;
  }
  try {
    const value = await dependencies.revealValue(
      uid,
      params.data.provider as ProviderKey,
      params.data.keyId,
    );
    if (value === null) {
      res.status(404).json({ error: "API key not found.", code: "key_not_found" });
      return;
    }
    res.json(RevealVaultKeyValueResponse.parse({ value }));
  } catch (error) {
    req.log.error(
      { reason: error instanceof Error ? error.name : "unknown" },
      "Could not reveal encrypted API key.",
    );
    res.status(503).json({
      error: "The API key could not be revealed.",
      code: "vault_unavailable",
    });
  }
});

router.put("/vault/keys/:provider/:keyId/value", async (req, res): Promise<void> => {
  const uid = await authenticatedUid(req, res, dependencies.verifyIdToken);
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
    const key = await dependencies.updateValue(
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
  const uid = await authenticatedUid(req, res, dependencies.verifyIdToken);
  if (!uid) return;
  const params = DeleteVaultKeyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "The API key reference is invalid.", code: "invalid_request" });
    return;
  }
  try {
    const deleted = await dependencies.deleteKey(
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

  return router;
}

const router = createVaultRouter();
export default router;
