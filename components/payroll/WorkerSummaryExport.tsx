"use client";

import { useState } from "react";
import { ShareIcon, PrintIcon, SpinnerIcon } from "@/components/ui/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toHebrewError } from "@/lib/error-messages";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatMinutes,
  getActiveSalaryAgreementForDate,
  sessionWorkedMinutes,
  toNumber,
  type PayrollPeriodRow,
  type PayslipRow,
  type SalaryAgreementRow,
  type WorkSessionRow,
} from "@/lib/payroll";
import { getBusinessDomainLabel } from "@/lib/expenses";
import { formatLocalDate, formatLocalTime, formatWorkerPaymentMethodLabel } from "@/app/(app)/payroll/SalaryCenterUi";
import {
  PAGINATION_CSS,
  WORKER_SUMMARY_CONTENT_CSS,
  buildWorkerSummaryPages,
  buildWorkerSummaryPrintDocument,
  escapeSummaryHtml,
  openWorkerSummaryPrintWindow,
  type WorkerSummaryPrintTable,
} from "@/lib/payroll/workerSummaryPrint";
import type { MyPaymentAllocationRow, MyPaymentRow } from "@/lib/my-payroll";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/types";
import { profileDict } from "@/lib/i18n/dictionaries/profile";

// The same "סיכום עבודה ותשלומים לעובד" report an admin can print for any
// worker from the salary center — here scoped to the signed-in worker's own
// data and the currently selected month, no project/date filters to choose.
// The HTML/CSS/pagination template is shared with the admin tool (see
// lib/payroll/workerSummaryPrint.ts) so the two can never drift apart.

function esc(value: string) {
  return escapeSummaryHtml(value);
}

function nowLabel() {
  const generatedAt = new Date();
  return `${formatDate(generatedAt.toISOString())} ${generatedAt.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
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

type ReportInputs = {
  workerName: string;
  workerPhone: string | null;
  monthLabel: string;
  monthKey: string;
  selectedMonthSessions: WorkSessionRow[];
  linkLabelBySessionId: Record<string, string>;
  agreements: SalaryAgreementRow[];
  payslips: PayslipRow[];
  periods: PayrollPeriodRow[];
  payments: MyPaymentRow[];
  paymentAllocations: MyPaymentAllocationRow[];
};

/** Everything needed to render the report: the hero header + summary cards, and the two tables. */
function buildReport(input: ReportInputs) {
  // Straight from attendance_sessions.labor_cost — the SAME source the admin's
  // own print reads (sessionCostsById). worker_debt_items_view looked like the
  // "official" number, but it only carries a session when the worker's
  // pay_tracking_mode is exactly 'session' AND labor_cost > 0 (see
  // db/sql/create_worker_payment_views.sql) — a payslip-tracked worker's own
  // sessions never show up there at all, which is why every row and every
  // total in this report read ₪0 for one real worker despite real labor_cost
  // values on the rows. Reading the column directly has no such gap.
  const periodMonthByPeriodId = new Map(input.periods.map((period) => [period.id, period.period_month]));
  const payslipPeriodMonthById = new Map(
    input.payslips.map((payslip) => [payslip.id, periodMonthByPeriodId.get(payslip.payroll_period_id) ?? null])
  );
  const selectedMonthSessionIds = new Set(input.selectedMonthSessions.map((session) => session.id));

  const workRowData = input.selectedMonthSessions.map((session) => {
    const startDateValue = new Date(session.clock_in);
    const endDateValue = session.clock_out ? new Date(session.clock_out) : null;
    const workDate = Number.isNaN(startDateValue.getTime()) ? formatDate(session.clock_in) : formatLocalDate(startDateValue);
    const agreement = getActiveSalaryAgreementForDate(input.agreements, startDateValue);
    const isHourly = agreement?.salary_type === "hourly";
    const hourlyRateValue = isHourly ? toNumber(agreement?.hourly_rate) : 0;
    const workedAt = input.linkLabelBySessionId[session.id] || getBusinessDomainLabel(session.business_domain);

    return {
      workDate,
      workedAt,
      isHourly,
      startTime: Number.isNaN(startDateValue.getTime()) ? formatDateTime(session.clock_in) : formatLocalTime(startDateValue),
      endTime:
        endDateValue && !Number.isNaN(endDateValue.getTime()) ? formatLocalTime(endDateValue) : "פתוח",
      hours: formatMinutes(sessionWorkedMinutes(session)),
      hourlyRate: hourlyRateValue > 0 ? `${formatCurrency(hourlyRateValue)} / שעה` : "—",
      earnedRaw: toNumber(session.labor_cost),
      amount: formatCurrency(toNumber(session.labor_cost)),
      notes: session.notes ?? "",
    };
  });

  const showHourlyColumns = workRowData.some((row) => row.isHourly);
  const showNotesColumn = workRowData.some((row) => row.notes.trim().length > 0);
  const workRowsHtml = workRowData.map((row) => {
    const hourlyCells = showHourlyColumns
      ? `<td>${esc(row.isHourly ? row.startTime : "—")}</td><td>${esc(row.isHourly ? row.endTime : "—")}</td><td>${esc(row.isHourly ? row.hours : "—")}</td><td>${esc(row.isHourly ? row.hourlyRate : "—")}</td>`
      : "";
    const notesCell = showNotesColumn ? `<td>${esc(row.notes || "—")}</td>` : "";
    return `<tr><td>${esc(row.workDate)}</td>${hourlyCells}<td>${esc(row.workedAt)}</td><td>${esc(row.amount)}</td>${notesCell}</tr>`;
  });
  const notesHeader = showNotesColumn ? "<th>הערות</th>" : "";
  const workTableHeaders = showHourlyColumns
    ? `<th>תאריך</th><th>שעת התחלה</th><th>שעת סיום</th><th>סה"כ שעות</th><th>תעריף שעתי</th><th>פרויקט / נכס</th><th>עלות עבודה</th>${notesHeader}`
    : `<th>תאריך</th><th>פרויקט / נכס</th><th>עלות עבודה</th>${notesHeader}`;

  // Earned = the sessions shown in "פירוט עבודה" — matches the table below it.
  const earned = workRowData.reduce((sum, row) => sum + row.earnedRaw, 0);

  const allocationsByPaymentId = new Map<string, MyPaymentAllocationRow[]>();
  for (const allocation of input.paymentAllocations) {
    const list = allocationsByPaymentId.get(allocation.workerPaymentId) ?? [];
    list.push(allocation);
    allocationsByPaymentId.set(allocation.workerPaymentId, list);
  }
  // Mirrors the admin print: a payment counts toward this month only through
  // what it's ALLOCATED to (the session's month, or the payslip's period) —
  // an unallocated advance has no work to key on, so it never appears here.
  const scopedPayments = input.payments
    .map((payment) => {
      const allocations = allocationsByPaymentId.get(payment.id) ?? [];
      if (allocations.length === 0) return null;
      const scopedAmount = allocations.reduce((sum, allocation) => {
        if (allocation.sourceType === "session") {
          return allocation.attendanceSessionId && selectedMonthSessionIds.has(allocation.attendanceSessionId)
            ? sum + allocation.amount
            : sum;
        }
        const periodMonth = allocation.payslipId ? payslipPeriodMonthById.get(allocation.payslipId) : null;
        return periodMonth === input.monthKey ? sum + allocation.amount : sum;
      }, 0);
      return scopedAmount > 0.009 ? { payment, scopedAmount } : null;
    })
    .filter((row): row is { payment: MyPaymentRow; scopedAmount: number } => Boolean(row));

  // Paid = exactly what's itemized in "פירוט תשלומים" below — the two numbers
  // can never disagree, because one is the sum of the other.
  const paid = scopedPayments.reduce((sum, { scopedAmount }) => sum + scopedAmount, 0);
  const owed = earned - paid;

  const paymentRowsHtml = scopedPayments.map(({ payment, scopedAmount }) => {
    const details = [formatWorkerPaymentMethodLabel(payment.method), payment.referenceNumber]
      .filter(Boolean)
      .join(" • ");
    return `<tr><td>${esc(formatDate(payment.paymentDate))}</td><td>${esc(formatCurrency(scopedAmount))}</td><td>${esc(details || "ללא פירוט")}</td><td>${esc(payment.notes || "-")}</td></tr>`;
  });
  const paymentTableHeaders = `<th>תאריך תשלום</th><th>סכום</th><th>איך שולם</th><th>הערות</th>`;

  const headerHtml = `
    <table class="hero-table">
      <thead><tr><th>סיכום עבודה ותשלומים לעובד</th></tr></thead>
      <tbody>
        <tr>
          <td>
            <div class="worker-name">${esc(input.workerName)}</div>
            <div class="worker-phone">טלפון: ${esc(input.workerPhone ?? "-")}</div>
            <p class="subtle">חודש: ${esc(input.monthLabel)}</p>
            <p class="subtle">הופק בתאריך ${esc(nowLabel())}</p>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="summary">
      <div class="card"><div class="label">סה"כ שנצבר לחודש</div><div class="value">${esc(formatCurrency(earned))}</div></div>
      <div class="card"><div class="label">סה"כ שולם לחודש</div><div class="value">${esc(formatCurrency(paid))}</div></div>
      <div class="card"><div class="label">יתרה לתשלום לחודש</div><div class="value">${esc(formatCurrency(owed))}</div></div>
    </div>
  `;

  const tables: WorkerSummaryPrintTable[] = [
    { title: "פירוט עבודה", headers: workTableHeaders, rows: workRowsHtml, empty: "אין משמרות לחודש שנבחר." },
    { title: "פירוט תשלומים", headers: paymentTableHeaders, rows: paymentRowsHtml, empty: "אין תשלומים רשומים לחודש שנבחר." },
  ];

  return { headerHtml, tables, docTitle: `סיכום עובד - ${input.workerName}` };
}

/** "סיכום עבודה - <שם> - <חודש>.pdf" — NFC-normalised, filesystem-unsafe characters stripped. */
function pdfFileName(workerName: string, monthLabel: string) {
  const safeName = `${workerName} - ${monthLabel}`.replace(/[\\/:*?"<>|]/g, "").trim();
  return `סיכום עבודה - ${safeName || "עובד"}.pdf`.normalize("NFC");
}

export default function WorkerSummaryExport(props: ReportInputs & { locale?: Locale }) {
  const { locale = "he" } = props;
  const [sharing, setSharing] = useState(false);

  function handlePrint() {
    const report = buildReport(props);
    const html = buildWorkerSummaryPrintDocument(report);
    openWorkerSummaryPrintWindow(html);
  }

  async function handleShare() {
    if (sharing) return;
    setSharing(true);

    const report = buildReport(props);

    // The generated pages use the SAME class names as the print document, so
    // they need the same content + pagination CSS actually applied — inject
    // both, scoped to this capture, and remove them again in `finally`. The
    // pagination CSS is what makes `.page-content`'s height actually clamp,
    // which is what lets buildWorkerSummaryPages() detect overflow and start
    // a new page instead of letting a row spill across the page boundary.
    const styleEl = document.createElement("style");
    styleEl.setAttribute("data-worker-summary-print", "");
    styleEl.textContent = WORKER_SUMMARY_CONTENT_CSS + PAGINATION_CSS;
    document.head.appendChild(styleEl);

    // Off-screen but laid out (not display:none), parked at the origin inside
    // a zero-size clipping wrapper — see BilledCustomerPrintButton for why an
    // off-screen `left:-10000px` node breaks html-to-image's capture instead.
    const wrapper = document.createElement("div");
    wrapper.setAttribute("aria-hidden", "true");
    wrapper.style.cssText =
      "position:fixed;top:0;left:0;width:0;height:0;overflow:hidden;opacity:0;z-index:-1;pointer-events:none;";

    // 190mm = A4 width minus a 10mm margin each side, matching the print
    // document's own printable area — see CONTENT_WIDTH_MM/MARGIN_MM below.
    const node = document.createElement("div");
    node.setAttribute("dir", "rtl");
    node.style.cssText = "width:190mm;background:#ffffff;";
    wrapper.appendChild(node);
    document.body.appendChild(wrapper);

    const pages = buildWorkerSummaryPages(node, report);

    // The whole build must not spin the button forever if a step never
    // settles — race it against a hard timeout instead. (The report uses only
    // system fonts — Arial — so there is deliberately no
    // `await document.fonts.ready` anywhere in this path: that call reflects
    // every font on the WHOLE page, not just this node, and hung indefinitely
    // in the packaged Android WebView with nothing to actually wait for.)
    async function buildAndDeliverPdf() {
      // html-to-image, NOT html2canvas — html2canvas chokes on Tailwind v4's
      // color-mix() opacity utilities used elsewhere in the app.
      const [{ toCanvas }, { default: jsPDF }] = await Promise.all([
        import("html-to-image"),
        import("jspdf"),
      ]);

      const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });
      // Matches PAGINATION_CSS's own page geometry (10mm margin, 277mm of
      // content height) — each `.page` from buildWorkerSummaryPages() is
      // captured on its own, so a page break here is always between two
      // rows, never through the middle of one.
      const CONTENT_WIDTH_MM = 190;
      const MARGIN_MM = 10;

      for (let index = 0; index < pages.length; index += 1) {
        const page = pages[index];
        const canvas = await toCanvas(page, {
          pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
          backgroundColor: "#ffffff",
          skipFonts: true,
          width: page.offsetWidth,
          height: page.offsetHeight,
        });

        if (isBlankCapture(canvas)) {
          throw new Error("יצירת ה-PDF נכשלה: הדף שנוצר יצא ריק. נסו שוב.");
        }

        const imageData = canvas.toDataURL("image/jpeg", 0.95);
        const imageHeight = (canvas.height * CONTENT_WIDTH_MM) / canvas.width;
        if (index > 0) pdf.addPage();
        pdf.addImage(imageData, "JPEG", MARGIN_MM, MARGIN_MM, CONTENT_WIDTH_MM, imageHeight);
      }

      const pdfBlob = pdf.output("blob");
      const fileName = pdfFileName(props.workerName, props.monthLabel);
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
    }

    try {
      // Left running even after a win by buildAndDeliverPdf(): rejecting an
      // already-settled race is a no-op, and clearing it needs a type that
      // differs between DOM's setTimeout and the @types/node one this project
      // also loads — not worth fighting for a timer that fires once, uselessly.
      const timeout = new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error("יצירת ה-PDF נמשכה זמן רב מדי. נסו שוב.")), 20_000);
      });
      await Promise.race([buildAndDeliverPdf(), timeout]);
    } catch (error: unknown) {
      // The user dismissed the share sheet — not a failure.
      if (error instanceof Error && error.name === "AbortError") return;
      toast.error(toHebrewError(error, "יצירת ה-PDF נכשלה."));
    } finally {
      wrapper.remove();
      styleEl.remove();
      setSharing(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="secondary" onClick={() => void handleShare()} disabled={sharing}>
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
