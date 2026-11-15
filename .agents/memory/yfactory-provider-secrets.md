---
name: YFactory provider secrets
description: Product requirements for managing and selecting user-supplied image-provider credentials.
---

Keep existing Replit environment credentials available to generation engines, but isolate user-supplied vault secrets by Firebase UID and never use environment credentials as a fallback for Gemini chat. Treat the vault's model type and description as organizational metadata only; runtime integrations remain determined by existing provider mappings. Discover unnumbered and positive-numbered environment names dynamically, and keep Cloudflare token/account ID suffixes paired.

Keep Chat model discovery manual-only until a supported listing endpoint is documented. Users enter exact model IDs, which are sent through the selected user's encrypted vault key.

**Why:** The user requires existing generation integrations to keep working while their own vault keys remain private, and explicitly says model type does not connect a provider.

**How to apply:** Preserve environment-key discovery, Cloudflare pairing, sanitized status/trails, and existing provider rotation. For user-vault features, derive ownership from the verified Firebase ID token, keep values encrypted server-side, and enable only integrations the runtime already supports.

**Why:** The user directed us to omit automatic Gemini model listing because the official OpenAI-compatibility documentation does not document it.

**How to apply:** Keep provider endpoints registry-controlled and use manual model IDs until the provider officially documents a supported list operation.
