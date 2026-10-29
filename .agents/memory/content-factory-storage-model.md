---
name: Content Factory storage model
description: YFactory's story hierarchy and the meaning of its storage-usage meter.
---

For YFactory, store stories at `users/{uid}/stories/{storyId}`, image metadata in each story's `images` subcollection, and image bytes in Firebase Storage. Enforce the 100-image story limit with a Firestore transaction. The UI's 20 GB meter is an estimate based on bytes recorded for that user's saved story images, not a live bucket-wide usage query.

**Why:** The user requested per-user story organization, Firebase Storage, and a 20 GB usage indicator; the client can total its own image metadata but should not present it as the bucket's actual live usage.

**How to apply:** Preserve the hierarchy and transactional count on future story/image changes, and continue calling the displayed storage value an estimate.
