---
name: Firebase database region
description: YFactory's existing Firestore database location and operating mode.
---

YFactory's default Firestore database is in `europe-west8` (Milan) and was created in Production mode. Preserve this database and do not create or migrate to another region without an explicit request.

**Why:** Firestore database location is fixed at creation, and this is the user's existing database.

**How to apply:** Use the default database through Firebase Admin and keep security rules owner-scoped; do not change database ID or region.
