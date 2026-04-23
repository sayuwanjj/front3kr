const CACHE_NAME = "taskflow-offline-v6";
const APP_SHELL = [
  "./",
  "./index.html",
  "./contacts.html",
  "./about.html",
  "./styles.css",
  "./app.js",
  "/socket.io/socket.io.js",
  "./manifest.json",
  "./icons/icon-96.png",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return networkResponse;
      });
    })
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const networkResponse = await fetch(request);
    cache.put(request, networkResponse.clone());
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    const fallbackPage = request.url.endsWith("/about.html")
      ? "./about.html"
      : request.url.endsWith("/contacts.html")
        ? "./contacts.html"
        : "./index.html";

    return caches.match(fallbackPage);
  }
}

self.addEventListener("push", (event) => {
  let data = { title: "TaskFlow Offline", body: "Появилось новое уведомление.", reminderId: null };
  if (event.data) {
    data = event.data.json();
  }

  const options = {
    body: data.body,
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-96.png",
    data: {
      url: data.url || "/index.html",
      reminderId: data.reminderId || null
    }
  };

  if (data.reminderId) {
    options.actions = [
      { action: "snooze", title: "Отложить на 5 минут" }
    ];
  }

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  const action = event.action;
  const reminderId = event.notification.data?.reminderId;
  const targetUrl = new URL(event.notification.data?.url || "/index.html", self.location.origin).href;

  if (action === "snooze" && reminderId) {
    event.waitUntil(
      fetch(`/snooze?reminderId=${reminderId}`, { method: "POST" })
        .then(() => event.notification.close())
        .catch((error) => console.error("Snooze failed:", error))
    );
    return;
  }

  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const existingClient = clientList.find((client) => client.url === targetUrl);

      if (existingClient) {
        return existingClient.focus();
      }

      return clients.openWindow(targetUrl);
    })
  );
});
