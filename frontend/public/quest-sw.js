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

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/profile", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url === url);
    return existing ? existing.focus() : clients.openWindow(url);
  }));
});
