import { Router, type IRouter, type Request, type Response } from "express";
import { verifyFirebaseIdToken } from "../lib/firebaseAdmin";
import {
  createCustomSkill,
  deleteCustomSkill,
  getUserSkillsSnapshot,
  setActiveSkillIds,
  SkillsServiceError,
  updateCustomSkill,
  type SkillScope,
} from "../lib/skillsService";

function isValidSkillId(value: string): boolean {
  return /^[A-Za-z0-9_-]{3,128}$/.test(value);
}

export function createSkillsRouter(): IRouter {
  const router: IRouter = Router();

  const requireUid = async (
    req: Request,
    res: Response,
  ): Promise<string | null> => {
    const token = (req.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      res.status(401).json({ error: "Sign in to manage Skills.", code: "auth_failed" });
      return null;
    }
    try {
      const uid = await verifyFirebaseIdToken(token);
      if (uid) return uid;
    } catch {
      // Do not expose auth internals.
    }
    res.status(401).json({ error: "Sign in again to manage Skills.", code: "auth_failed" });
    return null;
  };

  router.get("/skills", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    try {
      const snapshot = await getUserSkillsSnapshot(uid);
      res.json(snapshot);
    } catch {
      res.status(500).json({ error: "Could not load Skills.", code: "skills_load_failed" });
    }
  });

  router.post("/skills", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const result = await createCustomSkill(uid, {
        name: typeof body.name === "string" ? body.name : "",
        description:
          typeof body.description === "string" ? body.description : undefined,
        scopes: Array.isArray(body.scopes)
          ? (body.scopes as SkillScope[])
          : ["all"],
        instructions:
          typeof body.instructions === "string" ? body.instructions : "",
        promptPrefix:
          typeof body.promptPrefix === "string" ? body.promptPrefix : undefined,
        activate: body.activate !== false,
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof SkillsServiceError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({ error: "Could not create Skill.", code: "skills_create_failed" });
    }
  });

  router.put("/skills/state", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawIds = Array.isArray(body.activeIds)
      ? body.activeIds.filter((x): x is string => typeof x === "string")
      : [];
    try {
      const activeIds = await setActiveSkillIds(uid, rawIds);
      res.json({ activeIds });
    } catch {
      res.status(500).json({ error: "Could not update active Skills.", code: "skills_state_failed" });
    }
  });

  router.patch("/skills/:skillId", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const skillId = String(req.params.skillId ?? "").trim();
    if (!isValidSkillId(skillId)) {
      res.status(400).json({ error: "Invalid Skill ID.", code: "invalid_id" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const updated = await updateCustomSkill(uid, skillId, {
        ...(typeof body.name === "string" ? { name: body.name } : {}),
        ...(typeof body.description === "string"
          ? { description: body.description }
          : {}),
        ...(Array.isArray(body.scopes)
          ? { scopes: body.scopes as SkillScope[] }
          : {}),
        ...(typeof body.instructions === "string"
          ? { instructions: body.instructions }
          : {}),
        ...(typeof body.promptPrefix === "string"
          ? { promptPrefix: body.promptPrefix }
          : {}),
      });
      if (!updated) {
        res.status(404).json({ error: "Skill not found.", code: "not_found" });
        return;
      }
      res.json({ skill: updated });
    } catch (err) {
      if (err instanceof SkillsServiceError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      res.status(500).json({ error: "Could not update Skill.", code: "skills_update_failed" });
    }
  });

  router.delete("/skills/:skillId", async (req, res): Promise<void> => {
    const uid = await requireUid(req, res);
    if (!uid) return;
    const skillId = String(req.params.skillId ?? "").trim();
    if (!isValidSkillId(skillId)) {
      res.status(400).json({ error: "Invalid Skill ID.", code: "invalid_id" });
      return;
    }
    try {
      const result = await deleteCustomSkill(uid, skillId);
      if (!result.deleted) {
        res.status(404).json({ error: "Skill not found.", code: "not_found" });
        return;
      }
      res.json(result);
    } catch {
      res.status(500).json({ error: "Could not delete Skill.", code: "skills_delete_failed" });
    }
  });

  return router;
}

export default createSkillsRouter();