"use client";

import { useState } from "react";
import { ShareIcon, SpinnerIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import {
  escapeHtml,
  sheetFileName,
  sheetGeneratedAt,
  shareSafeFileName,
  shareTableSheet,
  type TableSheet,
} from "@/lib/share-pdf";
// The page's own ₪-first amounts (owner, 2026-10-11: money written the
// dashboard way).
import { formatIls } from "./ProjectTabsClient.helpers";

// Compact sheet for the "לחיוב לקוח" card: one line per charge
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

// Inline styles on every element: the sheet is laid out inside the app
// document (lib/share-pdf.ts), where a stylesheet would leak into the app.
export const SHEET_STYLES = {
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
const S = SHEET_STYLES;

/** The sheet's title block: the sheet's name, the project · customer, when it was made. */
export function sheetHeaderHtml(title: string, projectName: string, customerName: string | null) {
  return `<div style="${S.head}">
    <div>
      <div style="${S.h1}">${escapeHtml(title)}</div>
      <div style="${S.muted}">${escapeHtml(projectName)}${customerName ? ` · ${escapeHtml(customerName)}` : ""}</div>
    </div>
    <div style="${S.muted}">הופק ב־${escapeHtml(sheetGeneratedAt())}</div>
  </div>`;
}

function buildSheet(data: BilledPrintData): TableSheet {
  return {
    headerHtml: sheetHeaderHtml("לחיוב לקוח", data.projectName, data.customerName),
    theadHtml: `<tr><th style="${S.thDate}">תאריך</th><th style="${S.th}">פירוט</th><th style="${S.thAmount}">סכום</th></tr>`,
    rowsHtml: data.rows.map(
      (row) =>
        `<tr><td style="${S.tdDate}">${escapeHtml(row.date)}</td><td style="${S.td}">${escapeHtml(row.title)}</td><td style="${S.tdAmount}">${formatIls(row.amount)}</td></tr>`
    ),
    tfootHtml: `<tr><td style="${S.footLabel}" colspan="2">סה״כ לחיוב לקוח</td><td style="${S.footAmount}">${formatIls(data.total)}</td></tr>`,
    tableStyle: S.table,
  };
}

export default function BilledCustomerPrintButton({ data }: { data: BilledPrintData }) {
  const [building, setBuilding] = useState(false);

  async function handlePdf() {
    if (building) return;
    setBuilding(true);
    try {
      const title = data.customerName
        ? `לחיוב לקוח — ${data.projectName} · ${data.customerName}`
        : `לחיוב לקוח — ${data.projectName}`;
      await shareTableSheet(
        buildSheet(data),
        {
          fileName: sheetFileName(`לחיוב לקוח - ${data.projectName}`),
          shareFileName: shareSafeFileName("customer-charges"),
        },
        title
      );
    } finally {
      setBuilding(false);
    }
  }

  return (
    // Labelled like the buttons beside it — a share glyph alone doesn't say
    // WHAT gets shared.
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-auto min-h-8 whitespace-normal px-2 py-1.5 text-xs"
      onClick={() => void handlePdf()}
      disabled={building}
      title="שיתוף לחיוב לקוח (PDF)"
    >
      {building ? <SpinnerIcon className="h-4 w-4 shrink-0 animate-spin" /> : <ShareIcon className="h-4 w-4 shrink-0" />}
      לחיוב לקוח
    </Button>
  );
}
