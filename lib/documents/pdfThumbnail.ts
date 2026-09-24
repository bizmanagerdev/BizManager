// ────────────────────────────────────────────────────────────────────────────
// First-page thumbnails for PDFs.
//
// A PDF tile used to be a grey file glyph, which tells you nothing — in an
// archive where most tiles ARE pictures, the documents were the only things you
// could not recognise at a glance.
//
// There is no server-side rendering step here, so the page is drawn in the
// browser with pdfjs (already a dependency). That makes restraint the whole
// design: each file is fetched and decoded once per session, at most a couple at
// a time, and only for tiles that are actually on screen.
// ────────────────────────────────────────────────────────────────────────────

export type ThumbnailRenderer = (url: string, maxWidth: number) => Promise<string>;

export type ThumbnailCache = {
  /** The finished thumbnail, if this key has one. Never starts work. */
  peek: (key: string) => string | null;
  /** The thumbnail, rendering it if needed. Concurrent callers share one render. */
  request: (key: string, url: string, maxWidth: number) => Promise<string>;
  /** Tests only. */
  inFlightCount: () => number;
};

/**
 * Renders on demand, once per key, no more than `maxConcurrent` at a time.
 *
 * The cache is keyed by DOCUMENT, not by url: a signed url is re-minted on every
 * page load and expires within the hour, so keying on it would re-render
 * everything after each refresh and never hit.
 */
export function createThumbnailCache(
  render: ThumbnailRenderer,
  maxConcurrent = 2
): ThumbnailCache {
  const done = new Map<string, string>();
  const inflight = new Map<string, Promise<string>>();
  const waiting: Array<() => void> = [];
  let active = 0;

  function release() {
    active -= 1;
    const next = waiting.shift();
    if (next) next();
  }

  function acquire(): Promise<void> {
    if (active < maxConcurrent) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      waiting.push(() => {
        active += 1;
        resolve();
      });
    });
  }

  return {
    peek: (key) => done.get(key) ?? null,
    inFlightCount: () => inflight.size,
    request(key, url, maxWidth) {
      const ready = done.get(key);
      if (ready) return Promise.resolve(ready);
      const running = inflight.get(key);
      if (running) return running;

      const task = (async () => {
        await acquire();
        try {
          const result = await render(url, maxWidth);
          done.set(key, result);
          return result;
        } finally {
          release();
          inflight.delete(key);
        }
      })();
      inflight.set(key, task);
      return task;
    },
  };
}

/** Draws page 1 to a canvas and returns it as a data URL. Browser only. */
export const renderPdfFirstPage: ThumbnailRenderer = async (url, maxWidth) => {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const loadingTask = pdfjs.getDocument({ url });
  const doc = await loadingTask.promise;
  try {
    const page = await doc.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    // Twice the CSS width, so the thumbnail is not soft on a retina screen —
    // and no more than that, because this is a 11rem tile, not a reader.
    const viewport = page.getViewport({ scale: (maxWidth * 2) / natural.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    // PDFs are transparent where they are white; without this the thumbnail
    // comes out black-on-black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    // No manual transform here: the scale is already baked into the viewport,
    // and composing a second one is what flipped the full viewer's page.
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.75);
  } finally {
    // The worker and its network requests hang around otherwise, and a gallery
    // of PDFs would leave one per tile.
    void loadingTask.destroy();
  }
};

/** The one cache the archive shares, so scrolling back does not re-render. */
export const pdfThumbnails = createThumbnailCache(renderPdfFirstPage);
