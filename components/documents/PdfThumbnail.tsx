"use client";

import { useEffect, useRef, useState } from "react";
import { pdfThumbnails } from "@/lib/documents/pdfThumbnail";

// A PDF's first page, standing in for the file in a gallery of photographs.
//
// Nothing is fetched until the tile is near the viewport: the archive holds
// hundreds of documents, and rendering every PDF on load would download every
// one of them to draw a picture the size of a postcard.

export default function PdfThumbnail({
  cacheKey,
  url,
  width = 176,
  fallback,
}: {
  /** The DOCUMENT's id — signed urls are re-minted hourly and would never hit. */
  cacheKey: string;
  url: string;
  width?: number;
  /** Shown before the page is drawn, and instead of it if the render fails. */
  fallback: React.ReactNode;
}) {
  const [src, setSrc] = useState<string | null>(() => pdfThumbnails.peek(cacheKey));
  const holderRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    // Already drawn — the initial state picked it up from the cache.
    if (pdfThumbnails.peek(cacheKey)) return;

    const holder = holderRef.current;
    if (!holder) return;

    let cancelled = false;
    const start = () => {
      pdfThumbnails
        .request(cacheKey, url, width)
        .then((result) => {
          if (!cancelled) setSrc(result);
        })
        .catch(() => {
          // The fallback glyph stays; a thumbnail that cannot be drawn is not
          // worth a toast, and nothing the person did caused it.
        });
    };

    if (typeof IntersectionObserver === "undefined") {
      start();
      return () => {
        cancelled = true;
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          start();
        }
      },
      // A screen of lead time, so a thumbnail is usually ready by the time it
      // is scrolled to.
      { rootMargin: "600px" }
    );
    observer.observe(holder);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [cacheKey, url, width]);

  return (
    <span ref={holderRef} className="flex h-full w-full items-center justify-center">
      {src ? (
        // A data: url of a canvas we just drew — next/image would only add a
        // round trip through the optimizer for something already the right size.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover object-top" />
      ) : (
        fallback
      )}
    </span>
  );
}
