import app from "./app";
import { logger } from "./lib/logger";
import { getFirebaseAdmin } from "./lib/firebaseAdmin";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

void (async () => {
  try {
    const { db } = getFirebaseAdmin();
    await db.doc("_yfactory/preflight").get();
    logger.info("Firebase Admin Firestore preflight passed.");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown Firebase Admin error.";
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : undefined;
    logger.error({ code, reason }, "Firebase Admin preflight failed.");
  }
})();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
