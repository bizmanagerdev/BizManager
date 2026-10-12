// Saving a stored file under its own name — the documents' הורדה (owner,
// 2026-10-12: "wherever there is a doc I want a download option and a view
// option"). Used by components/ui/document-tile.tsx.
//
// The files live in Supabase Storage behind signed links on another origin, so
// an <a download> alone does nothing for them: a browser ignores the attribute
// across origins and opens the file instead. Storage answers a `download=<name>`
// on the link with `Content-Disposition: attachment; filename*=UTF-8''<name>`
// (checked 2026-10-12, Hebrew names included), which makes the browser save it
// — straight from Storage, never through the page's memory.
//
// The Android app is the exception: the shell sends any link to another site to
// the phone's browser (Capacitor's navigation rule), so there the file is
// fetched (Storage allows any origin) and handed to the app's own save — the
// same blob link every other download in the app makes, which lib/native-app.ts
// catches and saves to Downloads under its name, then opens.

/** Characters a file name cannot carry, including the ones Windows refuses. */
const UNSAFE_NAME = /[\\/:*?"<>|\u0000-\u001f]/g;

/** A name every file system takes; NFC so the Hebrew reads right where it lands. */
export function safeFileName(name: string | null | undefined, fallback = "BizH-file"): string {
  const cleaned = (name ?? "").replace(UNSAFE_NAME, " ").replace(/\s+/g, " ").trim();
  return (cleaned || fallback).normalize("NFC");
}

/**
 * The name a file is saved under: its own name, made safe. A name with no type
 * of its own ("צילום הצ׳ק", a title) borrows the stored file's from the link —
 * Storage keys keep the extension — so the phone still knows how to open it.
 */
export function downloadNameFor(name: string | null | undefined, url: string | null | undefined): string {
  const safe = safeFileName(name);
  if (/\.[a-z0-9]{1,8}$/i.test(safe) || !url) return safe;
  const extension = /\.([a-z0-9]{1,8})$/i.exec(url.split(/[?#]/)[0] ?? "");
  return extension ? `${safe}.${extension[1].toLowerCase()}` : safe;
}

/** A Supabase Storage object link (signed, public or authenticated). */
export function isStorageUrl(url: string): boolean {
  return /\/storage\/v1\/object\/(sign|public|authenticated)\//.test(url);
}

/**
 * The link that SAVES the file instead of opening it. A Storage link gets
 * `download=<name>` (replacing one it may already carry); anything else is
 * returned as it is, for the `download` attribute to handle (same-origin and
 * blob: links).
 */
export function fileDownloadHref(url: string, fileName: string): string {
  if (!isStorageUrl(url)) return url;
  const hashAt = url.indexOf("#");
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const [path, query = ""] = base.split("?");
  const params = query
    .split("&")
    .filter((part) => part && !/^download(=|$)/.test(part));
  // encodeURIComponent, not URLSearchParams: that writes a space as "+", and the
  // name must come back exactly as it was.
  params.push(`download=${encodeURIComponent(safeFileName(fileName))}`);
  return `${path}?${params.join("&")}${hash}`;
}

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
};

/**
 * True inside the Android app from APK 1.1.0 on — the APKs whose own save
 * (BizHNative.saveDownload) lib/native-app.ts switches on. Synchronous on
 * purpose: a click has to decide on the spot whether to keep its default.
 * An older APK answers false and keeps the link, which its phone's browser saves.
 */
export function canSaveInApp(): boolean {
  if (typeof window === "undefined") return false;
  const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  try {
    return Boolean(capacitor?.isNativePlatform?.() && capacitor?.isPluginAvailable?.("BizHNative"));
  } catch {
    return false;
  }
}

/** The app's way: fetch the file and click a blob link, which lib/native-app.ts saves. */
export async function saveFileInApp(url: string, fileName: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = safeFileName(fileName);
  link.click();
  // native-app.ts reads the file after the click; it also delays any revoke.
  window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

/**
 * Save the file, from code (a menu item has no link of its own to follow): the
 * app's own save inside the Android app, the browser's download everywhere else.
 */
export async function downloadFile(url: string, fileName: string): Promise<void> {
  if (canSaveInApp()) {
    await saveFileInApp(url, fileName);
    return;
  }
  const link = document.createElement("a");
  link.href = fileDownloadHref(url, fileName);
  link.download = safeFileName(fileName);
  link.rel = "noopener";
  const target = downloadLinkTarget(url);
  if (target) link.target = target;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Where a download link opens. A link to another site that isn't Storage can't
 * be told to save — at worst it opens, and then in a tab of its own rather than
 * in place of the app. Read from the string alone, so the server and the
 * browser draw the same link.
 */
export function downloadLinkTarget(url: string): "_blank" | undefined {
  return /^https?:\/\//i.test(url) && !isStorageUrl(url) ? "_blank" : undefined;
}
