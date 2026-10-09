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
      // The previous version's saved pages (and the code they run) stay, as an
      // offline-only fallback: a phone that loses its connection right after an
      // update still has its pages to open. Never served while the network
      // answers; anything older goes.
      const keys = await caches.keys();
      const previous = previousVersion(keys);
      await carryFramesOver(previous);
      await Promise.all(
        keys
          .filter((k) => !ALL_CACHES.includes(k) && !(previous && versionOf(k) === previous))
          .map((k) => caches.delete(k))
      );
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

// ── Code files across deploys ────────────────────────────────────────────────
// With Vercel's Skew Protection every /_next/static address carries the
// deployment's id (?dpl=…), which changes on every deploy — keyed on the full
// address, each deploy downloaded every file again, the unchanged ones too.
// A file's name is its content hash, so its path alone is the key; the fetch
// keeps the ?dpl= so a miss still reaches the deployment that has the file.
function staticKey(url) {
  return url.origin + url.pathname;
}

/**
 * A code file from this version's cache, else from an earlier version's (or
 * an entry saved under its full address before) — then kept in this
 * version's too, so a file still in use outlives the next deploy's purge.
 */
async function cachedStatic(key, request) {
  const own = await matchIn(STATIC_CACHE, key);
  if (own) return own;
  const earlier = (await matchCache(key)) ?? (await matchCache(request));
  if (earlier) putInCache(STATIC_CACHE, key, earlier);
  return earlier;
}

/** The build a page is (its <meta name="bizh-build">, app/layout.tsx), or null. */
function buildOf(html) {
  const match = /<meta name="bizh-build" content="([^"]*)"/.exec(html);
  return match && match[1] ? match[1] : null;
}

const AHEAD_MAX_FILES = 150;
const AHEAD_AT_ONCE = 4;
const CODE_FILE = /\.(?:js|css|woff2?|ttf|png|svg|jpg|webp|ico|json)$/;

/**
 * A newer build's page, saved for the next opening: the code it loads is
 * fetched now, so that opening finds it on the phone instead of downloading
 * it cold (half of the slow "first opening after a deploy"). Not on data
 * saver; best effort — whatever isn't fetched loads as before.
 */
async function fetchAhead(html) {
  try {
    const connection = self.navigator && self.navigator.connection;
    if (connection && connection.saveData) return;
    const files = new Map();
    // In attributes, and in the page's inline data where quotes are escaped
    // (\"/_next/static/…\") — the backslash ends the address.
    for (const match of html.matchAll(/\/_next\/static\/[^"'\s\\)<>]+/g)) {
      const url = new URL(match[0].replace(/&amp;/g, "&"), self.location.origin);
      if (!CODE_FILE.test(url.pathname)) continue;
      files.set(staticKey(url), url.href);
      if (files.size >= AHEAD_MAX_FILES) break;
    }
    const missing = [];
    for (const [key, href] of files) {
      if (!(await matchCache(key))) missing.push([key, href]);
    }
    const cache = await caches.open(STATIC_CACHE);
    let next = 0;
    const worker = async () => {
      while (next < missing.length) {
        const [key, href] = missing[next++];
        try {
          const res = await fetch(href);
          if (res.ok) await cache.put(key, res);
        } catch {
          // Loads when the page asks for it.
        }
      }
    };
    await Promise.all(Array.from({ length: AHEAD_AT_ONCE }, worker));
  } catch {
    // Nothing fetched ahead — the next opening downloads it, as before.
  }
}

/**
 * A new version starts with the previous version's saved pages that are
 * already ITS build (the background refresh saved them there after the
 * deploy), so the opening after an update is still instant — and the
 * address "/" still goes straight to the dashboard. Never another build's
 * page: it would register its own (older) worker again.
 */
async function carryFramesOver(previous) {
  if (!previous) return;
  try {
    const name = `bizh-frames-${previous}`;
    if (!(await caches.has(name))) return;
    const from = await caches.open(name);
    const to = await caches.open(FRAMES_CACHE);
    for (const request of await from.keys()) {
      const response = await from.match(request);
      if (response && response.headers.get("X-Bizh-Build") === V && !(await to.match(request))) {
        await to.put(request, response);
      }
    }
  } catch {
    // Not carried — the first opening after the update waits for the server.
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
// With a saved copy of the page on the device, a connection that hangs (the
// phone thinks it's online, nothing answers — a worker in the field, 2026-10-07)
// gets that copy after this long instead of a blank screen; the copy says
// it's a saved one and reloads itself once the server answers.
const SAVED_COPY_AFTER_MS = 3000;

/** "v123" from "bizh-pages-v123" — null for caches that aren't the app's. */
function versionOf(cacheName) {
  const match = /^bizh-(?:static|pages|api|frames)-(.+)$/.exec(cacheName);
  return match ? match[1] : null;
}

/** The most recent version before this one that still has caches (cache names come in the order they were made). */
function previousVersion(cacheNames) {
  let previous = null;
  for (const name of cacheNames) {
    const version = versionOf(name);
    if (version && version !== V) previous = version;
  }
  return previous;
}

async function matchIn(cacheName, request) {
  try {
    return (await (await caches.open(cacheName)).match(request)) ?? null;
  } catch {
    return null;
  }
}

/**
 * The page's saved copy, for when the network doesn't answer: this version's
 * (its frame, then the page as last loaded), then the previous version's.
 */
async function savedCopyFor(request, frame) {
  const names = [];
  if (frame) names.push(FRAMES_CACHE);
  names.push(PAGES_CACHE);
  const previous = previousVersion(await caches.keys().catch(() => []));
  if (previous) {
    if (frame) names.push(`bizh-frames-${previous}`);
    names.push(`bizh-pages-${previous}`);
  }
  for (const name of names) {
    const hit = await matchIn(name, request);
    if (hit) return hit;
  }
  return null;
}

/** Somewhere to land when this page has no saved copy: the dashboard, the login page, the start page. */
async function savedLandingPage() {
  const previous = previousVersion(await caches.keys().catch(() => []));
  const kinds = ["frames", "pages", "static"];
  const versions = previous ? [V, previous] : [V];
  for (const path of ["/dashboard", "/login", "/"]) {
    for (const version of versions) {
      for (const kind of kinds) {
        const hit = await matchIn(`bizh-${kind}-${version}`, path);
        if (hit) return hit;
      }
    }
  }
  return null;
}

/**
 * A saved copy served because the network didn't answer, marked as such on
 * its <html> (data-bizh-saved = when it was saved) — the page then says it's
 * a saved copy and reloads itself once the server answers
 * (components/layout/SavedCopyNotice).
 */
async function markedSaved(response) {
  try {
    const html = await response.clone().text();
    const savedAt =
      Number(response.headers.get("X-Bizh-Frame-Saved")) || Date.parse(response.headers.get("date") || "") || 0;
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new Response(html.replace(/<html\b/i, `<html data-bizh-saved="${savedAt}"`), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
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
    <p style="margin-top:1rem"><button onclick="location.reload()" style="font:inherit;padding:.5rem 1.25rem;border-radius:.75rem;border:0;background:#1D2848;color:#fff">נסה שוב</button></p>
  </main>
  <script>
    // Back by itself the moment the server answers.
    setInterval(function () {
      fetch("/api/ping", { cache: "no-store" }).then(function () { location.reload(); }, function () {});
    }, 5000);
  </script>
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
// A navigation to a frame this soon after one was served is a reload — the
// page found a newer version on the server, or the person pulled to refresh
// — so it gets the frame saved since (the newer version) or the network,
// never the same old frame again (which would keep an old version running).
const FRAME_RELOAD_WINDOW_MS = 20 * 1000;
// When each URL's frame was last served (this worker's lifetime is enough).
const frameServedAt = new Map();

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

// `response` must be a copy nobody else reads. `ahead`: a page of a newer build
// than this worker's (a deploy since) has its code fetched now (fetchAhead) —
// only from the background refresh, never while the page itself is loading it.
async function saveFrame(request, response, { ahead = false } = {}) {
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
    const build = buildOf(html);
    const headers = {
      "Content-Type": response.headers.get("Content-Type") || "text/html; charset=utf-8",
      "X-Bizh-Frame-Saved": String(Date.now()),
    };
    if (build) headers["X-Bizh-Build"] = build;
    await cache.put(request, new Response(html, { headers }));
    if (ahead && build && build !== V) await fetchAhead(html);
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
  // "Is the server answering?" — only the network can say.
  if (url.pathname === "/api/ping") return;

  // 1. Next.js immutable chunks — always content-hashed, safe to cache forever
  // (keyed on the path, without the deployment's ?dpl= — staticKey above).
  if (url.pathname.startsWith("/_next/static/")) {
    const key = staticKey(url);
    event.respondWith(
      cachedStatic(key, request).then(
        (cached) =>
          cached ??
          fetch(request).then((res) => {
            putInCache(STATIC_CACHE, key, res);
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
        // This version's copy only — another version's payload doesn't fit
        // the code that's running.
        .catch(() => matchIn(PAGES_CACHE, request))
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
        // The site's bare address — where the Android app opens. With the
        // dashboard's frame saved (frames are kept only while someone is
        // signed in), straight there: otherwise the server sends it on to
        // /login and then /dashboard, two trips before anything shows.
        if (url.pathname === "/" && !url.search) {
          const dashboard = new URL("/dashboard", url).href;
          if (await matchFrame(dashboard)) return Response.redirect(dashboard, 302);
        }

        // A device page with a saved frame: that, at once (see above) — and
        // a fresh copy saved in the background for next time, so a frame is
        // never more than one opening old (a new version arrives on the next
        // opening, or on the reload the page does when it finds one).
        if (frame) {
          const saved = await matchFrame(request);
          const savedAt = saved ? Number(saved.headers.get("X-Bizh-Frame-Saved") || 0) : 0;
          const servedAt = frameServedAt.get(request.url) ?? 0;
          const isReload = Date.now() - servedAt < FRAME_RELOAD_WINDOW_MS && savedAt <= servedAt;
          if (saved && !isReload) {
            frameServedAt.set(request.url, Date.now());
            event.waitUntil(
              Promise.resolve(event.preloadResponse)
                .catch(() => undefined)
                .then((res) => res || fetch(request))
                .then((res) => saveFrame(request, res, { ahead: true }))
                .catch(() => {})
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

        // With a saved copy to fall back on, a hanging connection is given
        // less time before the copy shows (SAVED_COPY_AFTER_MS).
        const saved = await savedCopyFor(request, frame);
        let res = null;
        try {
          res = await Promise.race([
            network,
            new Promise((resolve) => setTimeout(() => resolve(null), saved ? SAVED_COPY_AFTER_MS : NAV_TIMEOUT_MS)),
          ]);
        } catch {
          res = null; // network rejected outright — fall through to cache
        }
        if (res) return asNavigation(res);

        // Timed out: leave the request in flight so a merely-slow network still
        // warms PAGES_CACHE for the next launch, but stop waiting on it here.
        network.catch(() => {});

        // This page's saved copy (a device page's frame first — the phone fills
        // it from its own copy), else somewhere to land; marked as a saved copy.
        // Entries cached before putInCache learned to reject redirects can still
        // carry the flag, so those go through asNavigation() instead.
        const fallback = saved ?? (await savedLandingPage());
        if (fallback) return fallback.redirected ? asNavigation(fallback) : markedSaved(fallback);
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
