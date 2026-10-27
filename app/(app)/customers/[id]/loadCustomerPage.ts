import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkStrings } from "@/lib/financial/utils";
import { toHebrewError } from "@/lib/error-messages";
import { getCustomerActivity, type CustomerActivity } from "@/lib/communications";
import { getCustomerPromises, type PaymentPromise } from "@/lib/promises";
import { getEntityAuditTrail, type EntityAuditSource } from "@/lib/audit";
import { STORAGE_BUCKET } from "@/lib/storage";
import {
  compareDocumentsNewestFirst,
  num,
  str,
  type CustomerDocumentItem,
  type CustomerDocumentsResult,
  type CustomerHistory,
  type CustomerPageTop,
  type Row,
} from "@/app/(app)/customers/[id]/customerPageModel";
import {
  idsOf,
  inBatches,
  mergeCustomerPage,
  paged,
  startCustomerCoreReads,
  type CustomerServerParts,
} from "@/app/(app)/customers/[id]/customerPageCore";

// Every read a customer's page makes, started at once. Each goes out the moment
// what it needs is in — the order payments as soon as the orders are read, not
// after everything else — instead of the three waves the page used to wait
// through one after another.
//
// The page's core (customerPageCore.ts) is what the phone's copy can also work
// out — the customer, its money, orders, projects, contacts, tags, tasks,
// loans and every payment. Here, besides it, what only the server reads: the
// call log, payment promises, Morning documents, a linked worker's pay owed
// (`server`), the documents with their signed links and the history.
//
// `top` is what the page waits for before it shows anything: the core and the
// server's parts, which land in the same time and so give their sections their
// real open/closed state on the first paint. The heavy ones — every payment,
// the documents, the history — are sent after the page, into sections that are
// folded until they arrive (`payments`, `documents`, `history`), so nothing
// moves when they do.

/** The documents the page lists (the rest are a link away) — only these get a signed link. */
export const DOCUMENTS_SHOWN = 10;

const IN_BATCH = 150;
const NO_ACTIVITY: CustomerActivity = { logs: [], reminders: [] };

type Viewer = {
  /** The viewer's role, once the "who's asking" check has it. */
  role: Promise<string>;
  viewerId: Promise<string>;
};

/**
 * What only the server reads for the page. `known` hands over what the core
 * already read (the server version); on its own (the page drawn from the
 * device) it reads the ids it needs itself — a few small reads. `withHistory`
 * false leaves the history out even for an admin (a frame the service worker
 * saves in the background, lib/powersync/device-check.ts).
 */
export function startCustomerServerReads(
  supabase: SupabaseClient,
  id: string,
  viewer: Viewer,
  known?: { orderIds: Promise<string[]>; projectIds: Promise<string[]>; linkedUserId: Promise<string | null> },
  { withHistory = true }: { withHistory?: boolean } = {}
) {
  const canManage = viewer.role.then((role) => role === "admin" || role === "office");
  const isAdmin = viewer.role.then((role) => role === "admin");

  const orderIds =
    known?.orderIds ??
    paged((from, to) => supabase.from("orders").select("id").eq("customer_id", id).order("id").range(from, to))
      .then((rows) => idsOf(rows, "id"))
      .catch(() => [] as string[]);
  const projectIds =
    known?.projectIds ??
    paged((from, to) => supabase.from("projects").select("id").eq("customer_id", id).order("id").range(from, to))
      .then((rows) => idsOf(rows, "id"))
      .catch(() => [] as string[]);
  const linkedUserId =
    known?.linkedUserId ??
    Promise.resolve(supabase.from("customers").select("linked_user_id").eq("id", id).maybeSingle())
      .then((result) => str(result.data as Row | null, "linked_user_id") || null)
      .catch(() => null);

  const morningDocuments = paged((from, to) =>
    supabase
      .from("morning_documents")
      .select(
        "id,morning_document_id,morning_document_number,document_type,document_type_label,status,customer_id,order_id,project_id,payment_id,document_id,morning_client_id,amount,currency,morning_url,pdf_url,issued_at,closed_at,notes"
      )
      .eq("customer_id", id)
      .order("issued_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to)
  ).catch(() => [] as Row[]);
  // The call log and reminders the גבייה section opens with (the panel used to
  // fetch them itself after the page, and the receivables a second time).
  const activity = canManage
    .then((ok) => (ok ? getCustomerActivity(supabase, id) : NO_ACTIVITY))
    .catch(() => NO_ACTIVITY);
  const promises = canManage
    .then((ok) => (ok ? getCustomerPromises(supabase, id) : []))
    .catch(() => [] as PaymentPromise[]);
  // The payroll half of מאזן מול העסק — only when the customer is linked to a
  // users row.
  const payrollOwed = Promise.all([linkedUserId, canManage])
    .then(([userId, ok]) =>
      userId && ok
        ? Promise.resolve(
            supabase.from("worker_balance_summary_view").select("user_id,owed_amount").eq("user_id", userId).maybeSingle()
          ).then((result) => num((result.data as Row | null)?.owed_amount))
        : null
    )
    .catch(() => null);

  const server: Promise<CustomerServerParts> = Promise.all([morningDocuments, activity, promises, payrollOwed]).then(
    ([morningRows, activityResult, promiseRows, owed]) => ({
      morningDocuments: morningRows as unknown as CustomerServerParts["morningDocuments"],
      activity: activityResult,
      promises: promiseRows,
      payrollOwed: owed,
    })
  );

  // Documents linked to the customer directly or through its orders/projects.
  // The order/project link is the one shown as the source when a document
  // carries both.
  const documents: Promise<CustomerDocumentsResult> = Promise.all([
    paged((from, to) =>
      supabase
        .from("document_links")
        .select("document_id,entity_type,entity_id")
        .eq("entity_type", "customer")
        .eq("entity_id", id)
        .order("document_id", { ascending: true })
        .range(from, to)
    ),
    orderIds.then((ids) => documentLinks(supabase, "order", ids)),
    projectIds.then((ids) => documentLinks(supabase, "project", ids)),
  ])
    .then(async ([customerLinks, orderLinks, projectLinks]) => {
      const linkByDocumentId = new Map<string, Row>();
      for (const link of [...customerLinks, ...orderLinks, ...projectLinks]) {
        const documentId = str(link, "document_id");
        if (!documentId) continue;
        const existing = linkByDocumentId.get(documentId);
        if (!existing || str(existing, "entity_type") === "customer") linkByDocumentId.set(documentId, link);
      }
      const rows = await inBatches(Array.from(linkByDocumentId.keys()), (batch) =>
        paged((from, to) =>
          supabase
            .from("documents")
            .select("id,document_type,title,file_name,storage_key,uploaded_at")
            .in("id", batch)
            .order("id", { ascending: true })
            .range(from, to)
        )
      );
      const items = rows
        .map((doc) => {
          const link = linkByDocumentId.get(str(doc, "id"));
          const entityType = str(link, "entity_type");
          return {
            item: {
              id: str(doc, "id"),
              name: str(doc, "title") || str(doc, "file_name") || "מסמך",
              // Its own name, for הורדה: the title is prose, the file name has the type.
              fileName: str(doc, "file_name") || null,
              type: str(doc, "document_type") || null,
              uploadedAt: str(doc, "uploaded_at") || null,
              url: null,
              sourceType: entityType === "order" || entityType === "project" ? entityType : "customer",
              sourceId: str(link, "entity_id"),
            } satisfies CustomerDocumentItem,
            storageKey: str(doc, "storage_key"),
          };
        })
        .sort((a, b) => compareDocumentsNewestFirst(a.item, b.item));

      const shown = items.slice(0, DOCUMENTS_SHOWN);
      const keys = Array.from(new Set(shown.map((entry) => entry.storageKey).filter(Boolean)));
      const signedByKey = new Map<string, string>();
      if (keys.length > 0) {
        const { data: signed } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrls(keys, 60 * 60);
        for (const entry of signed ?? []) {
          if (entry.path && entry.signedUrl) signedByKey.set(entry.path, entry.signedUrl);
        }
      }
      return {
        documents: shown.map((entry) => ({ ...entry.item, url: signedByKey.get(entry.storageKey) ?? null })),
        total: items.length,
        error: null,
      };
    })
    .catch((error) => ({ documents: [], total: 0, error: toHebrewError(error, "טעינת המסמכים נכשלה.") }));

  // Per-entity activity timeline (admin only): this customer's own changes
  // plus their orders, projects, and payments. Each id list goes as its own
  // ≤150 source; the trail merges them and keeps the newest.
  const history: Promise<CustomerHistory> = Promise.all([isAdmin, orderIds, projectIds])
    .then(([admin, orderIdList, projectIdList]) => {
      if (!admin || !withHistory) return { items: [], error: null };
      const sources: EntityAuditSource[] = [
        { tableName: "customers", recordId: id },
        { tableName: "orders", jsonKey: "customer_id", value: id },
        { tableName: "projects", jsonKey: "customer_id", value: id },
        ...chunkStrings(orderIdList, IN_BATCH).map((values) => ({ tableName: "payments", jsonKey: "order_id", values })),
        ...chunkStrings(projectIdList, IN_BATCH).map((values) => ({ tableName: "payments", jsonKey: "project_id", values })),
      ];
      return getEntityAuditTrail(supabase, sources);
    })
    .catch((error) => ({ items: [], error: toHebrewError(error, "טעינת ההיסטוריה נכשלה.") }));

  return { server, documents, history };
}

/** The server version of the page: the core and the server's parts together. */
export function startCustomerPageReads(supabase: SupabaseClient, id: string, viewer: Viewer) {
  const coreReads = startCustomerCoreReads(supabase, id, viewer);
  const serverReads = startCustomerServerReads(supabase, id, viewer, {
    orderIds: coreReads.orderIds,
    projectIds: coreReads.projectIds,
    linkedUserId: coreReads.linkedUserId,
  });
  const top: Promise<CustomerPageTop | null> = Promise.all([coreReads.core, serverReads.server]).then(([core, server]) =>
    core ? mergeCustomerPage(core, server) : null
  );
  return { top, payments: coreReads.payments, documents: serverReads.documents, history: serverReads.history };
}

function documentLinks(supabase: SupabaseClient, entityType: "order" | "project", ids: string[]) {
  return inBatches(ids, (batch) =>
    paged((from, to) =>
      supabase
        .from("document_links")
        .select("document_id,entity_type,entity_id")
        .eq("entity_type", entityType)
        .in("entity_id", batch)
        .order("document_id", { ascending: true })
        .order("entity_id", { ascending: true })
        .range(from, to)
    )
  );
}
