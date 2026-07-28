"use client";

import { Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

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

function buildPrintHtml(data: BilledPrintData, generatedAt: string): string {
  const rows = data.rows
    .map(
      (row) =>
        `<tr><td class="d">${escapeHtml(row.date)}</td><td>${escapeHtml(
          row.title
        )}</td><td class="l">${formatCurrency(row.amount)}</td></tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<title>לחיוב לקוח — ${escapeHtml(data.projectName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, "Segoe UI", Arial, sans-serif; color: #0A1020; margin: 28px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .muted { color: #555; font-size: 12px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0A1020; padding-bottom: 10px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: right; padding: 5px 6px; border-bottom: 1px solid #ddd; font-size: 13px; }
  th { color: #555; font-weight: 600; }
  td.d, th.d { width: 78px; white-space: nowrap; color: #555; }
  td.l, th.l { text-align: left; width: 96px; white-space: nowrap; }
  tfoot td { font-weight: 700; font-size: 14px; border-bottom: 0; border-top: 2px solid #0A1020; padding-top: 8px; }
  @media print { body { margin: 12mm; } }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>לחיוב לקוח</h1>
      <div class="muted">${escapeHtml(data.projectName)}${
        data.customerName ? ` · ${escapeHtml(data.customerName)}` : ""
      }</div>
    </div>
    <div class="muted">הופק ב־${escapeHtml(generatedAt)}</div>
  </div>
  <table>
    <thead><tr><th class="d">תאריך</th><th>פירוט</th><th class="l">סכום</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="2">סה״כ לחיוב לקוח</td><td class="l">${formatCurrency(
      data.total
    )}</td></tr></tfoot>
  </table>
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`;
}

export default function BilledCustomerPrintButton({ data }: { data: BilledPrintData }) {
  function handlePrint() {
    const win = window.open("", "_blank", "width=800,height=900");
    if (!win) {
      toast.error("הדפדפן חסם את חלון ההדפסה. יש לאשר חלונות קופצים ולנסות שוב.");
      return;
    }
    const generatedAt = new Intl.DateTimeFormat("he-IL", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date());
    win.document.write(buildPrintHtml(data, generatedAt));
    win.document.close();
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={handlePrint}
      title="הדפסת רשימה מקוצרת"
    >
      <Printer className="ml-1 h-4 w-4" />
      הדפסה
    </Button>
  );
}
