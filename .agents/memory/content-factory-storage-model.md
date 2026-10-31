---
name: Content Factory storage model
description: YFactory's story hierarchy and the meaning of its storage-usage meter.
---

For YFactory, store stories at `users/{uid}/stories/{storyId}`, image metadata in each story's `images` subcollection, and image bytes in Cloudinary using server-signed uploads to per-user/story folders. Enforce the 100-image story limit with a Firestore transaction; increment the count only after upload and metadata write succeed, and delete the Cloudinary asset if the Firestore write fails. The UI's 20 GB meter is an estimate based on bytes recorded for that user's saved story images.

**Why:** The user will not upgrade Firebase to Blaze and chose Cloudinary for story-image storage; the client can total its own image metadata but should not present it as Cloudinary's live account usage.

**How to apply:** Preserve the Firestore hierarchy and transactional count, keep Cloudinary credentials server-side, and continue calling the displayed storage value an estimate.
