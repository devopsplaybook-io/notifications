self.addEventListener("push", (event) => {
  if (!event.data) {
    return;
  }

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "Notification", body: event.data.text() };
  }

  const options = {
    body: data.body || "",
    icon: "/icon.png",
    badge: "/badge.png",
    data: {
      url: data.url || "/",
      notificationData: data.data || {},
    },
    tag: data.id || "notification",
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "Notification", options),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        const target = new URL(
          event.notification.data?.url || "/",
          self.location.origin,
        );
        if (target.origin !== self.location.origin) {
          target.href = new URL("/", self.location.origin).href;
        }
        for (const client of clientList) {
          const clientUrl = new URL(client.url);
          if (
            clientUrl.origin === self.location.origin &&
            (clientUrl.pathname === target.pathname ||
              (target.pathname === "/" && clientUrl.pathname === "/index.html"))
          ) {
            if (clientUrl.href !== target.href) {
              return client.navigate(target.href).then(() => client.focus());
            }
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(target.href);
        }
      }),
  );
});
