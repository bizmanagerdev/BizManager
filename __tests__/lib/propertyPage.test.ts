import { describe, expect, it } from "vitest";
import { mergePropertyPage, type PropertyPageCore, type PropertyServerParts } from "@/lib/properties";

// A property's page is its core (what the device copy also holds) with the
// server's part: the documents, every file's link, the leases' signed
// agreements and the recurring bills (lib/properties.ts).

const core = {
  property: {
    id: "p1",
    name: "D4 הר יונה",
    leases: [
      { id: "l1", documentId: "doc-1", documentFileName: null, documentUrl: null },
      { id: "l0", documentId: null, documentFileName: null, documentUrl: null },
    ],
  },
  activity: {
    expenses: [{ id: "e1", attachments: [] }],
    payments: [{ id: "pay1", attachments: [] }],
    documents: [],
    tasks: [],
    recurringTemplates: [],
    sessions: [],
    sessionAttachments: {},
    accountNames: {},
    templateNames: { t1: "משכנתא" },
    rollup: { totalExpenseAmount: 0, paidExpenseAmount: 0, expectedExpenseAmount: 0, totalIncomeAmount: 0 },
  },
  users: [],
  salaryAgreements: [],
} as unknown as PropertyPageCore;

const file = (name: string) => ({ document_id: name, file_name: `${name}.jpg`, storage_key: name, uploaded_at: null, document_type: null, url: `https://x/${name}` });

const parts: PropertyServerParts = {
  leaseFiles: { "doc-1": { fileName: "חוזה.pdf", url: "https://x/lease" } },
  documents: [{ id: "d1", title: "נסח", fileName: "nesach.pdf", documentType: "נסח טאבו", uploadedAt: null, url: "https://x/d1" }],
  files: { expense: { e1: [file("receipt")] }, payment: { pay1: [file("check")] }, session: { s1: [file("shift")] } },
  recurringTemplates: [{ id: "t1", templateName: "משכנתא" } as PropertyServerParts["recurringTemplates"][number]],
};

describe("a property's page: the core and the server's part", () => {
  it("before the server's part: the core as it is", () => {
    const page = mergePropertyPage(core, null);
    expect(page.property).toBe(core.property);
    expect(page.activity).toBe(core.activity);
  });

  it("with it: the lease's agreement, the documents, each row's files and the bills", () => {
    const page = mergePropertyPage(core, parts);
    expect(page.property.leases.map((l) => [l.id, l.documentFileName, l.documentUrl])).toEqual([
      ["l1", "חוזה.pdf", "https://x/lease"],
      ["l0", null, null],
    ]);
    expect(page.activity.expenses[0].attachments.map((f) => f.file_name)).toEqual(["receipt.jpg"]);
    expect(page.activity.payments[0].attachments.map((f) => f.file_name)).toEqual(["check.jpg"]);
    expect(Object.keys(page.activity.sessionAttachments)).toEqual(["s1"]);
    expect(page.activity.documents.map((d) => d.id)).toEqual(["d1"]);
    expect(page.activity.recurringTemplates.map((t) => t.id)).toEqual(["t1"]);
    // The core's own reading stays as it was.
    expect(page.activity.templateNames).toEqual({ t1: "משכנתא" });
  });
});
