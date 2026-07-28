"use client";

import { useState } from "react";
import { FileDown, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toHebrewError } from "@/lib/error-messages";

// Compact print sheet for the "לחיוב לקוח" card: one line per charge
// (תאריך · פירוט · סכום) and the total — without the on-screen detail
// (סטטוס תשלום, שעות, הערות, קבצים, כפתורים).

export type BilledPrintRow = {
  date: string;
  title: string;
  amount: number | null;
};

export type BilledPrintData = {
  projectName: string;
  customerName: string | null;
  rows: BilledPrintRow[];
  total: number;
};

function formatCurrency(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(value);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Styles are inline on every element (no <style> block): the same markup is
// captured off-screen inside the app document for the direct PDF, and a
// stylesheet there would leak into the app.
const S = {
  head: "display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0A1020;padding-bottom:10px;margin-bottom:12px;",
  h1: "font-size:18px;margin:0 0 4px;font-weight:700;",
  muted: "color:#555;font-size:12px;",
  table: "width:100%;border-collapse:collapse;",
  th: "text-align:right;padding:5px 6px;border-bottom:1px solid #ddd;font-size:13px;color:#555;font-weight:600;",
  thDate: "text-align:right;padding:5px 6px;border-bottom:1px solid #ddd;font-size:13px;color:#555;font-weight:600;width:78px;white-space:nowrap;",
  thAmount: "text-align:left;padding:5px 6px;border-bottom:1px solid #ddd;font-size:13px;color:#555;font-weight:600;width:96px;white-space:nowrap;",
  td: "text-align:right;padding:5px 6px;border-bottom:1px solid #ddd;font-size:13px;",
  tdDate: "text-align:right;padding:5px 6px;border-bottom:1px solid #ddd;font-size:13px;color:#555;white-space:nowrap;",
  tdAmount: "text-align:left;padding:5px 6px;border-bottom:1px solid #ddd;font-size:13px;white-space:nowrap;",
  footLabel: "text-align:right;padding:8px 6px 0;font-size:14px;font-weight:700;border-top:2px solid #0A1020;",
  footAmount: "text-align:left;padding:8px 6px 0;font-size:14px;font-weight:700;border-top:2px solid #0A1020;white-space:nowrap;",
};

/** The sheet body — shared by the print window and the direct-PDF capture. */
function buildSheetMarkup(data: BilledPrintData, generatedAt: string): string {
  const rows = data.rows
    .map(
      (row) =>
        `<tr><td style="${S.tdDate}">${escapeHtml(row.date)}</td><td style="${S.td}">${escapeHtml(
          row.title
        )}</td><td style="${S.tdAmount}">${formatCurrency(row.amount)}</td></tr>`
    )
    .join("");

  return `<div style="${S.head}">
    <div>
      <div style="${S.h1}">לחיוב לקוח</div>
      <div style="${S.muted}">${escapeHtml(data.projectName)}${
        data.customerName ? ` · ${escapeHtml(data.customerName)}` : ""
      }</div>
    </div>
    <div style="${S.muted}">הופק ב־${escapeHtml(generatedAt)}</div>
  </div>
  <table style="${S.table}">
    <thead><tr><th style="${S.thDate}">תאריך</th><th style="${S.th}">פירוט</th><th style="${
      S.thAmount
    }">סכום</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td style="${S.footLabel}" colspan="2">סה״כ לחיוב לקוח</td><td style="${
      S.footAmount
    }">${formatCurrency(data.total)}</td></tr></tfoot>
  </table>`;
}

function buildPrintHtml(data: BilledPrintData, generatedAt: string): string {
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<title>לחיוב לקוח — ${escapeHtml(data.projectName)}</title>
<style>
  body { font-family: system-ui, "Segoe UI", Arial, sans-serif; color: #0A1020; margin: 28px; }
  @media print { body { margin: 12mm; } }
</style>
</head>
<body>
${buildSheetMarkup(data, generatedAt)}
<script>window.onload = function () { window.print(); };</script>
</body>
</html>`;
}

function nowLabel() {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(
    new Date()
  );
}

function pdfFileName(data: BilledPrintData) {
  const safeName = data.projectName.replace(/[\\/:*?"<>|]/g, "").trim();
  return `לחיוב לקוח - ${safeName || "פרויקט"}.pdf`;
}

export default function BilledCustomerPrintButton({ data }: { data: BilledPrintData }) {
  const [building, setBuilding] = useState(false);

  /**
   * Builds the PDF in the page (html-to-image → jsPDF) and hands it straight to
   * the share sheet / downloads — no browser print dialog, which is where the
   * long "Saving..." wait came from.
   */
  async function handlePdf() {
    if (building) return;
    setBuilding(true);

    const node = document.createElement("div");
    node.setAttribute("dir", "rtl");
    // Off-screen but laid out (not display:none) — html-to-image rasterises the
    // real rendering. 794px ≈ A4 width at 96dpi.
    node.style.cssText =
      "position:fixed;top:0;left:-10000px;width:794px;padding:40px;background:#ffffff;color:#0A1020;font-family:system-ui,'Segoe UI',Arial,sans-serif;";
    node.innerHTML = buildSheetMarkup(data, nowLabel());
    document.body.appendChild(node);

    try {
      // Same capture path as the worker export: html-to-image (NOT html2canvas,
      // which chokes on Tailwind v4 color-mix values elsewhere in the app).
      const [{ toCanvas }, { default: jsPDF }] = await Promise.all([
        import("html-to-image"),
        import("jspdf"),
      ]);

      const canvas = await toCanvas(node, {
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        backgroundColor: "#ffffff",
        skipFonts: true,
      });

      const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imageData = canvas.toDataURL("image/jpeg", 0.95);
      const imageHeight = (canvas.height * pageWidth) / canvas.width;

      let heightLeft = imageHeight;
      let position = 0;
      pdf.addImage(imageData, "JPEG", 0, position, pageWidth, imageHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imageData, "JPEG", 0, position, pageWidth, imageHeight);
        heightLeft -= pageHeight;
      }

      const fileName = pdfFileName(data);
      const file = new File([pdf.output("blob")], fileName, { type: "application/pdf" });
      const shareData = { title: fileName, text: fileName, files: [file] };

      if (
        typeof navigator !== "undefined" &&
        "share" in navigator &&
        "canShare" in navigator &&
        navigator.canShare(shareData)
      ) {
        await navigator.share(shareData);
        return;
      }

      const fileUrl = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = fileUrl;
      link.download = fileName;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(fileUrl), 60_000);
      toast.success(`ה-PDF נשמר בשם ${fileName}`);
    } catch (error: unknown) {
      // The user dismissed the share sheet — not a failure.
      if (error instanceof Error && error.name === "AbortError") return;
      toast.error(toHebrewError(error, "יצירת ה-PDF נכשלה."));
    } finally {
      node.remove();
      setBuilding(false);
    }
  }

  /** Paper printing — a real blob document, so Chrome doesn't stall on about:blank. */
  function handlePrint() {
    const html = buildPrintHtml(data, nowLabel());
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const win = window.open(url, "_blank", "width=800,height=900");
    if (win) {
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return;
    }

    URL.revokeObjectURL(url);
    // Browsers that refuse blob popups (older iOS Safari) still take a written doc.
    const fallback = window.open("", "_blank", "width=800,height=900");
    if (!fallback) {
      toast.error("הדפדפן חסם את חלון ההדפסה. יש לאשר חלונות קופצים ולנסות שוב.");
      return;
    }
    fallback.document.write(html);
    fallback.document.close();
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => void handlePdf()}
        disabled={building}
        title="שמירת רשימה מקוצרת כ-PDF"
      >
        {building ? (
          <Loader2 className="ml-1 h-4 w-4 animate-spin" />
        ) : (
          <FileDown className="ml-1 h-4 w-4" />
        )}
        PDF
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-9 w-9 p-0"
        onClick={handlePrint}
        disabled={building}
        title="הדפסה"
        aria-label="הדפסה"
      >
        <Printer className="h-4 w-4" />
      </Button>
    </div>
  );
}
