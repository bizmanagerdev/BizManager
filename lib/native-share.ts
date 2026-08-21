// Native sharing for the Capacitor shell (the APK). The WebView's own
// navigator.share is unreliable there — it can report as absent, or "succeed"
// without actually opening anything — even though the device itself shares
// fine everywhere else (user, 2026-08-22: "share is supported on this phone,
// I can show you"). @capacitor/share talks to Android's real share sheet
// directly, bypassing the WebView's implementation entirely.
//
// Both plugins are pulled in with dynamic import() so nothing here is bundled
// into the server build or evaluated during SSR — see lib/native-push.ts.

export type NativeShareResult = "shared" | "cancelled" | "unavailable";

/** True only inside the real Capacitor shell (the APK). False in every browser. */
export async function isNativePlatform(): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.onload = () => {
      // "data:image/png;base64,AAAA..." — Filesystem.writeFile wants the bare
      // base64 payload, not the data URL prefix.
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Share an image via Android's native share sheet — the same one every other
 * app on the phone uses, so the person sharing picks WhatsApp / email /
 * whatever themselves. Writes the blob to the app's cache dir first (Share
 * needs a file URI, not a raw blob) and cleans it up after.
 */
export async function shareImageNative(
  blob: Blob,
  fileName: string,
  title: string
): Promise<NativeShareResult> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return "unavailable";

    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");

    const base64 = await blobToBase64(blob);
    await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache });
    const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });

    try {
      await Share.share({ title, files: [uri] });
      return "shared";
    } finally {
      // Best-effort cleanup — a leftover cache file is harmless, but don't let
      // a share flow accumulate them forever.
      await Filesystem.deleteFile({ path: fileName, directory: Directory.Cache }).catch(() => {});
    }
  } catch (error: unknown) {
    // The user backing out of the OS share sheet throws too — that's a
    // cancel, not a failure, and callers shouldn't fall back to anything else
    // for it (same convention as navigator.share's AbortError elsewhere).
    if (error instanceof Error && /cancel/i.test(error.message)) return "cancelled";
    return "unavailable";
  }
}
