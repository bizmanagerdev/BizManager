import net from "node:net";
import { expect, type Locator, type Page } from "@playwright/test";

// What the two offline tests share (offline-pages.spec.ts: a device whose copy
// of the data isn't ready; offline-device-copy.spec.ts: one whose copy syncs).

/** The app's server, and the switch in front of it the browser goes through (playwright.config.ts: bizh.test:3100). */
const SERVER_PORT = 3000;
const SWITCH_PORT = 3100;

/**
 * The server, behind a switch: off, every connection is cut at once — the
 * server doesn't answer, whatever the device says. The browser's own offline
 * switch (setOffline) is the device saying so; this is the network itself,
 * the service worker's requests included.
 */
export function serverSwitch() {
  let answering = true;
  const open = new Set<net.Socket>();
  const server = net.createServer((client) => {
    if (!answering) {
      client.destroy();
      return;
    }
    const upstream = net.connect(SERVER_PORT, "127.0.0.1");
    open.add(client);
    const close = () => {
      open.delete(client);
      client.destroy();
      upstream.destroy();
    };
    client.on("error", close).on("close", close);
    upstream.on("error", close).on("close", close);
    client.pipe(upstream).pipe(client);
  });
  return {
    start: () => new Promise<void>((resolve) => server.listen(SWITCH_PORT, "127.0.0.1", resolve)),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
    set: (on: boolean) => {
      answering = on;
      if (!on) for (const socket of open) socket.destroy();
    },
  };
}

/** The red bar's text (components/layout/OfflineBanner) — not the yellow saved-copy one ("אין חיבור לשרת"). */
export const RED_BAR = /^אין חיבור(?: לאינטרנט)? — /;
export const SAVED_COPY_NOTICE = "מוצגת הגרסה השמורה במכשיר"; // components/layout/SavedCopyNotice
/** A page with no data on the device says so in its place (components/pwa/OfflinePageGate). */
const NOT_ON_DEVICE = "הדף הזה לא זמין בלי חיבור";
/** A page that broke: the app's error screens, and the service worker's own "no connection" page. */
const BROKEN_PAGE_HEADINGS = ["אירעה תקלה בטעינת הדף", "אירעה שגיאה", "אין חיבור לאינטרנט"];

/**
 * Runs in every page: notes each time the red bar shows or goes, every 50 ms,
 * so a bar that came and went between two checks is still seen (owner,
 * 2026-10-27: "these bars appear then disappear then reappear").
 */
export function watchRedBar() {
  const log: { at: number; on: boolean }[] = [];
  (window as unknown as { __redBar: typeof log }).__redBar = log;
  // And the page's errors, for a failure's "On screen" (describeScreen).
  const errors: string[] = [];
  (window as unknown as { __pageErrors: string[] }).__pageErrors = errors;
  window.addEventListener("error", (event) => errors.push(String(event.message)));
  window.addEventListener("unhandledrejection", (event) =>
    errors.push(String((event.reason as { message?: string } | undefined)?.message ?? event.reason))
  );
  // Next.js says on the console when a page's data request failed ("Failed to
  // fetch RSC payload … Falling back to browser navigation").
  const consoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    errors.push(args.map((arg) => String((arg as { message?: string } | null)?.message ?? arg)).join(" ").slice(0, 200));
    consoleError(...args);
  };
  // Every change of address in the history — the app's and Next.js's own
  // (Next.js wraps these later, so its calls come through here too).
  const addresses: string[] = [];
  (window as unknown as { __addresses: string[] }).__addresses = addresses;
  for (const name of ["pushState", "replaceState"] as const) {
    const original = history[name].bind(history);
    history[name] = (state: unknown, unused: string, url?: string | URL | null) => {
      const internal = (state as { __NA?: unknown } | null)?.__NA ? " (Next.js)" : "";
      addresses.push(`${Math.round(performance.now())} ${name} ${String(url ?? "")}${internal}`);
      return original(state, unused, url);
    };
  }
  // And what the service worker tells the page (PAGE_NOT_SAVED and the rest).
  const told: string[] = [];
  (window as unknown as { __swTold: string[] }).__swTold = told;
  navigator.serviceWorker?.addEventListener("message", (event) => {
    const data = event.data as { type?: string; url?: string } | null;
    told.push(`${data?.type ?? "?"} ${data?.url ?? ""}`.trim());
  });
  let last: boolean | null = null;
  setInterval(() => {
    const on = Array.from(document.querySelectorAll("span")).some(
      (el) => /^אין חיבור(?: לאינטרנט)? — /.test(el.textContent ?? "") && el.getClientRects().length > 0
    );
    if (on === last) return;
    last = on;
    log.push({ at: Math.round(performance.now()), on });
  }, 50);
}

export function menuLink(page: Page, name: string) {
  return page.locator("aside nav").getByRole("link", { name });
}

/**
 * The app has taken over the link (React has hydrated it). A page just loaded
 * whole shows its links before that, and a click then is a plain browser load,
 * not a move inside the app — what a person a moment later never gets.
 */
export async function expectHydrated(link: Locator) {
  await expect
    .poll(() => link.evaluate((el) => Object.keys(el).some((key) => key.startsWith("__reactProps$"))), {
      message: "the page never became interactive",
    })
    .toBe(true);
}

/** What's on screen, for a failure's message: the address, the page's start, and any loading placeholders. */
export function describeScreen(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    return JSON.stringify({
      url: location.pathname + location.search,
      history: history.length,
      saved: document.documentElement.hasAttribute("data-bizh-saved"),
      devicePage: document.querySelector("[data-device-page]")?.getAttribute("data-device-page") ?? null,
      skeletons: document.querySelectorAll("[data-skeleton], [data-route-loading], [aria-busy='true']").length,
      toasts: Array.from(document.querySelectorAll("[data-sonner-toast]")).map((el) => el.textContent?.trim()),
      // Next.js's own entry in the history (missing: an entry it didn't make).
      routerState: Object.keys((history.state as Record<string, unknown> | null) ?? {}),
      errors: ((window as unknown as { __pageErrors?: string[] }).__pageErrors ?? []).slice(-5),
      swTold: ((window as unknown as { __swTold?: string[] }).__swTold ?? []).slice(-5),
      addresses: ((window as unknown as { __addresses?: string[] }).__addresses ?? []).slice(-8),
      // The app's own notes on what went wrong offline (lib/pwa/offline-report.ts).
      notes: (() => {
        try {
          return (JSON.parse(localStorage.getItem("bizh-offline-report") ?? "[]") as { what?: string; url?: string }[])
            .slice(-3)
            .map((note) => `${note.what} ${note.url ?? ""}`);
        } catch {
          return [];
        }
      })(),
      main: main ? (main.innerText ?? "").replace(/\s+/g, " ").slice(0, 200) : null,
    });
  });
}

/**
 * Click, and wait for `path` — loaded whole, or moved to inside the page: a
 * device page the app already holds (prefetched, drawn from the copy) needs
 * nothing from the network, and a saved page's data can come from the device.
 */
export async function moveTo(page: Page, link: Locator, path: string) {
  await expectHydrated(link);
  await link.click();
  // Watching the address, not waiting for a load: a page not on the device
  // gets there after the browser's own load was stopped (the service worker
  // answers it with nothing), which page.waitForURL takes for a failure.
  try {
    await expect(page).toHaveURL((url) => url.pathname === path, { timeout: 30_000 });
  } catch (error) {
    throw new Error(`${(error as Error).message}\nOn screen: ${await describeScreen(page)}`);
  }
}

/**
 * A page with no data on the device, moved to with no connection: it opens and
 * says so in its place — never an empty page that looks like there's nothing
 * there — with the menu and one red bar, so the next page is a tap away
 * (owner, 2026-10-28: "Spotify style").
 */
export async function expectOpensNotOnDevice(page: Page, link: Locator, path: string) {
  await moveTo(page, link, path);
  try {
    await expect(page.getByText(NOT_ON_DEVICE)).toBeVisible();
  } catch (error) {
    throw new Error(`${(error as Error).message}\nOn screen: ${await describeScreen(page)}`);
  }
  await expectOpen(page, path);
  await expectSteadyRedBar(page);
}

export async function expectNotBroken(page: Page) {
  for (const name of BROKEN_PAGE_HEADINGS) {
    await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0);
  }
}

export async function expectOpen(page: Page, path: string) {
  try {
    await expect(page).toHaveURL((url) => url.pathname === path);
  } catch (error) {
    throw new Error(`${(error as Error).message}\nOn screen: ${await describeScreen(page)}`);
  }
  await expect(page.locator("main")).toBeVisible();
  await expectNotBroken(page);
}

/** One red bar, no second (saved-copy) bar, and the red one never gone since it first showed on this page. */
export async function expectSteadyRedBar(page: Page) {
  await expect(page.getByText(RED_BAR).filter({ visible: true })).toHaveCount(1);
  await expect(page.getByText(SAVED_COPY_NOTICE).filter({ visible: true })).toHaveCount(0);
  const redBarLog = () =>
    page.evaluate(() => (window as unknown as { __redBar?: { at: number; on: boolean }[] }).__redBar ?? []);
  // A page that has just loaded (from the device, say) notes it on the watch's first round.
  await expect
    .poll(async () => (await redBarLog()).some((entry) => entry.on), { message: "the red bar never showed", timeout: 5_000 })
    .toBe(true);
  const log = await redBarLog();
  const shown = log.findIndex((entry) => entry.on);
  expect(
    log.slice(shown).every((entry) => entry.on),
    `the red bar went and came back on ${page.url()}: ${JSON.stringify(log)}`
  ).toBe(true);
}

/**
 * Addresses this device keeps in one of the service worker's caches —
 * bizh-pages-<build> (pages saved whole) or bizh-frames-<build> (the device
 * pages' frames) — as path and query.
 */
export function savedAddresses(page: Page, kind: "pages" | "frames") {
  return page.evaluate(async (kind) => {
    const addresses: string[] = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith(`bizh-${kind}-`)) continue;
      for (const request of await (await caches.open(name)).keys()) {
        const url = new URL(request.url);
        if (!url.searchParams.has("_rsc")) addresses.push(url.pathname + url.search);
      }
    }
    return addresses;
  }, kind);
}

/** The build the service worker serves (its ?v=). */
export function workerBuild(page: Page) {
  return page.evaluate(() => new URL(navigator.serviceWorker.controller!.scriptURL).searchParams.get("v") ?? "");
}

/** Done: every file on the build's list is on the device (public/sw.js marks it only then). */
export function appCodeSaved(page: Page, build: string) {
  return page.evaluate(async (build) => {
    const cache = await caches.open(`bizh-static-${build}`);
    return Boolean(await cache.match(`${location.origin}/__bizh-app-code-${build}`));
  }, build);
}
