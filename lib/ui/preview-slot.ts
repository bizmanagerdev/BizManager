// What a list already knows about a row, handed to the row's own page for the
// moment between the tap and the page's data arriving, so that page's loading
// screen can draw its header from it instead of grey bars (see
// useRoutePreview and RouteOpeningOverlay).
//
// One slot per kind, kept briefly: it only has to last from the tap to the
// page. It is written only from a click handler, so on the server it is always
// empty.

// Long enough for a slow phone network; short enough that a later visit to
// the same page from somewhere else never gets an outdated header.
export const PREVIEW_FRESH_MS = 30_000;

export type PreviewSlot<T extends { id: string }> = {
  remember: (preview: T) => void;
  /** The preview for `id` if it's the latest one and still fresh, else null. */
  read: (id: string) => T | null;
  /** The page has arrived — its own header is on screen now. */
  forget: (id: string) => void;
};

export function createPreviewSlot<T extends { id: string }>(): PreviewSlot<T> {
  let latest: { preview: T; at: number } | null = null;
  return {
    remember(preview) {
      latest = { preview, at: Date.now() };
    },
    read(id) {
      if (typeof window === "undefined" || !latest) return null;
      if (latest.preview.id !== id || Date.now() - latest.at > PREVIEW_FRESH_MS) return null;
      return latest.preview;
    },
    forget(id) {
      if (latest?.preview.id === id) latest = null;
    },
  };
}

/** `row[key]` when it's a non-blank string, else null. */
export function previewText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
