import { toast } from "sonner";
import { armNativeSurfaceGuard } from "@/components/ui/native-surface";
import { toHebrewError } from "@/lib/error-messages";
import { shareFileNative } from "@/lib/native-share";
import { israelDateKey } from "@/lib/timezone";

// A table sheet as a PDF, shared from the phone or downloaded on a computer —
// the project page's "לחיוב לקוח" and "תנועות" (owner, 2026-10-11: "share a list
// of all the movements in and out … that full list in a pdf").
//
// Built in the page (html-to-image → jsPDF), no browser print dialog. Each A4
// page is captured on its own and breaks between rows: one tall capture sliced
// into pages cut rows in half, and a long list outgrew what a canvas can hold.

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatIlsForSheet(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(value);
}

export function sheetGeneratedAt() {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(new Date());
}

/**
 * A file name every file system takes, NFC so a receiving app reads the Hebrew
 * right. A straight quote (not allowed in a file name) becomes the Hebrew
 * gershayim, so "תשרי פ"ז" stays תשרי פ״ז instead of losing it.
 */
export function sheetFileName(base: string) {
  const name = base.replace(/"/g, "״").replace(/[\\/:*?<>|]/g, "").trim();
  return `${name || "BizH"}.pdf`.normalize("NFC");
}

export type TableSheet = {
  /** Above the table on the first page (a title, the project, the date). */
  headerHtml: string;
  /** The column headings — repeated at the top of every page. */
  theadHtml: string;
  /** One `<tr>…</tr>` per row. */
  rowsHtml: string[];
  /** The totals — on the last page, never alone on it. */
  tfootHtml: string;
  tableStyle: string;
};

// A4 at 96dpi. Styles are inline in the markup (no <style> block): the sheet
// is laid out inside the app document, where a stylesheet would leak.
const PAGE_WIDTH = 794;
const PAGE_HEIGHT = Math.floor((PAGE_WIDTH * 297) / 210);
const PAGE_PADDING = 40;
const NODE_STYLE = `width:${PAGE_WIDTH}px;box-sizing:border-box;padding:${PAGE_PADDING}px;background:#ffffff;color:#0A1020;font-family:system-ui,'Segoe UI',Arial,sans-serif;`;

function tableMarkup(sheet: TableSheet, rows: string[], withFoot: boolean) {
  return `<table style="${sheet.tableStyle}"><thead>${sheet.theadHtml}</thead><tbody>${rows.join("")}</tbody>${
    withFoot ? `<tfoot>${sheet.tfootHtml}</tfoot>` : ""
  }</table>`;
}

/** Rows per page, measured on the laid-out sheet. */
function paginate(node: HTMLElement, sheet: TableSheet): string[][] {
  node.innerHTML = `<div data-sheet-header>${sheet.headerHtml}</div>${tableMarkup(sheet, sheet.rowsHtml, true)}`;
  const header = node.querySelector<HTMLElement>("[data-sheet-header]")!;
  const headerHeight = header.getBoundingClientRect().height;
  const theadHeight = node.querySelector("thead")!.getBoundingClientRect().height;
  const footHeight = node.querySelector("tfoot")!.getBoundingClientRect().height;
  const rowHeights = [...node.querySelectorAll("tbody > tr")].map((row) => row.getBoundingClientRect().height);

  // 16px of slack for the header's own margin, which the measuring leaves out.
  const pageRoom = PAGE_HEIGHT - PAGE_PADDING * 2 - theadHeight - 16;
  const pages: string[][] = [[]];
  let used = headerHeight;
  rowHeights.forEach((height, index) => {
    if (used + height > pageRoom && pages[pages.length - 1].length > 0) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1].push(sheet.rowsHtml[index]);
    used += height;
  });
  // The totals go on the last page; if they don't fit there, they take that
  // page's last row with them rather than standing on a page alone.
  if (used + footHeight > pageRoom) {
    const last = pages[pages.length - 1];
    pages.push(last.length > 1 ? [last.pop()!] : []);
  }
  return pages;
}

/**
 * html-to-image's failure mode is silent: a capture that goes wrong comes back
 * all white rather than throwing, which used to ship as a blank PDF.
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

export async function renderTableSheetPdf(sheet: TableSheet): Promise<Blob> {
  // Laid out (not display:none) so it can be measured and captured, and parked
  // at the origin inside a zero-size clip — html-to-image clones a node moved
  // off-screen as off-screen INSIDE its frame and captures nothing.
  const wrapper = document.createElement("div");
  wrapper.setAttribute("aria-hidden", "true");
  wrapper.style.cssText =
    "position:fixed;top:0;left:0;width:0;height:0;overflow:hidden;opacity:0;z-index:-1;pointer-events:none;";
  const node = document.createElement("div");
  node.setAttribute("dir", "rtl");
  node.style.cssText = NODE_STYLE;
  wrapper.appendChild(node);
  document.body.appendChild(wrapper);

  try {
    if ("fonts" in document) await document.fonts.ready;
    // html-to-image, not html2canvas — that one chokes on Tailwind v4's
    // color-mix values elsewhere in the app.
    const [{ toCanvas }, { default: jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);

    const pages = paginate(node, sheet);
    const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });
    const pageWidthMm = pdf.internal.pageSize.getWidth();

    for (let index = 0; index < pages.length; index++) {
      const last = index === pages.length - 1;
      node.innerHTML = `${index === 0 ? sheet.headerHtml : ""}${tableMarkup(sheet, pages[index], last)}`;
      const canvas = await toCanvas(node, {
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        backgroundColor: "#ffffff",
        skipFonts: true,
        width: node.offsetWidth,
        height: node.offsetHeight,
      });
      if (isBlankCapture(canvas)) throw new Error("יצירת ה-PDF נכשלה: הדף שנוצר יצא ריק. נסו שוב.");
      if (index > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, pageWidthMm, (canvas.height * pageWidthMm) / canvas.width);
    }
    return pdf.output("blob");
  } finally {
    wrapper.remove();
  }
}

/**
 * The name a SHARED file goes out under: Latin letters, digits and dashes only
 * — "BizH-movements-2026-10-11.pdf". A Hebrew file name reached WhatsApp
 * garbled ("×—×™×•×‘ ×œ×§×•×—.pdf") when shared from the computer as well as from
 * the phone (owner, 2026-10-11), while the message text beside it read fine —
 * so the Hebrew rides in that text (the share's title) and the name stays
 * plain. A download keeps its Hebrew name: saving a file names it correctly.
 */
export function shareSafeFileName(kind: string) {
  return `BizH-${kind}-${israelDateKey()}.pdf`;
}

/**
 * Hand the PDF on: the phone's own share sheet in the Android app, the
 * browser's share sheet where it has one (phones, and Chrome on a computer),
 * else a download.
 */
export async function sharePdfFile({
  blob,
  fileName,
  shareFileName,
  title,
}: {
  blob: Blob;
  /** For a download — may be Hebrew. */
  fileName: string;
  /** For a share — plain letters only (shareSafeFileName). */
  shareFileName: string;
  title: string;
}) {
  const native = await shareFileNative(blob, shareFileName, title, title);
  if (native !== "unavailable") return;

  const file = new File([blob], shareFileName, { type: "application/pdf" });
  const shareData = { title, text: title, files: [file] };
  if (typeof navigator !== "undefined" && "share" in navigator && "canShare" in navigator && navigator.canShare(shareData)) {
    try {
      // The OS share sheet is drawn over the page, and dismissing it hands the
      // tap back down — see components/ui/native-surface.ts.
      armNativeSurfaceGuard();
      await navigator.share(shareData);
    } catch (error: unknown) {
      // The user dismissed the share sheet — not a failure.
      if (error instanceof Error && error.name === "AbortError") return;
      throw error;
    }
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  toast.success(`ה-PDF נשמר בשם ${fileName}`);
}

/** Build and share in one go, with the app's error toast. */
export async function shareTableSheet(
  sheet: TableSheet,
  names: { fileName: string; shareFileName: string },
  title: string
) {
  try {
    const blob = await renderTableSheetPdf(sheet);
    await sharePdfFile({ blob, ...names, title });
  } catch (error: unknown) {
    toast.error(toHebrewError(error, "יצירת ה-PDF נכשלה."));
  }
}
