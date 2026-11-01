---
name: Archiver module loading
description: Archiver v8's runtime module shape when loaded from the API server.
---

For Archiver v8, `createRequire(...)(“archiver”)` returns a module namespace with named exports rather than the legacy callable factory. Instantiate its `ZipArchive` export.

**Why:** The legacy factory call throws a `TypeError` before ZIP asset fetching, so a download can fail even when Cloudinary images are accessible.

**How to apply:** When changing Archiver versions or its import style, inspect the installed runtime exports and construct the matching archive class.
