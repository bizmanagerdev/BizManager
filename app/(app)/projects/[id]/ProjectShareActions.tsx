"use client";

import { Printer, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { whatsappHref } from "@/lib/whatsapp";

export type ProjectShareData = {
  projectName: string;
  customerName: string;
  customerPhone: string | null;
  businessName?: string | null;
  statusLabel: string;
  typeLabel: string;
  dateRange: string | null;
  managerName: string | null;
  origin: string | null;
  destination: string | null;
  itemsToMove: string[];
  notes: string | null;
  /** Null for viewers who may not see money. */
  money: { total: number; paid: number; balance: number } | null;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain-text project summary for WhatsApp — the job first, the money last. */
function buildShareText(project: ProjectShareData): string {
  const lines: string[] = [];
  if (project.businessName) lines.push(project.businessName);
  lines.push(`פרויקט: ${project.projectName}`);
  lines.push(`לקוח: ${project.customerName}`);
  lines.push(`סוג: ${project.typeLabel} · סטטוס: ${project.statusLabel}`);
  if (project.dateRange) lines.push(`תאריכים: ${project.dateRange}`);
  if (project.managerName) lines.push(`מנהל פרויקט: ${project.managerName}`);
  if (project.origin) lines.push(`מוצא: ${project.origin}`);
  if (project.destination) lines.push(`יעד: ${project.destination}`);
  if (project.itemsToMove.length > 0) {
    lines.push("");
    lines.push("פריטים להעברה:");
    for (const item of project.itemsToMove) lines.push(`• ${item}`);
  }
  if (project.notes) {
    lines.push("");
    lines.push(`הערות: ${project.notes}`);
  }
  if (project.money) {
    lines.push("");
    lines.push(`סה"כ: ${formatCurrency(project.money.total)}`);
    if (project.money.balance > 0.009) {
      lines.push(
        `שולם: ${formatCurrency(project.money.paid)} · יתרה לתשלום: ${formatCurrency(project.money.balance)}`
      );
    } else {
      lines.push("שולם במלואו");
    }
  }
  return lines.join("\n");
}

/** A clean, chrome-free printable HTML document (user can Save as PDF). */
function buildPrintHtml(project: ProjectShareData): string {
  const detailRows = [
    { label: "לקוח", value: project.customerName },
    { label: "טלפון", value: project.customerPhone ?? "" },
    { label: "סוג פרויקט", value: project.typeLabel },
    { label: "סטטוס", value: project.statusLabel },
    { label: "תאריכים", value: project.dateRange ?? "" },
    { label: "מנהל פרויקט", value: project.managerName ?? "" },
    { label: "מוצא", value: project.origin ?? "" },
    { label: "יעד", value: project.destination ?? "" },
  ]
    .filter((row) => row.value.trim())
    .map(
      (row) =>
        `<tr><th>${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`
    )
    .join("");

  const itemsBlock =
    project.itemsToMove.length > 0
      ? `<h2>פריטים להעברה</h2><ul>${project.itemsToMove
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join("")}</ul>`
      : "";

  const notesBlock = project.notes
    ? `<h2>הערות</h2><p>${escapeHtml(project.notes).replace(/\n/g, "<br />")}</p>`
    : "";

  const moneyBlock = project.money
    ? `<div class="totals">
         <div class="row bold"><span>סה"כ פרויקט</span><span>${formatCurrency(project.money.total)}</span></div>
         ${
           project.money.balance > 0.009
             ? `<div class="row"><span>שולם</span><span>${formatCurrency(project.money.paid)}</span></div>
                <div class="row bold"><span>יתרה לתשלום</span><span>${formatCurrency(project.money.balance)}</span></div>`
             : `<div class="row bold"><span>סטטוס</span><span>שולם במלואו</span></div>`
         }
       </div>`
    : "";

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(project.projectName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, "Segoe UI", Arial, sans-serif; color: #0A1020; margin: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 20px 0 6px; }
  .muted { color: #555; font-size: 13px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0A1020; padding-bottom: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: right; padding: 8px 6px; border-bottom: 1px solid #ddd; font-size: 14px; }
  th { color: #555; font-weight: 600; width: 140px; }
  ul { margin: 6px 0; padding-inline-start: 18px; font-size: 14px; }
  li { padding: 2px 0; }
  p { font-size: 14px; }
  .totals { margin-top: 16px; margin-inline-start: auto; max-width: 260px; }
  .row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; }
  .row.bold { font-weight: 700; border-top: 1px solid #ddd; margin-top: 4px; padding-top: 8px; }
  @media print { body { margin: 12mm; } }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>${escapeHtml(project.projectName)}</h1>
      <div class="muted">${project.businessName ? escapeHtml(project.businessName) : "פרויקט"}</div>
    </div>
    <div class="muted">
      <div><strong>${escapeHtml(project.customerName)}</strong></div>
      ${project.customerPhone ? `<div>${escapeHtml(project.customerPhone)}</div>` : ""}
    </div>
  </div>
  <table><tbody>${detailRows}</tbody></table>
  ${itemsBlock}
  ${notesBlock}
  ${moneyBlock}
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`;
}

/** The WhatsApp link for this project (null when the customer has no phone). */
export function projectShareHref(project: ProjectShareData) {
  return whatsappHref(project.customerPhone, buildShareText(project));
}

/** Open the printable project sheet in its own window. */
export function printProjectSheet(project: ProjectShareData) {
  const win = window.open("", "_blank", "width=800,height=900");
  if (!win) return;
  win.document.write(buildPrintHtml(project));
  win.document.close();
}

/**
 * שיתוף / הדפסה for a project — the same pair the order page carries, so both
 * entities offer the same actions in the same order.
 */
export default function ProjectShareActions({ project }: { project: ProjectShareData }) {
  const waHref = projectShareHref(project);

  function handlePrint() {
    printProjectSheet(project);
  }

  return (
    <>
      {waHref ? (
        <Button asChild size="sm" variant="outline" className="h-9">
          <a href={waHref} target="_blank" rel="noreferrer" title="שיתוף ללקוח בוואטסאפ">
            <Share2 className="h-4 w-4" />
            <span>שיתוף</span>
          </a>
        </Button>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-9"
        onClick={handlePrint}
        title="הדפסה / PDF"
      >
        <Printer className="h-4 w-4" />
        <span>הדפסה</span>
      </Button>
    </>
  );
}
