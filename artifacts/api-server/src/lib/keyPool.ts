import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "./firebaseAdmin";
import { logger } from "./logger";

export const KEY_POOL_PROVIDERS = [
  "agnes",
  "cloudflare",
  "glm",
  "magic_hour",
  "pollinations",
] as const;

export type KeyPoolProvider = (typeof KEY_POOL_PROVIDERS)[number];
export type CredentialState =
  | { state: "ready" }
  | { state: "cooldown" | "disabled"; until: number };

export type KeyPoolOutcome =
  | "ok"
  | "rate_limited"
  | "auth_failed"
  | "timeout"
  | "bad_prompt"
  | "network_error"
  | "provider_error"
  | "cooldown"
  | "disabled";

export type KeyPoolAttempt = {
  provider: KeyPoolProvider;
  index: number;
  outcome: KeyPoolOutcome;
};

export type KeyPoolErrorCode =
  | "bad_prompt"
  | "no_credentials"
  | "credentials_exhausted"
  | "state_unavailable"
  | "deadline_exceeded";

export type KeyPoolResult<T> =
  | { ok: true; value: T; attempts: KeyPoolAttempt[] }
  | {
      ok: false;
      code: KeyPoolErrorCode;
      message: string;
      attempts: KeyPoolAttempt[];
    };

export type PersistedCredentialState = Exclude<CredentialState, { state: "ready" }>;

export interface KeyPoolStateStore {
  read(provider: KeyPoolProvider, index: number): Promise<CredentialState | null>;
  write(
    provider: KeyPoolProvider,
    index: number,
    state: CredentialState,
  ): Promise<void>;
}

type CredentialForAttempt = {
  provider: KeyPoolProvider;
  index: number;
  apiKey?: string;
  accountId?: string;
};

type CredentialMetadata = {
  index: number;
  state: CredentialState["state"];
  until?: number;
};

export type KeyPoolProviderStatus = {
  provider: KeyPoolProvider;
  requiresKey: boolean;
  credentialCount: number;
  credentials: CredentialMetadata[];
  providerState?: CredentialState;
};

export type KeyPoolStatus = {
  providers: KeyPoolProviderStatus[];
};

export class KeyPoolHttpError extends Error {
  readonly status: number;
  readonly responseBody: string;
  readonly retryAfter?: string;

  constructor(status: number, responseBody = "", retryAfter?: string) {
    super("Provider request failed.");
    this.name = "KeyPoolHttpError";
    this.status = status;
    this.responseBody = responseBody;
    this.retryAfter = retryAfter;
  }
}

export type KeyPoolOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  stateStore?: KeyPoolStateStore;
  now?: () => number;
  totalDeadlineMs?: number;
  attemptTimeoutMs?: Partial<Record<KeyPoolProvider, number>>;
  onIncompleteCloudflarePair?: (provider: "cloudflare", index: number) => void;
};

const DEFAULT_TOTAL_DEADLINE_MS = 180_000;
const DEFAULT_ATTEMPT_TIMEOUT_MS: Record<KeyPoolProvider, number> = {
  agnes: 90_000,
  cloudflare: 45_000,
  glm: 90_000,
  magic_hour: 120_000,
  pollinations: 90_000,
};
const TRANSIENT_COOLDOWN_MS = 15_000;
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const DAILY_QUOTA_COOLDOWN_MS = 24 * 60 * 60 * 1_000;
const AUTH_DISABLED_MS = 30 * 24 * 60 * 60 * 1_000;
const PROVIDER_PREFIX: Partial<Record<KeyPoolProvider, string>> = {
  agnes: "AGNES_API_KEY",
  glm: "GLM_API_KEY",
  magic_hour: "MAGIC_HOUR_API_KEY",
};
const CLOUDFLARE_TOKEN_PREFIX = "CLOUDFLARE_API_TOKEN";
const CLOUDFLARE_ACCOUNT_PREFIX = "CLOUDFLARE_ACCOUNT_ID";
const DEADLINE = Symbol("key-pool-deadline");

class KeyPoolStateUnavailableError extends Error {
  constructor() {
    super("Credential state is unavailable.");
    this.name = "KeyPoolStateUnavailableError";
  }
}

function firestoreStateReference(provider: KeyPoolProvider, index: number) {
  return getFirebaseAdmin()
    .db.collection("_server")
    .doc("keyPool")
    .collection("providers")
    .doc(provider)
    .collection("credentials")
    .doc(String(index));
}

const firestoreStateStore: KeyPoolStateStore = {
  async read(provider, index) {
    const snapshot = await firestoreStateReference(provider, index).get();
    const data = snapshot.data();
    if (!snapshot.exists || !data) return null;
    if (
      (data.state === "cooldown" || data.state === "disabled") &&
      data.until instanceof Timestamp
    ) {
      return { state: data.state, until: data.until.toMillis() };
    }
    return data.state === "ready" ? { state: "ready" } : null;
  },
  async write(provider, index, state) {
    const stateDocument = firestoreStateReference(provider, index);
    await stateDocument.set(
      {
        state: state.state,
        until: state.state === "ready"
          ? FieldValue.delete()
          : Timestamp.fromMillis(state.until),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0
    ? Math.floor(value)
    : fallback;
}

function parseRetryAfter(value: string | undefined, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return now + Math.ceil(seconds * 1_000);
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(now, date) : null;
}

function errorDetails(error: unknown): {
  status: number | null;
  text: string;
  retryAfter: string | undefined;
  name: string;
} {
  const record = isRecord(error) ? error : {};
  const status =
    typeof record.status === "number"
      ? record.status
      : typeof record.statusCode === "number"
        ? record.statusCode
        : null;
  const message = error instanceof Error ? error.message : "";
  const responseBody =
    error instanceof KeyPoolHttpError
      ? error.responseBody
      : typeof record.responseBody === "string"
        ? record.responseBody
        : typeof record.body === "string"
          ? record.body
          : "";
  const retryAfter =
    error instanceof KeyPoolHttpError
      ? error.retryAfter
      : typeof record.retryAfter === "string"
        ? record.retryAfter
        : undefined;
  return {
    status,
    text: `${message} ${responseBody}`.toLowerCase(),
    retryAfter,
    name: error instanceof Error ? error.name : "",
  };
}

type FailureClassification = {
  outcome: KeyPoolOutcome;
  state?: CredentialState;
  stop: boolean;
  code?: KeyPoolErrorCode;
  message?: string;
};

function classifyFailure(
  error: unknown,
  now: number,
  timedOut: boolean,
): FailureClassification {
  const details = errorDetails(error);
  const authMessage =
    /\b(?:invalid|revoked|expired)\b.{0,35}\b(?:api\s*)?key\b/.test(details.text) ||
    /\b(?:api\s*)?key\b.{0,35}\b(?:invalid|revoked|expired)\b/.test(details.text) ||
    /\b(?:suspended|disabled)\s+account\b/.test(details.text);
  if (details.status === 401 || details.status === 403 || authMessage) {
    return {
      outcome: "auth_failed",
      state: { state: "disabled", until: now + AUTH_DISABLED_MS },
      stop: false,
    };
  }

  const dailyQuota =
    /\bdaily\b.{0,30}\b(?:quota|limit|usage)\b/.test(details.text) ||
    /\b(?:quota|limit|usage)\b.{0,30}\bdaily\b/.test(details.text);
  const rateLimited =
    details.status === 429 ||
    /\bquota exceeded\b|\brate[ -]?limit\b|\btoo many requests\b/.test(details.text);
  if (rateLimited) {
    const retryUntil = parseRetryAfter(details.retryAfter, now);
    const cooldownMs = dailyQuota ? DAILY_QUOTA_COOLDOWN_MS : RATE_LIMIT_COOLDOWN_MS;
    return {
      outcome: "rate_limited",
      state: { state: "cooldown", until: retryUntil ?? now + cooldownMs },
      stop: false,
    };
  }

  const promptRejected =
    details.status === 400 ||
    /\bprompt\b.{0,35}\b(?:reject|invalid|not allowed)\b/.test(details.text) ||
    /\bcontent\b.{0,35}\b(?:reject|policy|filter)\b/.test(details.text) ||
    /\bsafety filter\b/.test(details.text);
  if (promptRejected) {
    return {
      outcome: "bad_prompt",
      stop: true,
      code: "bad_prompt",
      message: "The prompt or content was rejected. Please revise it and try again.",
    };
  }

  if (timedOut || details.name === "AbortError" || details.name === "TimeoutError") {
    return {
      outcome: "timeout",
      state: { state: "cooldown", until: now + TRANSIENT_COOLDOWN_MS },
      stop: false,
    };
  }

  if (details.status !== null && details.status >= 500) {
    return {
      outcome: "provider_error",
      state: { state: "cooldown", until: now + TRANSIENT_COOLDOWN_MS },
      stop: false,
    };
  }

  return {
    outcome: details.status === null ? "network_error" : "provider_error",
    state: { state: "cooldown", until: now + TRANSIENT_COOLDOWN_MS },
    stop: false,
  };
}

function dataFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const value = env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sortedCredentials<T extends { index: number }>(credentials: T[]): T[] {
  return credentials.sort((left, right) => left.index - right.index);
}

export function createKeyPool(options: KeyPoolOptions = {}) {
  const env = options.env ?? process.env;
  const stateStore = options.stateStore ?? firestoreStateStore;
  const now = options.now ?? Date.now;
  const totalDeadlineMs = positiveInteger(
    options.totalDeadlineMs,
    DEFAULT_TOTAL_DEADLINE_MS,
  );
  const attemptTimeouts = {
    ...DEFAULT_ATTEMPT_TIMEOUT_MS,
    ...options.attemptTimeoutMs,
  };
  const stateCache = new Map<string, CredentialState>();
  const nextStartIndex = new Map<KeyPoolProvider, number>();
  const loggedIncompletePairs = new Set<number>();

  const stateKey = (provider: KeyPoolProvider, index: number) =>
    `${provider}#${index}`;
  const logIncompleteCloudflarePair =
    options.onIncompleteCloudflarePair ??
    ((provider: "cloudflare", index: number) => {
      logger.warn({ provider, index }, "Skipping an incomplete Cloudflare credential pair.");
    });

  function readCredentials(provider: KeyPoolProvider): CredentialForAttempt[] {
    if (provider === "pollinations") return [];
    if (provider === "cloudflare") {
      const credentials: CredentialForAttempt[] = [];
      const baseToken = dataFromEnvironment(env, CLOUDFLARE_TOKEN_PREFIX);
      const baseAccountId = dataFromEnvironment(env, CLOUDFLARE_ACCOUNT_PREFIX);
      if (baseToken && baseAccountId) {
        credentials.push({
          provider,
          index: 0,
          apiKey: baseToken,
          accountId: baseAccountId,
        });
      } else if (baseToken || baseAccountId) {
        if (!loggedIncompletePairs.has(0)) {
          loggedIncompletePairs.add(0);
          logIncompleteCloudflarePair("cloudflare", 0);
        }
      }

      const numberedIndexes = new Set<number>();
      const tokenPattern = /^CLOUDFLARE_API_TOKEN_([1-9]\d*)$/;
      const accountPattern = /^CLOUDFLARE_ACCOUNT_ID_([1-9]\d*)$/;
      for (const name of Object.keys(env)) {
        const match = name.match(tokenPattern) ?? name.match(accountPattern);
        if (match?.[1]) numberedIndexes.add(Number(match[1]));
      }
      for (const index of [...numberedIndexes].sort((left, right) => left - right)) {
        const token = dataFromEnvironment(env, `${CLOUDFLARE_TOKEN_PREFIX}_${index}`);
        const accountId = dataFromEnvironment(env, `${CLOUDFLARE_ACCOUNT_PREFIX}_${index}`);
        if (token && accountId) {
          credentials.push({ provider, index, apiKey: token, accountId });
        } else if (!loggedIncompletePairs.has(index)) {
          loggedIncompletePairs.add(index);
          logIncompleteCloudflarePair("cloudflare", index);
        }
      }
      return sortedCredentials(credentials);
    }

    const prefix = PROVIDER_PREFIX[provider];
    if (!prefix) return [];
    const credentials: CredentialForAttempt[] = [];
    const unnumberedKey = dataFromEnvironment(env, prefix);
    if (unnumberedKey) {
      credentials.push({ provider, index: 0, apiKey: unnumberedKey });
    }
    const numberedPattern = new RegExp(`^${prefix}_([1-9]\\d*)$`);
    for (const name of Object.keys(env)) {
      const match = name.match(numberedPattern);
      if (!match?.[1]) continue;
      const apiKey = dataFromEnvironment(env, name);
      if (apiKey) {
        credentials.push({
          provider,
          index: Number(match[1]),
          apiKey,
        });
      }
    }
    return sortedCredentials(credentials);
  }

  async function stateFor(
    provider: KeyPoolProvider,
    index: number,
  ): Promise<CredentialState> {
    const cached = stateCache.get(stateKey(provider, index));
    const cachedActive =
      cached && cached.state !== "ready" && cached.until > now()
        ? cached
        : null;
    try {
      const persisted = await stateStore.read(provider, index);
      const persistedActive =
        persisted && persisted.state !== "ready" && persisted.until > now()
          ? persisted
          : null;
      const normalized: CredentialState =
        cachedActive &&
        (!persistedActive || cachedActive.until >= persistedActive.until)
          ? cachedActive
          : persistedActive ?? { state: "ready" };
      stateCache.set(stateKey(provider, index), normalized);
      return normalized;
    } catch {
      if (cached && cached.state !== "ready" && cached.until > now()) return cached;
      logger.warn({ provider, index }, "Credential state could not be loaded.");
      throw new KeyPoolStateUnavailableError();
    }
  }

  async function saveState(
    provider: KeyPoolProvider,
    index: number,
    state: CredentialState,
  ): Promise<void> {
    stateCache.set(stateKey(provider, index), state);
    try {
      await stateStore.write(provider, index, state);
    } catch {
      logger.warn({ provider, index }, "Credential state could not be persisted.");
    }
  }

  async function waitForDeadline<T>(
    operation: Promise<T>,
    remainingMs: number,
  ): Promise<{ kind: "value"; value: T } | { kind: "deadline" }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation.then((value) => ({ kind: "value" as const, value })),
        new Promise<{ kind: "deadline" }>((resolve) => {
          timer = setTimeout(() => resolve({ kind: "deadline" }), remainingMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function readStatus(): Promise<KeyPoolStatus> {
    const providers = await Promise.all(
      KEY_POOL_PROVIDERS.map(async (provider): Promise<KeyPoolProviderStatus> => {
        if (provider === "pollinations") {
          return {
            provider,
            requiresKey: false,
            credentialCount: 0,
            credentials: [],
            providerState: await stateFor(provider, 0),
          };
        }
        const credentials = readCredentials(provider);
        const credentialStates = await Promise.all(
          credentials.map(async (credential): Promise<CredentialMetadata> => {
            const state = await stateFor(provider, credential.index);
            return {
              index: credential.index,
              state: state.state,
              ...(state.state === "ready" ? {} : { until: state.until }),
            };
          }),
        );
        return {
          provider,
          requiresKey: true,
          credentialCount: credentials.length,
          credentials: credentialStates,
        };
      }),
    );
    return { providers };
  }

  async function run<T>(
    provider: KeyPoolProvider,
    attempt: (
      credential: CredentialForAttempt,
      signal: AbortSignal,
    ) => Promise<T>,
    runOptions: { totalDeadlineMs?: number } = {},
  ): Promise<KeyPoolResult<T>> {
    const attempts: KeyPoolAttempt[] = [];
    const callStartedAt = now();
    const callDeadlineMs = positiveInteger(
      runOptions.totalDeadlineMs,
      totalDeadlineMs,
    );
    const callDeadlineAt = callStartedAt + callDeadlineMs;
    let deadlineReached = false;
    let activeController: AbortController | null = null;
    const totalTimer = setTimeout(() => {
      deadlineReached = true;
      activeController?.abort();
    }, callDeadlineMs);

    const failure = (
      code: KeyPoolErrorCode,
      message: string,
    ): KeyPoolResult<T> => ({
      ok: false,
      code,
      message,
      attempts: [...attempts],
    });

    try {
      const discovered = readCredentials(provider);
      const credentials: CredentialForAttempt[] =
        provider === "pollinations"
          ? [{ provider, index: 0 }]
          : discovered;
      if (credentials.length === 0) {
        return failure(
          "no_credentials",
          "No credentials are configured for this provider.",
        );
      }

      const cursor = nextStartIndex.get(provider) ?? 0;
      nextStartIndex.set(provider, cursor + 1);
      const start = cursor % credentials.length;
      const ordered = [
        ...credentials.slice(start),
        ...credentials.slice(0, start),
      ];

      for (const credential of ordered) {
        const remainingBeforeState = callDeadlineAt - now();
        if (remainingBeforeState <= 0 || deadlineReached) {
          return failure("deadline_exceeded", "The provider request timed out.");
        }
        let stateResult: Awaited<ReturnType<typeof stateFor>>;
        try {
          const stateLookup = await waitForDeadline(
            stateFor(provider, credential.index),
            remainingBeforeState,
          );
          if (stateLookup.kind === "deadline") {
            deadlineReached = true;
            return failure("deadline_exceeded", "The provider request timed out.");
          }
          stateResult = stateLookup.value;
        } catch {
          return failure(
            "state_unavailable",
            "Provider credentials are temporarily unavailable.",
          );
        }

        if (stateResult.state !== "ready") {
          attempts.push({
            provider,
            index: credential.index,
            outcome: stateResult.state,
          });
          continue;
        }

        const remainingForAttempt = callDeadlineAt - now();
        if (remainingForAttempt <= 0 || deadlineReached) {
          return failure("deadline_exceeded", "The provider request timed out.");
        }
        const timeoutMs = Math.min(
          positiveInteger(attemptTimeouts[provider], DEFAULT_ATTEMPT_TIMEOUT_MS[provider]),
          remainingForAttempt,
        );
        const controller = new AbortController();
        activeController = controller;
        let attemptTimedOut = false;
        let abortHandler: (() => void) | undefined;
        const abortPromise = new Promise<never>((_resolve, reject) => {
          abortHandler = () => reject(new Error("Provider attempt aborted."));
          if (controller.signal.aborted) abortHandler();
          else controller.signal.addEventListener("abort", abortHandler, { once: true });
        });
        const attemptTimer = setTimeout(() => {
          attemptTimedOut = true;
          controller.abort();
        }, timeoutMs);

        try {
          const value = await Promise.race([
            Promise.resolve().then(() => attempt(credential, controller.signal)),
            abortPromise,
          ]);
          attempts.push({ provider, index: credential.index, outcome: "ok" });
          return { ok: true, value, attempts: [...attempts] };
        } catch (error) {
          const classification = classifyFailure(
            error,
            now(),
            attemptTimedOut || deadlineReached,
          );
          attempts.push({
            provider,
            index: credential.index,
            outcome: classification.outcome,
          });
          if (classification.state) {
            const stateWrite = saveState(provider, credential.index, classification.state);
            const remainingForState = callDeadlineAt - now();
            if (remainingForState > 0 && !deadlineReached) {
              const saved = await waitForDeadline(stateWrite, remainingForState);
              if (saved.kind === "deadline") deadlineReached = true;
            } else {
              void stateWrite;
            }
          }
          if (classification.stop) {
            return failure(
              classification.code ?? "bad_prompt",
              classification.message ?? "The provider rejected the request.",
            );
          }
          if (deadlineReached || callDeadlineAt - now() <= 0) {
            return failure("deadline_exceeded", "The provider request timed out.");
          }
        } finally {
          clearTimeout(attemptTimer);
          if (abortHandler) {
            controller.signal.removeEventListener("abort", abortHandler);
          }
          if (activeController === controller) activeController = null;
        }
      }

      return failure(
        "credentials_exhausted",
        "No usable credentials are available for this provider.",
      );
    } finally {
      clearTimeout(totalTimer);
    }
  }

  return { run, readStatus };
}

export const keyPool = createKeyPool();
