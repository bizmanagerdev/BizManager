// ────────────────────────────────────────────────────────────────────────────
// EVERY way a document can be attached to something.
//
// WHY THIS FILE EXISTS
// `document_links` is the polymorphic join and the obvious answer, but it is
// NOT the only one: five other tables point AT a document with a plain foreign
// key. Code that asks "is this document filed?" by looking only at
// document_links quietly reports those as unattached — which is how vehicle
// cover photos, imported statements and signed leases all ended up under
// "ללא שיוך" while their owner sat one join away.
//
// That bug was found and fixed three separate times, once per table, because
// nothing named the full set. This registry is the full set. `__tests__/documents/
// document-owners.test.ts` scans the migrations for every foreign key that
// references documents(id) and fails if one is missing from here — so the NEXT
// table to point at documents breaks a test instead of silently producing
// orphans in the archive.
//
// Adding a new owner: add the row here, then teach app/(app)/documents/page.tsx
// how to turn it into a link. The test tells you the first part; the archive
// tells you the second.
// ────────────────────────────────────────────────────────────────────────────

export type DocumentOwnerSource = {
  /** The table holding the foreign key. */
  table: string;
  /** The column on that table pointing at documents(id). */
  column: string;
  /** What the document belongs to, in human terms. */
  note: string;
  /** Whether app/(app)/documents/page.tsx turns it into a linked entity. A
   *  false here is a KNOWN gap, not an oversight — say why in `note`. */
  resolved: boolean;
};

export const DOCUMENT_FK_OWNERS: DocumentOwnerSource[] = [
  {
    table: "vehicles",
    column: "photo_document_id",
    note: "A vehicle's cover photo. Resolved to the vehicle's tag, and merged into the document's tags so grouping and the רכבים facet both see it.",
    resolved: true,
  },
  {
    table: "card_statements",
    column: "document_id",
    note: "An imported credit-card statement.",
    resolved: true,
  },
  {
    table: "bank_statements",
    column: "document_id",
    note: "An imported bank statement — a separate table from card_statements.",
    resolved: true,
  },
  {
    table: "lease_agreements",
    column: "document_id",
    note: "A signed lease. Resolved to the property it is for.",
    resolved: true,
  },
  {
    table: "morning_documents",
    column: "document_id",
    note: "A Morning/GreenInvoice invoice or receipt. Morning also writes document_links rows (customer + order/project/payment), so it is already attached through the polymorphic path; the FK is a mirror, not the only route.",
    resolved: false,
  },
];

/** The polymorphic path. Not an FK owner — the join table itself. */
export const DOCUMENT_LINK_TABLE = "document_links";

/** Tables allowed to reference documents(id). The guard test compares the
 *  migrations against this, so a new one has to be declared. */
export const KNOWN_DOCUMENT_REFERENCING_TABLES = [
  DOCUMENT_LINK_TABLE,
  ...DOCUMENT_FK_OWNERS.map((owner) => owner.table),
];
