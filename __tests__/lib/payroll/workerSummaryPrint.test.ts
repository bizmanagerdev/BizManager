// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  escapeSummaryHtml,
  buildWorkerSummaryPrintDocument,
  buildWorkerSummaryPages,
  type WorkerSummaryPrintTable,
} from "@/lib/payroll/workerSummaryPrint";

describe("escapeSummaryHtml", () => {
  it("escapes every HTML-significant character", () => {
    expect(escapeSummaryHtml(`<b>"quote" & 'apos'</b>`)).toBe(
      "&lt;b&gt;&quot;quote&quot; &amp; &#39;apos&#39;&lt;/b&gt;"
    );
  });
  it("plain Hebrew text passes through unchanged", () => {
    expect(escapeSummaryHtml("יעקב הלר")).toBe("יעקב הלר");
  });
});

describe("buildWorkerSummaryPrintDocument", () => {
  const table: WorkerSummaryPrintTable = {
    title: "משמרות",
    headers: "<th>תאריך</th>",
    rows: ["<tr><td>01/01</td></tr>"],
    empty: "אין משמרות",
  };

  it("escapes the document title (defense against an attacker-controlled worker name)", () => {
    const html = buildWorkerSummaryPrintDocument({
      docTitle: `<script>alert(1)</script>`,
      headerHtml: "<div>header</div>",
      tables: [table],
    });
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("embeds the header/table data as JSON, with '<' escaped so a value can't prematurely close the <script> tag", () => {
    const evilTable: WorkerSummaryPrintTable = {
      ...table,
      rows: ["<tr><td></script><script>alert(2)</script></td></tr>"],
    };
    const html = buildWorkerSummaryPrintDocument({
      docTitle: "דוח",
      headerHtml: "<div>header</div>",
      tables: [evilTable],
    });
    expect(html).not.toContain("</script><script>alert(2)");
    // Only '<' is escaped (to \u003c) — '>' is left as-is, which is enough to
    // stop a browser HTML parser from treating this as a real closing tag.
    expect(html).toContain("\\u003c/script>\\u003cscript>alert(2)\\u003c/script>");
  });

  it("is a full, well-formed RTL Hebrew HTML document", () => {
    const html = buildWorkerSummaryPrintDocument({
      docTitle: "דוח",
      headerHtml: "<div>x</div>",
      tables: [table],
    });
    expect(html).toContain('<html lang="he" dir="rtl">');
    expect(html).toContain('<div id="pages"></div>');
  });
});

describe("buildWorkerSummaryPages (DOM version, no page-split forced)", () => {
  it("renders one page per table, with the header, title, and every row", () => {
    const container = document.createElement("div");
    const table: WorkerSummaryPrintTable = {
      title: "משמרות",
      headers: "<th>תאריך</th>",
      rows: ["<tr><td>01/01</td></tr>", "<tr><td>02/01</td></tr>"],
      empty: "אין משמרות",
    };
    const pages = buildWorkerSummaryPages(container, { headerHtml: "<div>כותרת</div>", tables: [table] });

    expect(pages).toHaveLength(1);
    expect(pages[0].querySelector(".section-title")?.textContent).toBe("משמרות");
    expect(pages[0].querySelectorAll("tbody tr")).toHaveLength(2);
    expect(pages[0].textContent).toContain("כותרת");
  });

  it("shows the 'empty' text instead of a table when there are no rows", () => {
    const container = document.createElement("div");
    const table: WorkerSummaryPrintTable = {
      title: "משמרות",
      headers: "<th>תאריך</th>",
      rows: [],
      empty: "אין משמרות החודש",
    };
    const pages = buildWorkerSummaryPages(container, { headerHtml: "", tables: [table] });

    expect(pages[0].querySelector("table")).toBeNull();
    expect(pages[0].querySelector(".empty")?.textContent).toBe("אין משמרות החודש");
  });

  it("labels every page 'עמוד X מתוך Y' against the true final page count", () => {
    const container = document.createElement("div");
    const tables: WorkerSummaryPrintTable[] = [
      { title: "א", headers: "<th>x</th>", rows: ["<tr><td>1</td></tr>"], empty: "-" },
      { title: "ב", headers: "<th>x</th>", rows: ["<tr><td>1</td></tr>"], empty: "-" },
    ];
    const pages = buildWorkerSummaryPages(container, { headerHtml: "", tables });

    expect(pages).toHaveLength(2);
    expect(pages[0].querySelector(".page-footer")?.textContent).toBe("עמוד 1 מתוך 2");
    expect(pages[1].querySelector(".page-footer")?.textContent).toBe("עמוד 2 מתוך 2");
  });

  it("appends every page directly into the given container, in order", () => {
    const container = document.createElement("div");
    const tables: WorkerSummaryPrintTable[] = [
      { title: "א", headers: "<th>x</th>", rows: ["<tr><td>1</td></tr>"], empty: "-" },
      { title: "ב", headers: "<th>x</th>", rows: ["<tr><td>1</td></tr>"], empty: "-" },
    ];
    buildWorkerSummaryPages(container, { headerHtml: "", tables });
    expect(container.children).toHaveLength(2);
    expect(container.children[0].querySelector(".section-title")?.textContent).toBe("א");
    expect(container.children[1].querySelector(".section-title")?.textContent).toBe("ב");
  });
});

describe("buildWorkerSummaryPages — page-splitting when content overflows", () => {
  it("starts a continuation page (title + \"(המשך)\") once a row no longer fits", () => {
    const container = document.createElement("div");
    const table: WorkerSummaryPrintTable = {
      title: "משמרות",
      headers: "<th>x</th>",
      rows: ["<tr><td>1</td></tr>", "<tr><td>2</td></tr>", "<tr><td>3</td></tr>"],
      empty: "-",
    };

    // jsdom never actually lays out content (scrollHeight/clientHeight are
    // always 0), so the function's own overflow check can't fire on its own —
    // force it: report "overflowing" once 2+ rows are in the current tbody.
    let callIndex = 0;
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        callIndex += 1;
        // Every page-content div queried after the 2nd row lands reports overflow.
        return this.querySelectorAll("tbody tr").length >= 2 ? 100 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 50,
    });

    try {
      const pages = buildWorkerSummaryPages(container, { headerHtml: "", tables: [table] });
      expect(pages.length).toBeGreaterThan(1);
      expect(pages[1].querySelector(".section-title")?.textContent).toBe("משמרות (המשך)");
      // No row was dropped across the split.
      const totalRows = pages.reduce((n, p) => n + p.querySelectorAll("tbody tr").length, 0);
      expect(totalRows).toBe(3);
    } finally {
      // @ts-expect-error - restoring jsdom's own descriptor for later tests in this file
      delete HTMLElement.prototype.scrollHeight;
      // @ts-expect-error - restoring jsdom's own descriptor for later tests in this file
      delete HTMLElement.prototype.clientHeight;
      void callIndex;
    }
  });
});
