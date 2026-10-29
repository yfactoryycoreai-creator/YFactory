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
  updateVaultKey,
  type ProviderKey,
} from "../lib/apiKeyVault";
import { verifyFirebaseIdToken } from "../lib/firebaseAdmin";

const router: IRouter = Router();

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
