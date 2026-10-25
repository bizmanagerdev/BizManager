// The rent roll out of the app (owner, 2026-10-21): the month or the year as
// it's on screen — to Excel, or printed. One set of rows for both, so the
// file and the paper say the same.

import { formatShortDate } from "@/lib/date";
import { formatCurrency } from "@/lib/payroll";
import { paymentMethodLabel } from "@/lib/orders/paymentStatus";
import { depositTypeLabel, propertyDisplayName, type RentRollPayment } from "@/lib/properties";
import { paidTowards, RENT_STATE } from "@/lib/property-rent";
import { toRollRent, type RentRollMonth, type RentRollRow, type RentRollYear } from "@/lib/rent-roll";

/** `total`: its last row is the totals line (bold on paper). */
export type Sheet = { title: string; rows: string[][]; total?: boolean };

function place(row: Pick<RentRollRow, "property" | "lease">): string {
  const unit = row.lease.unitLabel?.trim();
  const name = propertyDisplayName(row.property);
  return unit ? `${name} · ${unit}` : name;
}

function method(p: RentRollPayment): string {
  if (p.method === "check") return p.checkNumber ? `צ׳ק #${p.checkNumber}` : "צ׳ק";
  const label = paymentMethodLabel(p.method);
  return label && label !== "-" ? label : "";
}

function money(p: RentRollPayment): string {
  return formatShortDate(p.method === "check" ? p.dueDate ?? p.date : p.date, "");
}

export function deposit(row: Pick<RentRollRow, "lease">): string {
  const { depositType, depositAmount } = row.lease;
  if (!depositType && !(depositAmount && depositAmount > 0)) return "";
  return [depositTypeLabel(depositType), depositAmount && depositAmount > 0 ? formatCurrency(depositAmount) : null]
    .filter(Boolean)
    .join(" ");
}

export function monthSheet(month: RentRollMonth, accountNames: Record<string, string>): Sheet {
  const head = [
    "נכס", "שוכר", "חודש", "מועד", "שכירות", "מצב", "שולם", "תאריך", "אמצעי", "חשבון", "חוב קודם", "צ׳קים ביד", "צ׳קים עד", "חוזה עד", "פיקדון",
  ];
  const lines = (row: RentRollRow, pick: (p: RentRollPayment) => string) => row.payments.map(pick).join("; ");
  const rows = month.rows.map((row) => [
    place(row),
    row.lease.customerName ?? "",
    row.periodLabel,
    row.dueLabel,
    row.ended ? "" : formatCurrency(row.status.rent),
    row.ended ? "החוזה הסתיים" : RENT_STATE[row.status.state].label + (row.returned.length > 0 ? " (צ׳ק חזר)" : ""),
    // What each payment gave this month (one for several months: its share).
    lines(row, (p) => formatCurrency(paidTowards(row.lease, toRollRent(p), row.period))),
    lines(row, money),
    lines(row, method),
    lines(row, (p) => (p.accountId ? accountNames[p.accountId] ?? "" : "")),
    row.debt.amount > 0.5 ? formatCurrency(row.debt.amount) : "",
    row.checksInHand.count > 0 ? String(row.checksInHand.count) : "",
    row.checksInHand.lastLabel ?? "",
    formatShortDate(row.lease.endDate, ""),
    deposit(row),
  ]);
  const vacant = month.vacant.map((p) => [propertyDisplayName(p), "", "", "", "", "אין שוכר", "", "", "", "", "", "", "", "", ""]);
  const t = month.totals;
  const total = ["סה״כ", "", "", "", formatCurrency(t.expected), "", formatCurrency(t.collected), "", "", "", formatCurrency(t.debt), String(t.checksInHand.count), "", "", ""];
  return { title: `שכירות — ${month.label}`, rows: [head, ...rows, ...vacant, total], total: true };
}

const CELL_WORD: Record<string, string> = { paid: "שולם", partial: "חלקי", check: "צ׳ק ממתין", late: "לא שולם", upcoming: "טרם", none: "" };

export function yearSheet(year: RentRollYear): Sheet {
  const head = ["נכס", "שוכר", ...year.headers];
  const rows = year.rows.map((row) => [
    place(row),
    row.lease.customerName ?? "",
    ...row.cells.map((cell) => (cell ? CELL_WORD[cell.status.state] + (cell.returned.length > 0 ? " (חזר)" : "") : "")),
  ]);
  return { title: `שכירות — ${year.headers[0]} עד ${year.headers[year.headers.length - 1]}`, rows: [head, ...rows] };
}

export async function downloadExcel(sheet: Sheet): Promise<void> {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
  ws["!cols"] = sheet.rows[0].map((_, i) => ({ wch: Math.min(40, Math.max(8, ...sheet.rows.map((r) => (r[i] ?? "").length + 2))) }));
  const wb = XLSX.utils.book_new();
  // Right to left, as it reads.
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, "שכירות");
  XLSX.writeFile(wb, `${sheet.title.replace(/[\\/:*?"<>|]/g, "-")}.xlsx`);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A plain page with the table, printed as it opens (its own window: no menus, no buttons). */
export function printSheet(sheet: Sheet): boolean {
  const win = window.open("", "_blank", "width=1100,height=800");
  if (!win) return false;
  const [head, ...rows] = sheet.rows;
  win.document.write(`<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(sheet.title)}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; margin: 0; color: #111; }
  h1 { font-size: 16px; margin: 0 0 8px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: 3px 5px; text-align: right; white-space: nowrap; }
  th { background: #f1f5f9; }
  tr.total td { font-weight: bold; }
  @page { size: landscape; margin: 10mm; }
</style>
</head>
<body>
  <h1>${escapeHtml(sheet.title)}</h1>
  <table>
    <thead><tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows
      .map((r, i) => `<tr${sheet.total && i === rows.length - 1 ? ' class="total"' : ""}>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
      .join("")}</tbody>
  </table>
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`);
  win.document.close();
  return true;
}
