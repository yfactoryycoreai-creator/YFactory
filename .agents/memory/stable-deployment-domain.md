---
name: Stable deployment domain
description: The user's published YFactory hostname for production-domain guidance.
---

YFactory's published domain is `y-factory-studio--youyouyussef63.replit.app`. The user stated that this hostname was added to Firebase Authentication's Authorized Domains.

**Why:** Authentication needs the current published hostname to be allowlisted in Firebase.

**How to apply:** Use this hostname when reasoning about production auth redirects or domain authorization; do not assume preview hostnames are interchangeable.
