export type AppTheme = 'dark' | 'light';

export type NotificationAvailability = 'supported' | 'denied' | 'unsupported';

const THEME_STORAGE_KEY = 'yfactory.theme';
const NOTIFICATIONS_STORAGE_KEY = 'yfactory.notifications.enabled';
export const THEME_CHANGE_EVENT = 'yfactory:theme-changed';

export function readAppTheme(): AppTheme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Fallback to dark theme.
  }
  return 'dark';
}

export function applyAppTheme(theme: AppTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
}

export function writeAppTheme(theme: AppTheme): void {
  applyAppTheme(theme);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Keep in-memory theme for this session.
  }
  window.dispatchEvent(new CustomEvent<AppTheme>(THEME_CHANGE_EVENT, { detail: theme }));
}

export function getNotificationAvailability(): NotificationAvailability {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  if (window.Notification.permission === 'denied') {
    return 'denied';
  }
  return 'supported';
}

export function readNotificationsEnabled(): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  if (window.Notification.permission !== 'granted') {
    return false;
  }
  try {
    return window.localStorage.getItem(NOTIFICATIONS_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export async function toggleAppNotifications(
  nextEnabled: boolean,
  confirmationCopy: { title: string; body: string },
): Promise<{ enabled: boolean; status: NotificationAvailability }> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { enabled: false, status: 'unsupported' };
  }

  if (!nextEnabled) {
    try {
      window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, 'false');
    } catch {
      // ignore
    }
    return { enabled: false, status: getNotificationAvailability() };
  }

  let permission = window.Notification.permission;
  if (permission === 'default') {
    try {
      permission = await window.Notification.requestPermission();
    } catch {
      return { enabled: false, status: 'unsupported' };
    }
  }

  if (permission !== 'granted') {
    try {
      window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, 'false');
    } catch {
      // ignore
    }
    return {
      enabled: false,
      status: permission === 'denied' ? 'denied' : 'supported',
    };
  }

  try {
    window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, 'true');
  } catch {
    // ignore
  }

  try {
    new window.Notification(confirmationCopy.title, {
      body: confirmationCopy.body,
      icon: '/favicon.svg',
    });
  } catch {
    // Mobile browsers may require service worker for direct Notification ctor.
  }

  return { enabled: true, status: 'supported' };
}

export function notifyUserIfEnabled(title: string, body: string): void {
  if (!readNotificationsEnabled()) return;
  try {
    new window.Notification(title, {
      body,
      icon: '/favicon.svg',
    });
  } catch {
    // Non-fatal on browsers restricting Notification constructor.
  }
}
