"use client";

import { useCallback, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { Button } from "@/components/ui/button";

type ShareMode = "whatsapp" | null;

export default function ProjectWorkerExportActions({
  shareTitle,
  exportContentId,
  pdfFileName,
}: {
  shareTitle: string;
  exportContentId: string;
  pdfFileName: string;
}) {
  const [activeMode, setActiveMode] = useState<ShareMode>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);

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

    const canvas = await html2canvas(exportElement, {
      scale: Math.min(window.devicePixelRatio || 1, 2),
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      windowWidth: document.documentElement.scrollWidth,
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

  const sharePdfToWhatsApp = useCallback(async () => {
    setActiveMode("whatsapp");
    setShareMessage(null);

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
        setShareMessage("ה-PDF מוכן לשיתוף ונשלח דרך חלון השיתוף של המכשיר.");
        return;
      }

      const fileUrl = URL.createObjectURL(pdfFile);
      const downloadLink = document.createElement("a");
      downloadLink.href = fileUrl;
      downloadLink.download = pdfFileName;
      downloadLink.click();
      URL.revokeObjectURL(fileUrl);
      setShareMessage(`ה-PDF הורד למכשיר בשם ${pdfFileName}. צרפו אותו ל-WhatsApp אם חלון השיתוף לא נפתח.`);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      setShareMessage(error instanceof Error ? error.message : "יצירת ה-PDF נכשלה.");
    } finally {
      setActiveMode(null);
    }
  }, [createPdfFile, pdfFileName, shareTitle]);

  const isBusy = activeMode !== null;

  return (
    <div className="print:hidden border-b bg-background/95 px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void sharePdfToWhatsApp()} disabled={isBusy}>
          {activeMode === "whatsapp" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MessageCircle className="h-4 w-4" />
          )}
          <span>שיתוף PDF</span>
        </Button>
        <Button type="button" size="sm" onClick={() => void openPrintDialog()} disabled={isBusy}>
          הדפסה / שמירה ל־PDF
        </Button>
      </div>
      {shareMessage ? <div className="mt-2 text-xs text-muted-foreground">{shareMessage}</div> : null}
    </div>
  );
}
