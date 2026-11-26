/* YFactory AI Service Worker — Real OS Notifications & Push Ready */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "YFactory AI",
    body: "Your task is ready!",
    section: "image",
    tag: "yfactory-push",
  };
  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === "object") {
        payload = {
          title: typeof parsed.title === "string" ? parsed.title : payload.title,
          body: typeof parsed.body === "string" ? parsed.body : payload.body,
          section: typeof parsed.section === "string" ? parsed.section : payload.section,
          tag: typeof parsed.tag === "string" ? parsed.tag : payload.tag,
        };
      }
    } catch {
      const txt = event.data.text();
      if (txt) payload.body = txt;
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "./icon-192.png?v=3",
      badge: "./icon-192.png?v=3",
      vibrate: [140, 60, 140],
      tag: payload.tag,
      renotify: true,
      data: { section: payload.section, url: "./" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetSection = typeof data.section === "string" ? data.section : null;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            if (targetSection) {
              client.postMessage({
                type: "yfactory:navigate",
                section: targetSection,
              });
            }
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow("./");
        }
        return undefined;
      }),
  );
});