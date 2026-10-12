"use client";

import { whatsappHref } from "@/lib/whatsapp";
import { formatMoney } from "@/lib/money";

export type OrderShareItem = { name: string; quantity: number; lineTotal: number };

export type OrderShareData = {
  orderNumber: string;
  orderDate: string;
  customerName: string;
  customerPhone: string | null;
  businessName?: string | null;
  items: OrderShareItem[];
  totalAmount: number;
  totalPaid: number;
  remainingBalance: number;
};

// ₪ first, as on the screen (owner, 2026-10-11: money is written the
// dashboard's way) — the WhatsApp text and the printed sheet too.
function formatCurrency(value: number) {
  return formatMoney(value);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain-text order summary for WhatsApp — one item per line, then the totals. */
function buildShareText(order: OrderShareData): string {
  const lines: string[] = [];
  if (order.businessName) lines.push(order.businessName);
  lines.push(`הזמנה #${order.orderNumber}`);
  lines.push(`תאריך: ${order.orderDate}`);
  lines.push(`לקוח: ${order.customerName}`);
  lines.push("");
  for (const item of order.items) {
    lines.push(`• ${item.name} ×${item.quantity} — ${formatCurrency(item.lineTotal)}`);
  }
  lines.push("");
  lines.push(`סה"כ: ${formatCurrency(order.totalAmount)}`);
  if (order.remainingBalance > 0.009) {
    lines.push(`שולם: ${formatCurrency(order.totalPaid)} · יתרה לתשלום: ${formatCurrency(order.remainingBalance)}`);
  } else {
    lines.push("שולם במלואו");
  }
  return lines.join("\n");
}

/** A clean, chrome-free printable HTML document (user can Save as PDF). */
function buildPrintHtml(order: OrderShareData): string {
  const rows = order.items
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.name)}</td><td class="c">${item.quantity}</td><td class="l">${formatCurrency(
          item.lineTotal
        )}</td></tr>`
    )
    .join("");
  const balanceRow =
    order.remainingBalance > 0.009
      ? `<div class="row"><span>שולם</span><span>${formatCurrency(order.totalPaid)}</span></div>
         <div class="row bold"><span>יתרה לתשלום</span><span>${formatCurrency(order.remainingBalance)}</span></div>`
      : `<div class="row bold"><span>סטטוס</span><span>שולם במלואו</span></div>`;

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<title>הזמנה #${escapeHtml(order.orderNumber)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, "Segoe UI", Arial, sans-serif; color: #0A1020; margin: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: #555; font-size: 13px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0A1020; padding-bottom: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: right; padding: 8px 6px; border-bottom: 1px solid #ddd; font-size: 14px; }
  th { color: #555; font-weight: 600; }
  td.c, th.c { text-align: center; }
  td.l, th.l { text-align: left; }
  .totals { margin-top: 16px; margin-inline-start: auto; max-width: 260px; }
  .row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; }
  .row.bold { font-weight: 700; border-top: 1px solid #ddd; margin-top: 4px; padding-top: 8px; }
  @media print { body { margin: 12mm; } }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>${order.businessName ? escapeHtml(order.businessName) : "הזמנה"}</h1>
      <div class="muted">הזמנה #${escapeHtml(order.orderNumber)} · ${escapeHtml(order.orderDate)}</div>
    </div>
    <div class="muted">
      <div><strong>${escapeHtml(order.customerName)}</strong></div>
      ${order.customerPhone ? `<div>${escapeHtml(order.customerPhone)}</div>` : ""}
    </div>
  </div>
  <table>
    <thead><tr><th>פריט</th><th class="c">כמות</th><th class="l">סה"כ</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div class="row bold"><span>סה"כ הזמנה</span><span>${formatCurrency(order.totalAmount)}</span></div>
    ${balanceRow}
  </div>
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`;
}

/** The WhatsApp link for this order (null when the customer has no phone). */
export function orderShareHref(order: OrderShareData) {
  return whatsappHref(order.customerPhone, buildShareText(order));
}

/**
 * Open the printable order sheet in its own window. The share and print
 * buttons themselves live in the order page's ⋮ (OrderHeaderMenu) — they were
 * worded outline buttons of their own here (owner, 2026-10-11).
 */
export function printOrderSheet(order: OrderShareData) {
  const win = window.open("", "_blank", "width=800,height=900");
  if (!win) return;
  win.document.write(buildPrintHtml(order));
  win.document.close();
}
