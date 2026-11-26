/* YFactory AI Real System Notifications (Android PWA + Desktop via Service Worker) */

const NOTIF_PREF_KEY = "yfactory.notifications.enabled";

export type NotificationUiState = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  enabled: boolean;
};

let swRegPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerYFactoryServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }
  if (!swRegPromise) {
    swRegPromise = navigator.serviceWorker
      .register("./sw.js", { scope: "./" })
      .then(async (reg) => {
        try {
          await navigator.serviceWorker.ready;
        } catch {
          // Keep registered worker even if ready waits.
        }
        return reg;
      })
      .catch(() => null);
  }
  return swRegPromise;
}

export function isNotificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function readNotificationsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(NOTIF_PREF_KEY);
    if (raw === "false") return false;
    if (raw === "true") return true;
  } catch {
    // ignore storage errors
  }
  return isNotificationsSupported() && Notification.permission === "granted";
}

export function writeNotificationsEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NOTIF_PREF_KEY, enabled ? "true" : "false");
  } catch {
    // ignore storage errors
  }
}

export function getNotificationUiState(): NotificationUiState {
  if (!isNotificationsSupported()) {
    return { supported: false, permission: "unsupported", enabled: false };
  }
  const permission = Notification.permission;
  return {
    supported: true,
    permission,
    enabled: permission === "granted" && readNotificationsEnabled(),
  };
}

export async function requestYFactoryNotifications(
  locale = "en",
): Promise<NotificationUiState> {
  if (!isNotificationsSupported()) {
    return { supported: false, permission: "unsupported", enabled: false };
  }

  let permission: NotificationPermission = Notification.permission;
  if (permission !== "granted") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = Notification.permission;
    }
  }

  if (permission === "granted") {
    writeNotificationsEnabled(true);
    await registerYFactoryServiceWorker();
    const isAr = locale.startsWith("ar");
    await sendYFactoryNotification(
      "YFactory AI",
      isAr
        ? "تم تفعيل الإشعارات بنجاح! سننبهك فور اكتمال الصور والقصص والفيديو والامتحانات."
        : "Notifications enabled! We will alert you when images, stories, videos, or exams finish.",
      { tag: "yfactory-notif-enabled", force: true },
    );
  } else {
    writeNotificationsEnabled(false);
  }

  return getNotificationUiState();
}

export function disableYFactoryNotifications(): NotificationUiState {
  writeNotificationsEnabled(false);
  return getNotificationUiState();
}

function playSoftCompletionChime(): void {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.14);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.29);
    window.setTimeout(() => void ctx.close().catch(() => undefined), 400);
  } catch {
    // Audio chime is optional; silently ignore autoplay blocks.
  }
}

export async function sendYFactoryNotification(
  title: string,
  body: string,
  options?: {
    section?: "image" | "chat" | "stories" | "code" | "video" | "students";
    tag?: string;
    force?: boolean;
  },
): Promise<boolean> {
  if (!isNotificationsSupported()) return false;
  if (Notification.permission !== "granted") return false;
  if (!options?.force && !readNotificationsEnabled()) return false;

  const notifOptions: NotificationOptions & {
    vibrate?: number[];
    renotify?: boolean;
  } = {
    body,
    icon: "./icon-192.png?v=5",
    badge: "./icon-192.png?v=5",
    tag: options?.tag ?? `yfactory-${Date.now()}`,
    renotify: true,
    vibrate: [140, 60, 140],
    data: { section: options?.section ?? "image", url: "./" },
  };

  if (typeof document !== "undefined" && document.visibilityState === "visible") {
    playSoftCompletionChime();
  }

  try {
    const reg =
      (await registerYFactoryServiceWorker()) ??
      ("serviceWorker" in navigator
        ? await navigator.serviceWorker.getRegistration("./")
        : null);
    if (reg && typeof reg.showNotification === "function") {
      await reg.showNotification(title, notifOptions);
      return true;
    }
  } catch {
    // Fall back to direct Notification constructor on desktop browsers.
  }

  try {
    new Notification(title, notifOptions);
    return true;
  } catch {
    return false;
  }
}