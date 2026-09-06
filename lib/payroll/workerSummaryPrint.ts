/**
 * The "סיכום עבודה ותשלומים לעובד" report — one shared template for two
 * callers: the admin salary center (any worker, filterable by project/month)
 * and a worker's own profile (their own data, scoped to one month). Both must
 * render byte-identical output, so the HTML/CSS/pagination logic lives here
 * ONCE rather than being duplicated per caller.
 *
 * Callers build their own `headerHtml` (the hero name/phone/scope block + the
 * 3 summary cards) and table row HTML — the business logic that produces
 * those numbers differs per caller (project cost-sharing for admin, none for
 * a single worker) — and hand them to the functions below.
 */

/** Content-only CSS: the classes both the print document and an off-screen
 * capture use. Pagination-specific rules (`.page`, `@page`) are NOT here —
 * they only make sense inside a real print document, never a flat capture. */
export const WORKER_SUMMARY_CONTENT_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; color: #1D2848; direction: rtl; }
  h1, h2, h3, p { margin: 0; }
  .hero-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  .hero-table th, .hero-table td { border: 1px solid #BAE6FD; padding: 12px 14px; text-align: right; }
  .hero-table th { background: #E0F2FE; font-size: 22px; font-weight: 800; }
  .hero-table td { background: #ffffff; }
  .worker-name { font-size: 24px; font-weight: 800; }
  .worker-phone { margin-top: 6px; font-size: 18px; font-weight: 700; }
  .subtle { color: #0369A1; font-size: 12px; margin-top: 6px; }
  .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 14px 0 18px; }
  .card { border: 1px solid #BAE6FD; border-radius: 12px; padding: 12px; }
  .label { color: #0369A1; font-size: 12px; margin-bottom: 8px; }
  .value { font-size: 18px; font-weight: 700; }
  .section-title { margin: 6px 0 0; font-size: 16px; }
  table.data { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
  table.data th, table.data td { border: 1px solid #BAE6FD; padding: 8px 10px; text-align: right; vertical-align: top; }
  table.data th { background: #E0F2FE; }
  .empty { margin-top: 12px; border: 1px dashed #BAE6FD; border-radius: 12px; padding: 12px; color: #0369A1; }
`;

export const PAGINATION_CSS = `
  @page { size: A4; margin: 10mm; }
  .page {
    position: relative;
    height: 277mm;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
  }
  .page:last-child { page-break-after: avoid; break-after: avoid; }
  .page-content { height: calc(277mm - 14mm); overflow: hidden; }
  .page-footer {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 14mm;
    display: flex;
    align-items: center;
    justify-content: center;
    border-top: 1px solid #BAE6FD;
    color: #0369A1;
    font-size: 12px;
    font-weight: 700;
  }
`;

export type WorkerSummaryPrintTable = {
  title: string;
  /** Raw `<th>...</th>` HTML. */
  headers: string;
  /** Raw `<tr>...</tr>` HTML, one entry per row. */
  rows: string[];
  /** Shown instead of the table when `rows` is empty. */
  empty: string;
};

export function escapeSummaryHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * A full, paginated, chrome-free print document. Each table starts on its
 * own page set; every page repeats `headerHtml` and shows "עמוד X מתוך Y".
 * The inline script measures the rendered rows and breaks pages so nothing
 * is clipped — it runs inside the print window's OWN document, so it must be
 * plain, dependency-free JS (no closures over this module's scope).
 */
export function buildWorkerSummaryPrintDocument(params: {
  docTitle: string;
  headerHtml: string;
  tables: WorkerSummaryPrintTable[];
}): string {
  const printData = { headerHtml: params.headerHtml, tables: params.tables };
  const printDataJson = JSON.stringify(printData).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="he" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <title>${escapeSummaryHtml(params.docTitle)}</title>
    <style>
${WORKER_SUMMARY_CONTENT_CSS}
${PAGINATION_CSS}
    </style>
  </head>
  <body>
    <div id="pages"></div>
    <script>window.__PRINT_DATA__ = ${printDataJson};</script>
    <script>
      (function () {
        var data = window.__PRINT_DATA__;
        var root = document.getElementById("pages");
        var pages = [];

        function makePage() {
          var page = document.createElement("div");
          page.className = "page";
          var content = document.createElement("div");
          content.className = "page-content";
          var footer = document.createElement("div");
          footer.className = "page-footer";
          footer.innerHTML = 'עמוד <span class="pnum"></span> מתוך <span class="ptot"></span>';
          page.appendChild(content);
          page.appendChild(footer);
          root.appendChild(page);
          pages.push(page);
          return content;
        }

        function addHeader(content) {
          var wrap = document.createElement("div");
          wrap.innerHTML = data.headerHtml;
          content.appendChild(wrap);
        }

        function addTitle(content, text) {
          var heading = document.createElement("h2");
          heading.className = "section-title";
          heading.textContent = text;
          content.appendChild(heading);
        }

        function makeTable(content, headers) {
          var table = document.createElement("table");
          table.className = "data";
          table.innerHTML = "<thead><tr>" + headers + "</tr></thead><tbody></tbody>";
          content.appendChild(table);
          return table.querySelector("tbody");
        }

        function overflowing(content) {
          return content.scrollHeight > content.clientHeight;
        }

        data.tables.forEach(function (table) {
          var content = makePage();
          addHeader(content);
          addTitle(content, table.title);

          if (!table.rows.length) {
            var empty = document.createElement("div");
            empty.className = "empty";
            empty.textContent = table.empty;
            content.appendChild(empty);
            return;
          }

          var tbody = makeTable(content, table.headers);

          table.rows.forEach(function (rowHtml) {
            tbody.insertAdjacentHTML("beforeend", rowHtml);
            if (overflowing(content) && tbody.children.length > 1) {
              tbody.removeChild(tbody.lastElementChild);
              content = makePage();
              addHeader(content);
              addTitle(content, table.title + " (המשך)");
              tbody = makeTable(content, table.headers);
              tbody.insertAdjacentHTML("beforeend", rowHtml);
            }
          });
        });

        var total = pages.length;
        pages.forEach(function (page, index) {
          page.querySelector(".pnum").textContent = String(index + 1);
          page.querySelector(".ptot").textContent = String(total);
        });
      })();
    </script>
  </body>
</html>`;
}

/** Opens the document in a new window and triggers the print dialog once it's loaded. */
export function openWorkerSummaryPrintWindow(html: string) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return null;
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => {
    printWindow.setTimeout(() => {
      printWindow.print();
    }, 250);
  };
  return printWindow;
}

/**
 * Same row-overflow pagination as the print document above (one `<tr>` at a
 * time, moved to a fresh page the moment it overflows), but building real DOM
 * nodes inside `container` instead of a JS string destined for a foreign
 * print-window document. Used off-screen ahead of a per-page canvas capture,
 * so every PDF page boundary lands between rows instead of through one —
 * `container` must already have `WORKER_SUMMARY_CONTENT_CSS` and
 * `PAGINATION_CSS` in effect (e.g. via an injected `<style>`), since the
 * overflow check depends on `.page-content`'s CSS height actually clamping.
 */
export function buildWorkerSummaryPages(
  container: HTMLElement,
  params: { headerHtml: string; tables: WorkerSummaryPrintTable[] }
): HTMLDivElement[] {
  const pages: HTMLDivElement[] = [];

  function makePage() {
    const page = document.createElement("div");
    page.className = "page";
    const content = document.createElement("div");
    content.className = "page-content";
    page.appendChild(content);
    container.appendChild(page);
    pages.push(page);
    return content;
  }

  function addHeader(content: HTMLElement) {
    const wrap = document.createElement("div");
    wrap.innerHTML = params.headerHtml;
    content.appendChild(wrap);
  }

  function addTitle(content: HTMLElement, text: string) {
    const heading = document.createElement("h2");
    heading.className = "section-title";
    heading.textContent = text;
    content.appendChild(heading);
  }

  function makeTable(content: HTMLElement, headers: string) {
    const table = document.createElement("table");
    table.className = "data";
    table.innerHTML = `<thead><tr>${headers}</tr></thead><tbody></tbody>`;
    content.appendChild(table);
    return table.querySelector("tbody")!;
  }

  function overflowing(content: HTMLElement) {
    return content.scrollHeight > content.clientHeight;
  }

  params.tables.forEach((table) => {
    let content = makePage();
    addHeader(content);
    addTitle(content, table.title);

    if (!table.rows.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = table.empty;
      content.appendChild(empty);
      return;
    }

    let tbody = makeTable(content, table.headers);

    table.rows.forEach((rowHtml) => {
      tbody.insertAdjacentHTML("beforeend", rowHtml);
      if (overflowing(content) && tbody.children.length > 1) {
        tbody.removeChild(tbody.lastElementChild!);
        content = makePage();
        addHeader(content);
        addTitle(content, `${table.title} (המשך)`);
        tbody = makeTable(content, table.headers);
        tbody.insertAdjacentHTML("beforeend", rowHtml);
      }
    });
  });

  const total = pages.length;
  pages.forEach((page, index) => {
    const footer = document.createElement("div");
    footer.className = "page-footer";
    footer.textContent = `עמוד ${index + 1} מתוך ${total}`;
    page.appendChild(footer);
  });

  return pages;
}
