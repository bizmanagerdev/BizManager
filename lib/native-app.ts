// The website's half of the phone app (the APK), from version 1.1.0 on.
//
// The APK carries the abilities (permissions, Android's print screen, saving to
// Downloads, the opening screen, the back button); this file switches them on
// from the website, so they reach every phone without a new APK. Each part first
// asks whether the installed APK has the helper it needs
// (Capacitor.isPluginAvailable): phones still on APK 1.0.2 simply skip it.
//
// Like lib/native-share.ts, everything Capacitor is loaded with import() so
// nothing here reaches the server build or runs during SSR.

import { withSentry } from "@/lib/sentry-lazy";

/** The APK's own helper (android/app/src/main/java/com/bizh/app/BizHNativePlugin.java). */
type BizHNativePlugin = {
  splashReady(): Promise<void>;
  printPage(options: { name: string }): Promise<void>;
  saveDownload(options: {
    data: string;
    filename: string;
    mimeType: string;
    open?: boolean;
  }): Promise<{ uri: string; filename: string }>;
};

let started = false;

/**
 * Run once, on the first page the app shows. Everything is fire-and-forget: a
 * part that fails only loses that part, never the page.
 */
export async function startNativeAppBridge(): Promise<void> {
  if (started) return;
  started = true;

  let Capacitor: typeof import("@capacitor/core").Capacitor;
  let registerPlugin: typeof import("@capacitor/core").registerPlugin;
  try {
    ({ Capacitor, registerPlugin } = await import("@capacitor/core"));
  } catch {
    return;
  }
  if (!Capacitor.isNativePlatform()) return;

  // Both are in every APK from 1.1.0 on, so they're switched on together.
  if (Capacitor.isPluginAvailable("BizHNative") && Capacitor.isPluginAvailable("Printer")) {
    // One registration for the whole page (lib/native-fingerprint.ts may have made it).
    const bizh =
      ((window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor?.Plugins?.BizHNative as
        | BizHNativePlugin
        | undefined) ??
      registerPlugin<BizHNativePlugin>("BizHNative");
    tellOpeningScreenReady(bizh);
    installDownloads(bizh);
    void installPrinting(bizh);
  }
  if (Capacitor.isPluginAvailable("App")) {
    void installBackButton();
    void reportAppVersion();
  }
}

// ---------------------------------------------------------------- opening screen

/**
 * The app holds its opening screen (light blue, the chevrons) until the page has
 * drawn, so it goes straight from the opening screen to the page with no black
 * or white moment. Two frames after mount = the page is on screen.
 */
function tellOpeningScreenReady(bizh: BizHNativePlugin) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      bizh.splashReady().catch(() => {});
    })
  );
}

// ---------------------------------------------------------------- downloads

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

function reportFailure(where: string, error: unknown) {
  withSentry((Sentry) => Sentry.captureException(error, { tags: { native_app: where } }));
}

/**
 * Download and export buttons make a file in the page (a blob: or data: link with
 * a `download` name) and click it. A web view has nothing to catch that click, so
 * they did nothing in the app. Here the click is caught, the file read, and saved
 * to the phone's Downloads under its real name, then opened.
 *
 * Covers both kinds of click: a link the user taps, and the usual
 * `a.click()` on a link made in code (often never added to the page, so its
 * click never reaches document). Pages free the file right after clicking, so
 * freeing is delayed long enough for the file to be read first.
 */
function installDownloads(bizh: BizHNativePlugin) {
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = (url: string) => {
    window.setTimeout(() => revoke(url), 60_000);
  };

  const isFileLink = (a: HTMLAnchorElement) => a.hasAttribute("download") && /^(blob|data):/i.test(a.href);

  const save = async (href: string, name: string) => {
    try {
      const blob = await (await fetch(href)).blob();
      await bizh.saveDownload({
        data: await blobToBase64(blob),
        filename: name || "BizH-download",
        mimeType: blob.type || "application/octet-stream",
        open: true,
      });
    } catch (error) {
      reportFailure("download", error);
    }
  };

  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (isFileLink(this)) {
      void save(this.href, this.download);
      return;
    }
    return nativeClick.call(this);
  };

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      const link = target?.closest?.("a[download]") as HTMLAnchorElement | null;
      if (link && isFileLink(link)) {
        event.preventDefault();
        void save(link.href, link.download);
      }
    },
    true
  );
}

// ---------------------------------------------------------------- printing

/**
 * Print buttons did nothing in the app: a web view has no print dialog. Two kinds
 * of print button exist on the site:
 * - window.print() on the page itself → Android's print screen for the page
 *   (printer, or Save as PDF), with the page's own print styles, through the
 *   APK's own BizHNative.printPage (the printer plugin's printWebView fails on
 *   Android: it calls the web view off the main thread).
 * - a printable sheet written into a new window (window.open("") + document.write,
 *   e.g. the order and project sheets, the worker's monthly summary). In the app
 *   that "new window" would have been the app's own page, overwritten. Here it
 *   gets a stand-in window that collects what's written and prints exactly that.
 */
async function installPrinting(bizh: BizHNativePlugin) {
  let Printer: typeof import("@capgo/capacitor-printer").Printer;
  try {
    ({ Printer } = await import("@capgo/capacitor-printer"));
  } catch {
    return;
  }

  window.print = () => {
    bizh.printPage({ name: document.title || "BizH" }).catch((error) => reportFailure("print", error));
  };

  const nativeOpen = window.open.bind(window);
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const address = url === undefined ? "" : String(url);
    if (address === "" || address === "about:blank") return printWindow(Printer);
    return nativeOpen(url, target, features);
  }) as typeof window.open;
}

function printWindow(Printer: typeof import("@capgo/capacitor-printer").Printer): Window {
  let html = "";
  let printed = false;

  const print = () => {
    if (printed || !html) return;
    printed = true;
    // The sheet's own "print on load" script has nothing to run in here.
    const sheet = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    const title = /<title>([\s\S]*?)<\/title>/i.exec(sheet)?.[1]?.trim() || "BizH";
    Printer.printHtml({ html: sheet, name: title }).catch((error) => reportFailure("print", error));
  };

  const doc = {
    open: () => {
      html = "";
    },
    write: (...parts: string[]) => {
      html += parts.join("");
    },
    writeln: (...parts: string[]) => {
      html += parts.join("") + "\n";
    },
    // Writing is done: print. Callers that also call print() later get the same
    // single print job.
    close: () => {
      window.setTimeout(print, 0);
    },
    title: "",
  };

  const standIn = {
    document: doc,
    print,
    focus: () => {},
    blur: () => {},
    close: () => {},
    closed: false,
    onload: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: (fn: () => void, ms?: number) => window.setTimeout(fn, ms),
  };
  return standIn as unknown as Window;
}

// ---------------------------------------------------------------- back button

/**
 * The phone's back button closes what's open on top (a dialog, a sheet, a menu,
 * a dropdown) before it goes back a page, and only leaves the app from the first
 * page, where it puts the app in the background instead of closing it.
 * Every such layer in the app closes on Escape, so Back sends Escape.
 */
async function installBackButton() {
  let App: typeof import("@capacitor/app").App;
  try {
    ({ App } = await import("@capacitor/app"));
  } catch {
    return;
  }
  await App.addListener("backButton", ({ canGoBack }) => {
    if (closeTopLayer()) return;
    if (canGoBack) window.history.back();
    else void App.minimizeApp();
  });
}

const OPEN_LAYER = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
  "[data-radix-popper-content-wrapper]",
  "[data-vaul-drawer][data-state='open']",
].join(",");

function closeTopLayer(): boolean {
  if (!document.querySelector(OPEN_LAYER)) return false;
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true })
  );
  return true;
}

// ---------------------------------------------------------------- which APK

/** Each phone's APK version on its Sentry reports (support, and "who still needs the update"). */
async function reportAppVersion() {
  try {
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    withSentry((Sentry) => {
      Sentry.setTag("apk.version", info.version);
      Sentry.setTag("apk.build", info.build);
    });
  } catch {
    // Not available: nothing to tag.
  }
}

// ---------------------------------------------------------------- status bar

function parseRgb(color: string): [number, number, number, number] | null {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/i.exec(color);
  if (!match) return null;
  const alphaText = match[4];
  const alpha = alphaText === undefined ? 1 : alphaText.endsWith("%") ? parseFloat(alphaText) / 100 : parseFloat(alphaText);
  return [Number(match[1]), Number(match[2]), Number(match[3]), alpha];
}

const toHex = (n: number) => Math.round(n).toString(16).padStart(2, "0");

/**
 * The phone's status bar wears the colour of the page's own top bar (light blue
 * on the dashboard, navy on tasks, white elsewhere), with dark or light icons to
 * match, so the bar and the page read as one surface. Called on every page change.
 */
export async function syncNativeStatusBar(): Promise<void> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("StatusBar")) return;
    const { StatusBar, Style } = await import("@capacitor/status-bar");

    // After the new page has painted its bar.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const bar = document.querySelector("header") ?? document.body;
    const rgb = parseRgb(getComputedStyle(bar).backgroundColor);
    if (!rgb || rgb[3] < 0.5) return;
    const [r, g, b] = rgb;
    await StatusBar.setBackgroundColor({ color: `#${toHex(r)}${toHex(g)}${toHex(b)}` });
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    // Style.Light = dark icons, for a light bar; Style.Dark = light icons.
    await StatusBar.setStyle({ style: luminance > 0.6 ? Style.Light : Style.Dark });
  } catch {
    // An older APK or a page without a bar: leave the bar as it is.
  }
}
