"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type ShareMode = "whatsapp" | null;

export default function ProjectWorkerExportActions({
  backHref,
  shareTitle,
  exportContentId,
  pdfFileName,
}: {
  backHref: string;
  shareTitle: string;
  exportContentId: string;
  pdfFileName: string;
}) {
  const [activeMode, setActiveMode] = useState<ShareMode>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);

  const buildPdfFile = useCallback(async () => {
    const exportElement = document.getElementById(exportContentId);
    if (!exportElement) {
      throw new Error("לא נמצא תוכן הייצוא ליצירת PDF.");
    }

    const [{ toCanvas }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);

    const canvas = await toCanvas(exportElement, {
      pixelRatio: 2,
      backgroundColor: "#ffffff",
      cacheBust: true,
      width: exportElement.scrollWidth,
      height: exportElement.scrollHeight,
      canvasWidth: exportElement.scrollWidth,
      canvasHeight: exportElement.scrollHeight,
    });

    const imageData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
      compress: true,
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imageWidth = pageWidth;
    const imageHeight = (canvas.height * imageWidth) / canvas.width;
    let remainingHeight = imageHeight;
    let offsetY = 0;

    pdf.addImage(imageData, "PNG", 0, offsetY, imageWidth, imageHeight, undefined, "FAST");
    remainingHeight -= pageHeight;

    while (remainingHeight > 0) {
      offsetY = remainingHeight - imageHeight;
      pdf.addPage();
      pdf.addImage(imageData, "PNG", 0, offsetY, imageWidth, imageHeight, undefined, "FAST");
      remainingHeight -= pageHeight;
    }

    const pdfBlob = pdf.output("blob");
    return new File([pdfBlob], pdfFileName, { type: "application/pdf" });
  }, [exportContentId, pdfFileName]);

  function downloadFile(file: File) {
    const objectUrl = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = file.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  const sharePdfToWhatsApp = useCallback(async () => {
    setActiveMode("whatsapp");
    setShareMessage(null);
    try {
      const file = await buildPdfFile();
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({
          title: shareTitle,
          text: shareTitle,
          files: [file],
        });
        return;
      }

      downloadFile(file);
      setShareMessage("ה-PDF ירד למכשיר. אפשר לצרף אותו עכשיו ל-WhatsApp.");
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      setShareMessage(error instanceof Error ? error.message : "יצירת ה-PDF נכשלה.");
    } finally {
      setActiveMode(null);
    }
  }, [buildPdfFile, shareTitle]);

  const isBusy = activeMode !== null;

  return (
    <div className="print:hidden border-b bg-background/95 px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" size="sm" asChild disabled={isBusy}>
          <Link href={backHref}>חזרה לפרויקט</Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void sharePdfToWhatsApp()} disabled={isBusy}>
            {activeMode === "whatsapp" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MessageCircle className="h-4 w-4" />
            )}
            <span>WhatsApp PDF</span>
          </Button>
          <Button type="button" size="sm" onClick={() => window.print()} disabled={isBusy}>
            הדפסה / שמירה ל־PDF
          </Button>
        </div>
      </div>
      {shareMessage ? <div className="mt-2 text-xs text-muted-foreground">{shareMessage}</div> : null}
    </div>
  );
}
