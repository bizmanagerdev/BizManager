"use client";

import { useState } from "react";
import { ShareIcon, SpinnerIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { getStatusLabel } from "@/lib/ui/status-colors";
import type { LedgerSortBy, LedgerSortDirection } from "@/lib/projectLedgerPrefs";
import { escapeHtml, sheetFileName, shareSafeFileName, shareTableSheet, type TableSheet } from "@/lib/share-pdf";
import { SHEET_STYLES as S, sheetHeaderHtml } from "./BilledCustomerPrintButton";
import { sortMovements, type Movement } from "./ProjectMovements";
import { formatDate, formatIls } from "./ProjectTabsClient.helpers";

// The project's whole תנועות card as a PDF (owner, 2026-10-11: "share a list of
// all the movements in and out, basically that full list in a pdf"): every
// payment in and every expense and wage out, in the card's own order, with the
// same columns it shows on a computer and the totals that close it.

const thEnd = `${S.thAmount}width:84px;`;
const tdEnd = S.tdAmount;
const muted = "color:#555;font-size:11px;";

function statusText(movement: Movement) {
  if (!movement.status) return "";
  if (movement.status === "not_due" && movement.dueDate) return `צפוי ${formatDate(movement.dueDate)}`;
  return getStatusLabel("payment", movement.status);
}

function rowHtml(movement: Movement) {
  const what = [movement.category, movement.name].filter(Boolean).join(" — ");
  const amount = formatIls(movement.amount);
  return `<tr>
    <td style="${S.tdDate}">${escapeHtml(formatDate(movement.date))}</td>
    <td style="${S.td}">${escapeHtml(what)}${movement.hint ? `<div style="${muted}">${escapeHtml(movement.hint)}</div>` : ""}</td>
    <td style="${S.td}">${escapeHtml(statusText(movement))}</td>
    <td style="${S.td}">${escapeHtml(movement.account ?? "")}</td>
    <td style="${tdEnd}">${movement.billed && movement.billedAmount !== null ? formatIls(movement.billedAmount) : ""}</td>
    <td style="${tdEnd}color:#15803d;">${movement.direction === "in" ? amount : ""}</td>
    <td style="${tdEnd}color:#b91c1c;">${movement.direction === "out" ? amount : ""}</td>
  </tr>`;
}

function buildSheet(
  movements: Movement[],
  sortBy: LedgerSortBy,
  sortDirection: LedgerSortDirection,
  projectName: string,
  customerName: string | null
): TableSheet {
  const totals = movements.reduce(
    (acc, m) => {
      if (m.amount !== null) {
        if (m.direction === "in") acc.in += m.amount;
        else acc.out += m.amount;
      }
      if (m.billedAmount !== null) acc.billed += m.billedAmount;
      return acc;
    },
    { in: 0, out: 0, billed: 0 }
  );
  return {
    headerHtml: sheetHeaderHtml(`תנועות · ${movements.length}`, projectName, customerName),
    theadHtml: `<tr>
      <th style="${S.thDate}">תאריך</th><th style="${S.th}">פירוט</th><th style="${S.th}">סטטוס</th><th style="${S.th}">חשבון</th>
      <th style="${thEnd}">לחיוב לקוח</th><th style="${thEnd}">נכנס</th><th style="${thEnd}">יוצא</th>
    </tr>`,
    rowsHtml: sortMovements(movements, sortBy, sortDirection).map(rowHtml),
    tfootHtml: `<tr>
      <td style="${S.footLabel}" colspan="4">סה״כ</td>
      <td style="${S.footAmount}">${formatIls(totals.billed)}</td>
      <td style="${S.footAmount}color:#15803d;">${formatIls(totals.in)}</td>
      <td style="${S.footAmount}color:#b91c1c;">${formatIls(totals.out)}</td>
    </tr>
    <tr>
      <td style="${S.td}border-bottom:0;font-weight:700;" colspan="5">נכנס פחות יוצא</td>
      <td style="${tdEnd}border-bottom:0;font-weight:700;" colspan="2">${formatIls(totals.in - totals.out)}</td>
    </tr>`,
    tableStyle: S.table,
  };
}

export default function ProjectMovementsPdfButton({
  movements,
  sortBy,
  sortDirection,
  projectName,
  customerName,
}: {
  movements: Movement[];
  sortBy: LedgerSortBy;
  sortDirection: LedgerSortDirection;
  projectName: string;
  customerName: string | null;
}) {
  const [building, setBuilding] = useState(false);

  async function handlePdf() {
    if (building) return;
    setBuilding(true);
    try {
      const title = customerName ? `תנועות — ${projectName} · ${customerName}` : `תנועות — ${projectName}`;
      await shareTableSheet(
        buildSheet(movements, sortBy, sortDirection, projectName, customerName),
        { fileName: sheetFileName(`תנועות - ${projectName}`), shareFileName: shareSafeFileName("movements") },
        title
      );
    } finally {
      setBuilding(false);
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-auto min-h-8 whitespace-normal px-2 py-1.5 text-xs"
      onClick={() => void handlePdf()}
      disabled={building}
      title="שיתוף כל התנועות — נכנס ויוצא (PDF)"
    >
      {building ? <SpinnerIcon className="h-4 w-4 shrink-0 animate-spin" /> : <ShareIcon className="h-4 w-4 shrink-0" />}
      תנועות
    </Button>
  );
}
