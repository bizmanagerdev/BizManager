"use client";

import { useState } from "react";
import { ShareIcon, PrintIcon, SpinnerIcon } from "@/components/ui/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toHebrewError } from "@/lib/error-messages";
import { formatMinutes, sessionWorkedMinutes, type WorkSessionRow } from "@/lib/payroll";
import { getBusinessDomainLabel } from "@/lib/expenses";
import { shiftHoursText } from "@/components/attendance/DayTile";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/types";
import { profileDict } from "@/lib/i18n/dictionaries/profile";

export type MonthlyAttendanceExportItem = {
  session: WorkSessionRow;
  /** The specific project name / property address the shift was booked to. */
  linkLabel?: string;
};

export type MonthlyAttendanceExportSummary = {
  totalMinutes: number;
  sessionCount: number;
  openSessionCount: number;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "ה'" — the same narrow weekday initial as the on-screen DayTile. */
function weekdayNarrow(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "he-IL", {
    weekday: "narrow",
    timeZone: "Asia/Jerusalem",
  }).format(new Date(iso));
}

function dateLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

function nowLabel(locale: Locale) {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "he-IL", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());
}

/** Whose job was it — the specific project/address, else the domain. Mirrors SessionList's whatFor. */
function whatFor(item: MonthlyAttendanceExportItem) {
  return item.linkLabel || getBusinessDomainLabel(item.session.business_domain);
}

// Styles are inline on every element (no <style> block on the shared markup):
// the same HTML is captured off-screen for the direct PDF AND written into a
// standalone print window — a stylesheet living in either host document would
// never reach the other.
const S = {
  head: "display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0A1020;padding-bottom:12px;margin-bottom:14px;",
  h1: "font-size:19px;margin:0 0 4px;font-weight:700;color:#0A1020;",
  muted: "color:#555;font-size:12px;",
  statRow: "display:flex;gap:10px;margin-bottom:16px;",
  statBox:
    "flex:1;border:1px solid #dbe3ec;border-top:3px solid #0369A1;border-radius:10px;padding:10px 12px;background:#f6f9fc;text-align:center;",
  statValue: "font-size:18px;font-weight:700;color:#0A1020;",
  statLabel: "font-size:11px;color:#555;margin-top:2px;",
  table: "width:100%;border-collapse:collapse;",
  th: "text-align:right;padding:6px;border-bottom:1px solid #ddd;font-size:12px;color:#555;font-weight:600;",
  thDate: "text-align:right;padding:6px;border-bottom:1px solid #ddd;font-size:12px;color:#555;font-weight:600;width:110px;white-space:nowrap;",
  td: "text-align:right;padding:7px 6px;border-bottom:1px solid #eee;font-size:13px;vertical-align:top;",
  tdDate: "text-align:right;padding:7px 6px;border-bottom:1px solid #eee;font-size:13px;color:#333;white-space:nowrap;vertical-align:top;",
  tdMain: "font-weight:600;color:#0A1020;",
  tdSub: "color:#777;font-size:11px;margin-top:2px;",
  footLabel: "text-align:right;padding:9px 6px 0;font-size:13px;font-weight:700;border-top:2px solid #0A1020;",
  footValue: "text-align:right;padding:9px 6px 0;font-size:13px;font-weight:700;border-top:2px solid #0A1020;white-space:nowrap;",
};

type ReportData = {
  workerName: string;
  monthLabel: string;
  summary: MonthlyAttendanceExportSummary | null;
  items: MonthlyAttendanceExportItem[];
  locale: Locale;
};

/** The report body — shared by the print window and the direct-PDF capture. */
function buildReportMarkup(data: ReportData, generatedAt: string): string {
  const statLabels = {
    total: t(profileDict, data.locale, "totalHoursStatLabel"),
    count: t(profileDict, data.locale, "sessionCountLabel"),
    open: t(profileDict, data.locale, "openSessionCountLabel"),
  };

  const stats = data.summary
    ? `<div style="${S.statRow}">
        <div style="${S.statBox}"><div style="${S.statValue}">${formatMinutes(data.summary.totalMinutes)}</div><div style="${S.statLabel}">${escapeHtml(statLabels.total)}</div></div>
        <div style="${S.statBox}"><div style="${S.statValue}">${data.summary.sessionCount}</div><div style="${S.statLabel}">${escapeHtml(statLabels.count)}</div></div>
        <div style="${S.statBox}"><div style="${S.statValue}">${data.summary.openSessionCount}</div><div style="${S.statLabel}">${escapeHtml(statLabels.open)}</div></div>
      </div>`
    : "";

  const rows = data.items
    .map((item) => {
      const session = item.session;
      const duration = formatMinutes(sessionWorkedMinutes(session));
      const range = shiftHoursText(session.clock_in, session.clock_out);
      const label = whatFor(item);
      const note = session.notes;
      const weekdayMark = data.locale === "ar" ? "" : "׳";
      return `<tr>
        <td style="${S.tdDate}">${escapeHtml(weekdayNarrow(session.clock_in, data.locale))}${weekdayMark} ${escapeHtml(dateLabel(session.clock_in))}</td>
        <td style="${S.td}"><div style="${S.tdMain}">${escapeHtml(duration)}</div><div style="${S.tdSub}">${escapeHtml(range)}</div></td>
        <td style="${S.td}"><div style="${S.tdMain}">${escapeHtml(label)}</div>${note ? `<div style="${S.tdSub}">${escapeHtml(note)}</div>` : ""}</td>
      </tr>`;
    })
    .join("");

  const emptyRow = `<tr><td colspan="3" style="${S.td}text-align:center;color:#777;">${escapeHtml(
    t(profileDict, data.locale, "noSessionsThisMonth")
  )}</td></tr>`;

  return `<div style="${S.head}">
    <div>
      <div style="${S.h1}">${escapeHtml(t(profileDict, data.locale, "exportReportTitle"))}</div>
      <div style="${S.muted}">${escapeHtml(data.workerName)} · ${escapeHtml(data.monthLabel)}</div>
    </div>
    <div style="${S.muted}">${escapeHtml(t(profileDict, data.locale, "exportGeneratedAtLabel"))} ${escapeHtml(generatedAt)}</div>
  </div>
  ${stats}
  <table style="${S.table}">
    <thead><tr>
      <th style="${S.thDate}">${escapeHtml(t(profileDict, data.locale, "dateHeader"))}</th>
      <th style="${S.th}">${escapeHtml(t(profileDict, data.locale, "hoursHeader"))}</th>
      <th style="${S.th}">${escapeHtml(t(profileDict, data.locale, "linkHeader"))}</th>
    </tr></thead>
    <tbody>${rows || emptyRow}</tbody>
    ${
      data.summary && data.items.length > 0
        ? `<tfoot><tr><td colspan="2" style="${S.footLabel}">${escapeHtml(
            t(profileDict, data.locale, "totalHoursStatLabel")
          )}</td><td style="${S.footValue}">${formatMinutes(data.summary.totalMinutes)}</td></tr></tfoot>`
        : ""
    }
  </table>`;
}

/**
 * "נוכחות - <שם> - <חודש>.pdf" — NFC-normalised (a decomposed Hebrew string is a
 * second way a receiving app can render the name wrong); only characters no
 * file system accepts are stripped.
 */
function pdfFileName(data: ReportData) {
  const safeName = `${data.workerName} - ${data.monthLabel}`.replace(/[\\/:*?"<>|]/g, "").trim();
  return `נוכחות - ${safeName || "דוח"}.pdf`.normalize("NFC");
}

/**
 * html-to-image's failure mode is silent: when the capture goes wrong it hands
 * back an all-white canvas rather than throwing, which used to ship as a blank
 * PDF. Sampling the pixels turns that into a visible error instead.
 */
function isBlankCapture(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || !canvas.width || !canvas.height) return true;

  let pixels: Uint8ClampedArray;
  try {
    pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    return false;
  }

  for (let i = 0; i < pixels.length; i += 32) {
    if (pixels[i] < 240 || pixels[i + 1] < 240 || pixels[i + 2] < 240) return false;
  }
  return true;
}

export default function MonthlyAttendanceExport({
  workerName,
  monthLabel,
  summary,
  items,
  locale = "he",
}: {
  workerName: string;
  monthLabel: string;
  summary: MonthlyAttendanceExportSummary | null;
  items: MonthlyAttendanceExportItem[];
  locale?: Locale;
}) {
  const [sharing, setSharing] = useState(false);
  const data: ReportData = { workerName, monthLabel, summary, items, locale };

  /**
   * Builds the PDF in the page (html-to-image → jsPDF) and hands it straight to
   * the share sheet (phone) / a direct download (desktop) — no browser dialog.
   */
  async function handleShare() {
    if (sharing) return;
    setSharing(true);

    // Laid out (not display:none) so html-to-image can rasterise it, but parked
    // at the origin inside a zero-size clipping wrapper so it never becomes
    // visible on screen — see BilledCustomerPrintButton for why an off-screen
    // `left:-10000px` node breaks the capture instead.
    const wrapper = document.createElement("div");
    wrapper.setAttribute("aria-hidden", "true");
    wrapper.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;overflow:hidden;opacity:0;z-index:-1;pointer-events:none;";

    const node = document.createElement("div");
    node.setAttribute("dir", "rtl");
    node.style.cssText =
      "width:794px;box-sizing:border-box;padding:40px;background:#ffffff;color:#0A1020;font-family:system-ui,'Segoe UI',Arial,sans-serif;";
    node.innerHTML = buildReportMarkup(data, nowLabel(locale));
    wrapper.appendChild(node);
    document.body.appendChild(wrapper);

    try {
      if ("fonts" in document) {
        await document.fonts.ready;
      }

      // html-to-image, NOT html2canvas — html2canvas chokes on Tailwind v4's
      // color-mix() opacity utilities used elsewhere in the app.
      const [{ toCanvas }, { default: jsPDF }] = await Promise.all([
        import("html-to-image"),
        import("jspdf"),
      ]);

      const canvas = await toCanvas(node, {
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        backgroundColor: "#ffffff",
        skipFonts: true,
        width: node.offsetWidth,
        height: node.offsetHeight,
      });

      if (isBlankCapture(canvas)) {
        throw new Error("יצירת ה-PDF נכשלה: הדף שנוצר יצא ריק. נסו שוב.");
      }

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

      const pdfBlob = pdf.output("blob");
      const fileName = pdfFileName(data);
      const file = new File([pdfBlob], fileName, { type: "application/pdf" });
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

      const fileUrl = URL.createObjectURL(pdfBlob);
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
      wrapper.remove();
      setSharing(false);
    }
  }

  /** A clean, chrome-free print window — the browser's own dialog also offers "Save as PDF". */
  function handlePrint() {
    const win = window.open("", "_blank", "width=850,height=1000");
    if (!win) return;
    const html = `<!doctype html>
<html lang="${locale}" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(pdfFileName(data))}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, "Segoe UI", Arial, sans-serif; color: #0A1020; margin: 32px; }
  @media print { body { margin: 12mm; } }
</style>
</head>
<body>
  ${buildReportMarkup(data, nowLabel(locale))}
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`;
    win.document.write(html);
    win.document.close();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => void handleShare()}
        disabled={sharing}
      >
        {sharing ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : <ShareIcon className="h-4 w-4" />}
        <span>{t(profileDict, locale, "exportShareLabel")}</span>
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={handlePrint} disabled={sharing}>
        <PrintIcon className="h-4 w-4" />
        <span>{t(profileDict, locale, "exportPrintLabel")}</span>
      </Button>
    </div>
  );
}
