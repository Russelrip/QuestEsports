self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  event.waitUntil(self.registration.showNotification(data.title || "Quest E-sports", {
    body: data.body || "You have a new match update.",
    icon: "/images/logo.png",
    badge: "/images/logo.png",
    tag: data.tag || "quest-match-update",
    data: { url: data.url || "/profile" },
  }));
});

const normalizeSameOriginPath = (value) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || !normalized.startsWith("/") || normalized.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(normalized)) return null;

  try {
    const parsed = new URL(normalized, self.location.origin);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.origin !== self.location.origin
    ) return null;

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
};

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = normalizeSameOriginPath(event.notification.data?.url);
  if (!path) return;
  const url = new URL(path, self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url === url);
    return existing ? existing.focus() : clients.openWindow(url);
  }));
});
