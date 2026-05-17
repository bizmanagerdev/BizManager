const CACHE_NAME = "bizh-pwa-v5";
const APP_ASSETS = [
  "/favicon.ico",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

// When the browser brings us back online (Background Sync API), tell the active
// client to process its localStorage queue. The SW cannot access localStorage
// directly, so it posts a message to the page instead.
self.addEventListener("sync", (event) => {
  if (event.tag === "process-offline-queue") {
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: "PROCESS_OFFLINE_QUEUE" });
        }
      })
    );
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Let Next.js assets and API responses come from the network so deploys
  // show up immediately and dynamic data does not get stuck in cache.
  if (url.pathname.startsWith("/_next/") || url.pathname.startsWith("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(async () => {
          return new Response(
            `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Offline</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f8fafc;
        color: #0f172a;
        font: 16px/1.5 system-ui, sans-serif;
      }
      main {
        max-width: 28rem;
        padding: 2rem;
        text-align: center;
      }
      h1 {
        margin: 0 0 0.75rem;
        color: #0f766e;
        font-size: 1.5rem;
      }
      p {
        margin: 0;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>You're offline</h1>
      <p>Reconnect to continue using BizH projects.</p>
    </main>
  </body>
</html>`,
            {
              headers: {
                "Content-Type": "text/html; charset=utf-8",
              },
            }
          );
        })
    );
    return;
  }

  if (APP_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;

        return fetch(request).then((response) => {
          if (!response.ok) return response;

          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    (async () => {
      try {
        return await fetch(request);
      } catch {
        return new Response("Offline", {
          status: 503,
          statusText: "Offline",
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
          },
        });
      }
    })()
  );
});
