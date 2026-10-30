---
name: YFactory provider secrets
description: Product requirements for managing and selecting user-supplied image-provider credentials.
---

YFactory accepts user credentials named `AGNES_API_KEY`, `AGNES_API_KEY_2`, and subsequent numbered variants, plus the equivalent `GLM_API_KEY` names. Keep values server-side, return only masked previews to the client, rotate keys sharing a provider prefix with the existing cooldown logic, and use server environment credentials when the user has no key for that provider.

**Why:** The user specified this as the credential-management contract for YFactory.

**How to apply:** Preserve the naming, server-only storage, masked responses, fallback, and per-provider rotation behavior in future key-management work.
