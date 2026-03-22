// ECD Intelligence Platform — Service Worker
// Provides offline-first caching for the PWA

const CACHE_NAME = "ecd-platform-v1";
const DATA_CACHE = "ecd-data-v1";

// App shell files to cache on install
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// ─── Install: Pre-cache app shell ────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

// ─── Activate: Clean old caches ──────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== DATA_CACHE)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// ─── Fetch: Network-first for API, cache-first for assets ───────────────────

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API requests: network-first, fall back to cache
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache GET responses for offline fallback
          if (event.request.method === "GET" && response.ok) {
            const clone = response.clone();
            caches.open(DATA_CACHE).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return new Response(
              JSON.stringify({ error: "offline", message: "No network connection" }),
              {
                status: 503,
                headers: { "Content-Type": "application/json" },
              }
            );
          });
        })
    );
    return;
  }

  // Static data files: stale-while-revalidate
  if (url.pathname.startsWith("/data/")) {
    event.respondWith(
      caches.open(DATA_CACHE).then((cache) => {
        return cache.match(event.request).then((cached) => {
          const fetchPromise = fetch(event.request)
            .then((response) => {
              if (response.ok) {
                cache.put(event.request, response.clone());
              }
              return response;
            })
            .catch(() => cached);

          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  // App shell and assets: cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cache successful asset loads
        if (response.ok && event.request.method === "GET") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    })
  );
});

// ─── Background Sync ─────────────────────────────────────────────────────────

self.addEventListener("sync", (event) => {
  if (event.tag === "ecd-sync") {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: "TRIGGER_SYNC" });
        });
      })
    );
  }
});

// ─── Push Notifications ──────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || "New alert from ECD Platform",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    vibrate: [200, 100, 200],
    tag: data.tag || "ecd-alert",
    data: {
      url: data.url || "/",
      alert_id: data.alert_id,
    },
    actions: [
      { action: "view", title: "View" },
      { action: "dismiss", title: "Dismiss" },
    ],
  };

  event.waitUntil(self.registration.showNotification(data.title || "ECD Alert", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") return;

  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      // Focus existing window if available
      for (const client of clients) {
        if (client.url.includes(url) && "focus" in client) {
          return client.focus();
        }
      }
      // Open new window
      return self.clients.openWindow(url);
    })
  );
});
