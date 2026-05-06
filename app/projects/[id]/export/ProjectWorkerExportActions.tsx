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

  const openPrintDialog = useCallback(async () => {
    const exportElement = document.getElementById(exportContentId);
    if (!exportElement) {
      throw new Error("לא נמצא תוכן הייצוא ליצירת PDF.");
    }

    window.print();
  }, [exportContentId]);

  const sharePdfToWhatsApp = useCallback(async () => {
    setActiveMode("whatsapp");
    setShareMessage(null);
    try {
      await openPrintDialog();
      setShareMessage(`שמרו את ${shareTitle} כ-PDF בשם ${pdfFileName} דרך חלון ההדפסה ואז צרפו אותו ל-WhatsApp.`);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      setShareMessage(error instanceof Error ? error.message : "יצירת ה-PDF נכשלה.");
    } finally {
      setActiveMode(null);
    }
  }, [openPrintDialog, pdfFileName, shareTitle]);

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
