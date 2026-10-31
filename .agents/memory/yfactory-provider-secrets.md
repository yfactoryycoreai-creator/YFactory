---
name: YFactory provider secrets
description: Product requirements for managing and selecting user-supplied image-provider credentials.
---

Replit Secrets are the source of truth for global provider credentials. Discover unnumbered and positive-numbered names dynamically; Cloudflare token and account ID suffixes must match. Keep values server-side, expose only provider/index metadata, and persist cooldowns server-side. If user-specific keys are part of a later scope, keep them server-side and use global Replit Secrets as fallback.

**Why:** The user specified this as YFactory's provider-credential contract and explicitly required Replit Secrets to remain authoritative.

**How to apply:** Preserve dynamic discovery, Cloudflare pairing, sanitized status/trails, server-only state, and per-provider rotation when adding provider integrations or key-management UI.
