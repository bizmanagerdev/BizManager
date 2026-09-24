"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";

// ────────────────────────────────────────────────────────────────────────────
// A PDF, shown in our own chrome.
//
// The browser's built-in viewer was rendering the file's STORAGE KEY as its
// title — a UUID, across the top of the document, every time. It also brings its
// own toolbar in its own language and its own direction, which on an RTL page
// reads as a piece of some other application.
//
// So: pdfjs renders the page to a canvas and we draw the controls. pdfjs is
// already a dependency (the statement importer reads text with it); the import
// stays dynamic so nothing is pulled into the server bundle.
// ────────────────────────────────────────────────────────────────────────────

type PdfModule = typeof import("pdfjs-dist");
type PdfLoadingTask = ReturnType<PdfModule["getDocument"]>;
type PdfDocumentHandle = Awaited<PdfLoadingTask["promise"]>;

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

export default function PdfViewer({ url, className }: { url: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const holderRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<PdfDocumentHandle | null>(null);
  // Destroying the DOCUMENT is not a thing; destroying the task that loaded it
  // is what shuts down the worker and its requests.
  const taskRef = useRef<PdfLoadingTask | null>(null);

  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);
  /** Null until the user picks a zoom: until then the page follows the width. */
  const [manualScale, setManualScale] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load the document once per url.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPage(1);
    setManualScale(null);

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();
        const task = pdfjs.getDocument({ url });
        const loaded = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        taskRef.current = task;
        docRef.current = loaded;
        setPageCount(loaded.numPages);
        setLoading(false);
      } catch {
        if (!cancelled) {
          setError("לא ניתן להציג את הקובץ.");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      const task = taskRef.current;
      taskRef.current = null;
      docRef.current = null;
      if (task) void task.destroy();
    };
  }, [url]);

  const draw = useCallback(async () => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    const holder = holderRef.current;
    if (!doc || !canvas || !holder) return;
    try {
      const pdfPage = await doc.getPage(page);
      const natural = pdfPage.getViewport({ scale: 1 });
      // Fit-to-width is the default because a document read on a phone is
      // unreadable at any other starting zoom.
      const fitWidth = (holder.clientWidth - 16) / natural.width;
      const effective = manualScale ?? fitWidth;
      const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, effective));
      setScale(clamped);

      const viewport = pdfPage.getViewport({ scale: clamped });
      const context = canvas.getContext("2d");
      if (!context) return;
      // Render at device resolution, present at CSS size — otherwise text is
      // soft on every phone and most laptops.
      const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      // The scale goes to pdfjs as a TRANSFORM, not through setTransform on the
      // context. pdfjs composes it with its own matrix — which carries the flip
      // from the PDF's bottom-up coordinates — so setting one ourselves fought
      // with that and drew the page upside down until a resize happened to
      // reset the context.
      await pdfPage.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      }).promise;
    } catch {
      // A render cancelled by the next one is normal; a real failure shows as
      // the empty canvas, which the surrounding chrome already explains.
    }
  }, [page, manualScale]);

  useEffect(() => {
    void draw();
  }, [draw, pageCount]);

  // Re-fit while the user has not chosen a zoom of their own.
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (manualScale === null) void draw();
    });
    observer.observe(holder);
    return () => observer.disconnect();
  }, [draw, manualScale]);

  const zoom = (factor: number) =>
    setManualScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor)));

  return (
    <div className={`flex min-h-0 flex-col ${className ?? ""}`}>
      <div className="flex flex-wrap items-center gap-1.5 border-b px-2 py-1.5 text-xs">
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-7 w-7"
          aria-label="הקטנה"
          title="הקטנה"
          disabled={loading || scale <= MIN_SCALE}
          onClick={() => zoom(1 / 1.25)}
        >
          −
        </Button>
        <span className="w-12 text-center tabular-nums text-muted-foreground">
          {Math.round(scale * 100)}%
        </span>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-7 w-7"
          aria-label="הגדלה"
          title="הגדלה"
          disabled={loading || scale >= MAX_SCALE}
          onClick={() => zoom(1.25)}
        >
          +
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7"
          disabled={loading}
          onClick={() => setManualScale(null)}
        >
          התאמה לרוחב
        </Button>

        {pageCount > 1 ? (
          <div className="ms-auto flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-7 w-7"
              aria-label="העמוד הקודם"
              title="הקודם"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
            <span className="tabular-nums text-muted-foreground">
              {page} / {pageCount}
            </span>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-7 w-7"
              aria-label="העמוד הבא"
              title="הבא"
              disabled={page >= pageCount}
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
      </div>

      <div ref={holderRef} className="min-h-0 flex-1 overflow-auto bg-muted/30 p-2">
        {error ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{error}</p>
        ) : (
          <canvas ref={canvasRef} className="mx-auto block rounded bg-background shadow-sm" />
        )}
      </div>
    </div>
  );
}
