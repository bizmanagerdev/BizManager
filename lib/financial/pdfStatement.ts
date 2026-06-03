// Client-only PDF text extraction for the statement importer. pdfjs is loaded lazily
// (dynamic import) so this module is safe to import from a client component without
// pulling pdfjs into the server bundle.

export type PdfExtractResult = {
  lines: string[];
  pageCount: number;
  hasText: boolean; // false for scanned/image-only PDFs (no text layer) → must use Claude
};

// Reconstruct text lines from a PDF's text layer by bucketing glyph runs by their
// y-position and ordering each row left→right. Good enough to feed the line heuristic;
// genuinely messy layouts fall through to the Claude parser.
export async function extractPdfLines(file: File): Promise<PdfExtractResult> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;
  const lines: string[] = [];

  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = (content.items as Array<{ str?: string; transform?: number[] }>).filter(
        (it) => typeof it.str === "string" && it.str.length > 0
      );

      // Bucket runs into rows by rounded y (PDF y grows upward).
      const rows = new Map<number, { x: number; str: string }[]>();
      for (const it of items) {
        const x = it.transform?.[4] ?? 0;
        const y = Math.round((it.transform?.[5] ?? 0) / 2) * 2;
        const arr = rows.get(y) ?? [];
        arr.push({ x, str: it.str as string });
        rows.set(y, arr);
      }

      const ys = [...rows.keys()].sort((a, b) => b - a); // top → bottom
      for (const y of ys) {
        const line = (rows.get(y) ?? [])
          .sort((a, b) => a.x - b.x)
          .map((r) => r.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (line) lines.push(line);
      }
    }
  } finally {
    void loadingTask.destroy();
  }

  return { lines, pageCount: doc.numPages, hasText: lines.join("").trim().length > 0 };
}
