---
name: Firebase account deletion
description: Safe ordering and recovery for deleting both a Firestore user document and Firebase Auth identity.
---

When removing an authenticated user's Firestore document and Firebase Auth identity, capture the full document, delete the Firestore record first, then call Firebase `deleteUser(user)`. If Auth deletion fails, restore the exact prior document before reporting failure.

**Why:** Firestore and Firebase Auth cannot be committed atomically; Auth deletion can fail (for example, when recent sign-in is required) after the Firestore document has already been removed.

**How to apply:** Use this recovery pattern for account-deletion flows that span both services, and keep the failure visible so the user can retry or reauthenticate.
