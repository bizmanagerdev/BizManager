"use client";

import { useCallback, useState } from "react";
import { ShareIcon, SpinnerIcon } from "@/components/ui/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toHebrewError } from "@/lib/error-messages";

export default function ProjectWorkerExportActions({
  shareTitle,
  exportContentId,
  pdfFileName,
}: {
  shareTitle: string;
  exportContentId: string;
  pdfFileName: string;
}) {
  const [sharing, setSharing] = useState(false);

  const getExportElement = useCallback(() => {
    const exportElement = document.getElementById(exportContentId);
    if (!exportElement) {
      throw new Error("לא נמצא תוכן הייצוא ליצירת PDF.");
    }

    return exportElement;
  }, [exportContentId]);

  const createPdfFile = useCallback(async () => {
    const exportElement = getExportElement();

    if ("fonts" in document) {
      await document.fonts.ready;
    }

    // html-to-image (NOT html2canvas): this captures the LIVE, token-styled app
    // DOM, and Tailwind v4 compiles every `/opacity` utility (e.g. the
    // `bg-background/70` on <Badge variant="outline"> in the header) to
    // `color-mix(in oklab, …)`, which browsers resolve to a `color(srgb …)`
    // computed value. html2canvas re-implements CSS parsing itself and only
    // understands rgb/rgba/hsl/hsla, so it threw on every single export.
    // html-to-image rasterises through the browser's own renderer, so any color
    // syntax the browser accepts works here by construction.
    const [{ toCanvas }, { default: jsPDF }] = await Promise.all([
      import("html-to-image"),
      import("jspdf"),
    ]);

    const canvas = await toCanvas(exportElement, {
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      backgroundColor: "#ffffff",
      // Attachment photos are cross-origin (signed Supabase URLs) and are
      // inlined as data URLs. cacheBust avoids reusing a cached opaque response
      // that would otherwise fail to embed.
      cacheBust: true,
      // The UI is a system font stack (no @font-face / next-font anywhere), so
      // there is nothing to embed — skipping avoids a slow, failure-prone
      // stylesheet crawl on every export.
      skipFonts: true,
    });

    const imageData = canvas.toDataURL("image/jpeg", 0.95);
    const pdf = new jsPDF({
      orientation: "p",
      unit: "mm",
      format: "a4",
      compress: true,
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imageWidth = pageWidth;
    const imageHeight = (canvas.height * imageWidth) / canvas.width;

    let heightLeft = imageHeight;
    let position = 0;

    pdf.addImage(imageData, "JPEG", 0, position, imageWidth, imageHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position -= pageHeight;
      pdf.addPage();
      pdf.addImage(imageData, "JPEG", 0, position, imageWidth, imageHeight);
      heightLeft -= pageHeight;
    }

    const pdfBlob = pdf.output("blob");
    return new File([pdfBlob], pdfFileName, { type: "application/pdf" });
  }, [getExportElement, pdfFileName]);

  const openPrintDialog = useCallback(async () => {
    getExportElement();
    window.print();
  }, [getExportElement]);

  const downloadPdfFile = useCallback((pdfFile: File) => {
    const fileUrl = URL.createObjectURL(pdfFile);
    const downloadLink = document.createElement("a");
    downloadLink.href = fileUrl;
    downloadLink.download = pdfFile.name;
    downloadLink.rel = "noopener";
    // Firefox/Safari ignore a click on a link that was never in the document.
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    // Revoking synchronously can abort a download that hasn't started reading
    // the blob yet — hand the URL back only once the browser has taken it.
    window.setTimeout(() => URL.revokeObjectURL(fileUrl), 60_000);
  }, []);

  const sharePdf = useCallback(async () => {
    if (sharing) return;

    setSharing(true);
    try {
      const pdfFile = await createPdfFile();
      const shareData = {
        title: shareTitle,
        text: shareTitle,
        files: [pdfFile],
      };

      if (
        typeof navigator !== "undefined" &&
        "share" in navigator &&
        "canShare" in navigator &&
        navigator.canShare(shareData)
      ) {
        await navigator.share(shareData);
        return;
      }

      // Desktop has no file share sheet — download so the PDF can be attached.
      downloadPdfFile(pdfFile);
      toast.success(`ה-PDF הורד למכשיר בשם ${pdfFileName}.`);
    } catch (error: unknown) {
      // The user dismissed the share sheet — not a failure.
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      toast.error(toHebrewError(error, "יצירת ה-PDF נכשלה."));
    } finally {
      setSharing(false);
    }
  }, [createPdfFile, downloadPdfFile, pdfFileName, shareTitle, sharing]);

  return (
    <div className="print:hidden border-b bg-background/95 px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void sharePdf()}
          disabled={sharing}
        >
          {sharing ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : <ShareIcon className="h-4 w-4" />}
          <span>שיתוף PDF</span>
        </Button>
        <Button type="button" size="sm" onClick={() => void openPrintDialog()} disabled={sharing}>
          הדפסה / שמירה ל־PDF
        </Button>
      </div>
    </div>
  );
}
