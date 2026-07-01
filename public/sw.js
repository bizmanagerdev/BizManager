const V = "v12";
const STATIC_CACHE = `bizh-static-${V}`;   // immutable _next/static chunks
const PAGES_CACHE  = `bizh-pages-${V}`;    // navigation responses
const API_CACHE    = `bizh-api-${V}`;      // /api GET responses
const ALL_CACHES   = [STATIC_CACHE, PAGES_CACHE, API_CACHE];

// Detect development environments. The SW must NEVER run on localhost / Vercel
// preview deployments — it caches stale Next.js dev chunks and HTML which
// causes chronic hydration mismatches. If we detect a dev host, self-destruct.
const IS_DEV_HOST =
  self.location.hostname === "localhost" ||
  self.location.hostname === "127.0.0.1" ||
  self.location.hostname.endsWith(".local") ||
  self.location.hostname.includes("vercel.app");

if (IS_DEV_HOST) {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        // Drop every cache this SW (or any prior version) ever created.
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        // Unregister self.
        await self.registration.unregister();
        // Force every controlled tab to reload from the network.
        const clients = await self.clients.matchAll();
        for (const client of clients) {
          if ("navigate" in client) {
            try { await client.navigate(client.url); } catch {}
          }
        }
      })()
    );
  });
  // Pass-through every fetch — never cache, never serve from cache.
  self.addEventListener("fetch", () => {});
  // Stop here — don't register any of the production handlers below.
} else {

const PRECACHE = [
  "/",
  "/dashboard",
  "/login",
  "/favicon.ico",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/manifest.webmanifest",
];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !ALL_CACHES.includes(k))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let payload = { title: "BizManager", body: "", url: "/alerts", tag: "bizh-alert" };
  if (event.data) {
    try {
      const data = event.data.json();
      payload = {
        title: data.title ?? payload.title,
        body: data.body ?? payload.body,
        url: data.url ?? payload.url,
        tag: data.tag ?? payload.tag,
      };
    } catch {
      payload.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      // Without renotify, a second notification that reuses the same tag
      // (e.g. a repeated test, or a daily alert of the same type) silently
      // updates the existing one — no banner, no sound — so it only appears
      // in the tray. renotify forces a fresh heads-up alert every time.
      renotify: true,
      // Keep the banner on screen until the user acts, instead of it flashing
      // by and dropping straight into the notification list.
      requireInteraction: true,
      vibrate: [200, 100, 200],
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      dir: "rtl",
      lang: "he",
      data: { url: payload.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data?.url ?? "/alerts");
  const absolute = url.startsWith("http") ? url : self.location.origin + url;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // Focus existing tab at the same origin if possible
        for (const client of windowClients) {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === self.location.origin && "focus" in client) {
            client.navigate(absolute);
            return client.focus();
          }
        }
        // Otherwise open a new tab
        if (self.clients.openWindow) {
          return self.clients.openWindow(absolute);
        }
      })
  );
});

// ── Background Sync (offline queue fallback) ──────────────────────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === "process-offline-queue") {
    event.waitUntil(
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clients) => {
          for (const client of clients) {
            client.postMessage({ type: "PROCESS_OFFLINE_QUEUE" });
          }
        })
    );
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function putInCache(cacheName, request, response) {
  if (!response.ok) return;
  // Clone synchronously — must happen before the response body starts being
  // consumed by the caller. Awaiting caches.open() first and cloning inside
  // the .then() runs after the page reads the body, throwing
  // "Response body is already used".
  const clone = response.clone();
  caches.open(cacheName).then((cache) => cache.put(request, clone)).catch(() => {});
}

const OFFLINE_HTML = `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>אין חיבור</title>
  <style>
    body{margin:0;min-height:100svh;display:grid;place-items:center;
         background:#F4F6FD;color:#1D2848;font:16px/1.6 system-ui,sans-serif}
    main{max-width:26rem;padding:2rem;text-align:center}
    h1{margin:0 0 .5rem;font-size:1.4rem}
    p{margin:0;color:#5E6FB8}
  </style>
</head>
<body>
  <main>
    <h1>אין חיבור לאינטרנט</h1>
    <p>הנתונים נשמרים ויסונכרנו כשהחיבור יחזור.</p>
  </main>
</body>
</html>`;

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 1. Next.js immutable chunks — always content-hashed, safe to cache forever
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((res) => {
            putInCache(STATIC_CACHE, request, res);
            return res;
          })
      )
    );
    return;
  }

  // 2. Other /_next/ assets (e.g. image optimization) — network-first, cache fallback
  if (url.pathname.startsWith("/_next/")) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          putInCache(STATIC_CACHE, request, res);
          return res;
        })
        .catch(() => caches.match(request))
        .then((res) => res ?? new Response("Offline", { status: 503 }))
    );
    return;
  }

  // 3. API — network-first; serve cached response when offline so UI keeps data
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          putInCache(API_CACHE, request, res);
          return res;
        })
        .catch(() => caches.match(request))
        .then(
          (res) =>
            res ??
            new Response(JSON.stringify({ error: "offline" }), {
              status: 503,
              headers: { "Content-Type": "application/json" },
            })
        )
    );
    return;
  }

  // 4. RSC payload refetches (router.refresh / soft navigation) — network-first.
  // These hit the same route URL with `RSC: 1` header or `_rsc=` query param.
  // Without this, the cache-first fallback (case 6) returns the stale page.
  const isRscRequest =
    request.headers.get("RSC") === "1" ||
    request.headers.get("Next-Router-State-Tree") !== null ||
    url.searchParams.has("_rsc");
  if (isRscRequest) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          putInCache(PAGES_CACHE, request, res);
          return res;
        })
        .catch(() => caches.match(request))
        .then((res) => res ?? new Response("Offline", { status: 503 }))
    );
    return;
  }

  // 5. Page navigations — network-first; cache each page so it reopens offline
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          putInCache(PAGES_CACHE, request, res);
          return res;
        })
        .catch(async () => {
          // Try the exact page, then dashboard, then login, then root
          const cached =
            (await caches.match(request)) ??
            (await caches.match("/dashboard")) ??
            (await caches.match("/login")) ??
            (await caches.match("/"));
          if (cached) return cached;
          return new Response(OFFLINE_HTML, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        })
    );
    return;
  }

  // 6. Everything else (icons, fonts, etc.) — cache-first
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((res) => {
          putInCache(STATIC_CACHE, request, res);
          return res;
        }).catch(() => new Response("Offline", { status: 503 }))
    )
  );
});

} // end of IS_DEV_HOST else (production branch)
