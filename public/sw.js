// Cache version = the deploy's build id, passed in on the script URL by
// PwaRegistration (`/sw.js?v=<NEXT_PUBLIC_BUILD_ID>`). A changed script URL is a
// new service worker, so each deploy installs, activates, and purges every cache
// whose name doesn't carry the current version. Do NOT hardcode this again: a
// frozen version meant caches survived every deploy, and a device could end up
// serving stale HTML that referenced chunks the CDN had already dropped —
// the JS then never executed and the app came up blank with nothing logged.
// The fallback only applies if the query param is missing.
const V = new URL(self.location.href).searchParams.get("v") || "v13";
const STATIC_CACHE = `bizh-static-${V}`;   // immutable _next/static chunks
const PAGES_CACHE  = `bizh-pages-${V}`;    // navigation responses
const API_CACHE    = `bizh-api-${V}`;      // /api GET responses
const FRAMES_CACHE = `bizh-frames-${V}`;   // the device pages' frames (below)
const ALL_CACHES   = [STATIC_CACHE, PAGES_CACHE, API_CACHE, FRAMES_CACHE];

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
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // Per-entry, failure-tolerant. cache.addAll() rejects the whole batch if a
      // single URL 404s or errors, which fails the install — and a SW that never
      // installs never activates, so the OLD one keeps serving its stale caches
      // forever. Precaching is an optimisation; it must never block the purge.
      await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})));
      await self.skipWaiting();
    })()
  );
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Navigation preload: the browser starts a page's network request while
      // this worker is still waking up, instead of after. The phone puts the
      // worker to sleep between uses, so without it every app launch / full
      // page load waited for the worker to boot BEFORE the request even left.
      // The fetch handler below picks the response up from event.preloadResponse.
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch {
          // Unsupported or refused — navigations just fetch() as before.
        }
      }
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !ALL_CACHES.includes(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
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
        // Opt-in stickiness: only genuinely urgent alerts should sit on the
        // screen. Everything else behaves like WhatsApp — appears, then goes.
        requireInteraction: data.requireInteraction === true,
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
      // Auto-dismiss like a chat notification (a few seconds, then into the
      // tray) unless the SERVER marked this one urgent. On desktop, true here
      // means the banner never leaves until you click X — which is what felt
      // "stuck". Default false = WhatsApp behaviour.
      requireInteraction: payload.requireInteraction,
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
  // NEVER store a response that fetch() reached by following a redirect.
  // Handing one back for a navigation is a network error (see asNavigation
  // below), so caching it poisons that URL until the next version bump: every
  // later visit reads the redirect out of the cache and dies the same way,
  // offline or not.
  if (response.redirected) return;
  // Clone synchronously — must happen before the response body starts being
  // consumed by the caller. Awaiting caches.open() first and cloning inside
  // the .then() runs after the page reads the body, throwing
  // "Response body is already used".
  const clone = response.clone();
  caches.open(cacheName).then((cache) => cache.put(request, clone)).catch(() => {});
}

// caches.match() rejects if the Cache Storage backend is unavailable — evicted
// under storage pressure, corrupted, or blocked by the user's site settings. An
// unhandled rejection inside respondWith() is a dead tab ("This site can't be
// reached"), so every lookup degrades to "no cache entry" instead.
async function matchCache(request) {
  try {
    return (await caches.match(request)) ?? null;
  } catch {
    return null;
  }
}

// A navigation Request has redirect mode "manual" — the BROWSER is the only
// thing allowed to act on a redirect, so respondWith() rejects any response
// fetch() already followed:
//   "The FetchEvent for <url> resulted in a network error response: a
//    redirected response was used for a request whose redirect mode is not
//    follow"
// That is exactly what a signed-out (or spuriously signed-out) user hits:
// middleware answers /projects with a 307 to /login, fetch() follows it here,
// and the login page they were being sent to arrives as an unreachable-site
// screen — the offline fallback below never gets a chance to run. Re-issue it
// as a fresh redirect so the browser performs the navigation itself and the
// address bar lands on /login.
function asNavigation(response) {
  if (!response.redirected) return response;
  return Response.redirect(response.url, 302);
}

// How long a page navigation may wait on the network before we answer from
// cache instead. Deliberately shorter than lib/offline-queue.ts's 12s write
// timeout: this one is the PWA cold-launch path, and every second of it is a
// user staring at the splash screen.
const NAV_TIMEOUT_MS = 8000;

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

// ── The device pages' frames ─────────────────────────────────────────────────
// Pages drawn from the phone's own copy of the data (PowerSync — the
// dashboard, tasks, projects and sales for admins and office) come from the
// server as a frame: the layout and an empty page the phone fills in. That
// frame is saved and the app opens on it AT ONCE, instead of waiting a second
// for the server; the page then refreshes its server parts itself
// (components/powersync/DeviceFrameMark). Only a response that IS such a frame
// is saved — it carries data-device-page — never a page with the data in it,
// a search, or the server version (?data=server). Cleared on every deploy
// (versioned name), at logout and when someone else signs in
// (lib/powersync/device-frames.ts).
const FRAME_PATHS = new Set(["/dashboard", "/tasks", "/projects", "/sales"]);
const FRAME_MARK = 'data-device-page="';
// A saved frame older than this is replaced in the background when used.
const FRAME_REFRESH_AFTER_MS = 60 * 60 * 1000;

function isFrameRequest(url) {
  return FRAME_PATHS.has(url.pathname) && !url.searchParams.has("data") && !url.searchParams.has("q");
}

async function matchFrame(request) {
  try {
    return (await (await caches.open(FRAMES_CACHE)).match(request)) ?? null;
  } catch {
    return null;
  }
}

// `response` must be a copy nobody else reads.
async function saveFrame(request, response) {
  try {
    const cache = await caches.open(FRAMES_CACHE);
    if (!response || !response.ok || response.redirected || response.type === "opaqueredirect") {
      await cache.delete(request);
      return;
    }
    const html = await response.text();
    if (!html.includes(FRAME_MARK)) {
      await cache.delete(request);
      return;
    }
    await cache.put(
      request,
      new Response(html, {
        headers: {
          "Content-Type": response.headers.get("Content-Type") || "text/html; charset=utf-8",
          "X-Bizh-Frame-Saved": String(Date.now()),
        },
      })
    );
  } catch {
    // Not saved — the next open just waits for the server, as before.
  }
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 1. Next.js immutable chunks — always content-hashed, safe to cache forever
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      matchCache(request).then(
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
        .catch(() => matchCache(request))
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
        .catch(() => matchCache(request))
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
        .catch(() => matchCache(request))
        .then((res) => res ?? new Response("Offline", { status: 503 }))
    );
    return;
  }

  // 5. Page navigations — network-first, but ALWAYS bounded by a timeout.
  //
  // A plain .catch() fallback is not enough. On a half-open mobile connection
  // (carrier dead spot, captive portal black-holing traffic) fetch() neither
  // resolves NOR rejects — so respondWith() never settles, the navigation never
  // completes, and the PWA sits on its splash screen indefinitely with nothing
  // logged anywhere. Racing a timer guarantees the launch always gets an answer:
  // the real page, the last cached one, or the Hebrew offline page.
  if (request.mode === "navigate") {
    const frame = isFrameRequest(url);
    event.respondWith(
      (async () => {
        // A device page with a saved frame: that, at once (see above).
        if (frame) {
          const saved = await matchFrame(request);
          if (saved) {
            const savedAt = Number(saved.headers.get("X-Bizh-Frame-Saved") || 0);
            const preloaded = Promise.resolve(event.preloadResponse).catch(() => undefined);
            event.waitUntil(
              Date.now() - savedAt > FRAME_REFRESH_AFTER_MS
                ? preloaded
                    .then((res) => res || fetch(request))
                    .then((res) => saveFrame(request, res))
                    .catch(() => {})
                : preloaded
            );
            return saved;
          }
        }

        // The request the browser already started while this worker booted
        // (navigation preload, enabled on activate) — or, where that isn't
        // available, a fresh one. A preloaded redirect arrives unfollowed
        // (opaqueredirect): not ok, so putInCache skips it, and the browser
        // follows it itself.
        const network = Promise.resolve(event.preloadResponse)
          // A failed preload gets one ordinary fetch() before the cache fallback.
          .catch(() => undefined)
          .then((preloaded) => preloaded || fetch(request))
          .then((res) => {
            putInCache(PAGES_CACHE, request, res);
            // A device page's frame, for next time (or a stale one dropped).
            // Best effort: on a timed-out launch the event may be over by now.
            if (frame) {
              const saving = saveFrame(request, res.clone());
              try {
                event.waitUntil(saving);
              } catch {
                // Still runs; the worker may just not wait for it.
              }
            }
            return res;
          });

        let res = null;
        try {
          res = await Promise.race([
            network,
            new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS)),
          ]);
        } catch {
          res = null; // network rejected outright — fall through to cache
        }
        if (res) return asNavigation(res);

        // Timed out: leave the request in flight so a merely-slow network still
        // warms PAGES_CACHE for the next launch, but stop waiting on it here.
        network.catch(() => {});

        // Try the exact page, then dashboard, then login, then root
        const cached =
          (await matchCache(request)) ??
          (await matchCache("/dashboard")) ??
          (await matchCache("/login")) ??
          (await matchCache("/"));
        // Entries cached before putInCache learned to reject redirects can still
        // carry the flag, so this goes through asNavigation() too.
        if (cached) return asNavigation(cached);
        return new Response(OFFLINE_HTML, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      })()
    );
    return;
  }

  // 6. Everything else (icons, fonts, etc.) — cache-first
  event.respondWith(
    matchCache(request).then(
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
