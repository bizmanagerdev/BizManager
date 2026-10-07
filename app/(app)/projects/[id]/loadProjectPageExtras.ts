import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getEntityAuditTrail,
  getLatestAuditByRecordIds,
  resolveUserDisplayNamesForValues,
  type AuditFeedItem,
  type AuditRecordInfo,
} from "@/lib/audit";
import { STORAGE_BUCKET } from "@/lib/storage";
import type { FinancialAttachment } from "@/lib/payments";
import type { MorningLocalDocument } from "@/lib/morning/types";

// The parts of a project's page only the server can read: its documents, the
// files attached to its expenses, shifts and payments (signed links), its
// Morning documents, when each expense and payment was entered and by whom
// from the change log, and — for admins — its history. The project itself is
// in lib/projects/project-page.ts. Sent after the page, which shows without
// them and fills them in as they arrive.

type Row = Record<string, unknown>;

export type ProjectDocument = {
  document_id: string;
  storage_key: string | null;
  file_name: string | null;
  title: string | null;
  document_type: string | null;
  entity_type: string | null;
  entity_id: string | null;
  uploaded_at: string | null;
  uploaded_by_name: string | null;
  url: string | null;
};

export type ProjectPageExtras = {
  projectDocuments: ProjectDocument[];
  projectDocumentsError: string | null;
  /** The files attached to each expense / shift / payment, by its id. */
  attachments: {
    expense: Record<string, FinancialAttachment[]>;
    session: Record<string, FinancialAttachment[]>;
    payment: Record<string, FinancialAttachment[]>;
  };
  /** The change log's latest entry for each expense / payment, by its id. */
  expenseAudit: Record<string, AuditRecordInfo>;
  paymentAudit: Record<string, AuditRecordInfo>;
  /** The project's Morning documents and its payments' (each once). */
  morningDocuments: MorningLocalDocument[];
  morningDocumentsError: string | null;
  /** The project's history — null when this person doesn't see it (admins only). */
  activity: AuditFeedItem[] | null;
};

const MORNING_SELECT =
  "id,morning_document_id,morning_document_number,document_type,document_type_label,status,customer_id,order_id,project_id,payment_id,document_id,morning_client_id,amount,currency,morning_url,pdf_url,issued_at,closed_at,notes";

function getString(row: Row | null | undefined, key: string): string | null {
  const value = row?.[key];
  return typeof value === "string" && value ? value : null;
}

/**
 * An entity's document_links together with the documents they point at, in
 * ONE request (document_links.document_id → documents is a foreign key, so
 * PostgREST embeds each link's document). A document the caller can't read
 * comes back as null.
 */
async function loadLinkedDocuments(supabase: SupabaseClient, entityType: string, entityIds: string[]): Promise<Row[]> {
  if (entityIds.length === 0) return [];
  const { data } = await supabase
    .from("document_links")
    .select("document_id,entity_type,entity_id,created_at,document:documents(id,title,file_name,storage_key,uploaded_at,document_type)")
    .eq("entity_type", entityType)
    .in("entity_id", entityIds);
  return (data ?? []) as Row[];
}

function linkedDocument(link: Row): Row | null {
  const embedded = Array.isArray(link.document) ? link.document[0] : link.document;
  return embedded && typeof embedded === "object" ? (embedded as Row) : null;
}

/** Each entity's attachments, from its links — with the links signed (`urlByKey`). */
function attachmentsByEntity(links: Row[], urlByKey: Map<string, string>): Record<string, FinancialAttachment[]> {
  const byEntity: Record<string, FinancialAttachment[]> = {};
  for (const link of links) {
    const entityId = getString(link, "entity_id");
    const documentId = getString(link, "document_id");
    if (!entityId || !documentId) continue;
    const doc = linkedDocument(link);
    const storageKey = getString(doc, "storage_key");
    (byEntity[entityId] ??= []).push({
      document_id: documentId,
      file_name: getString(doc, "file_name"),
      storage_key: storageKey,
      uploaded_at: getString(doc, "uploaded_at") ?? getString(link, "created_at"),
      document_type: getString(doc, "document_type"),
      url: storageKey ? urlByKey.get(storageKey) ?? null : null,
    });
  }
  return byEntity;
}

type ExtrasInput = {
  id: string;
  expenseIds: Promise<string[]>;
  sessionIds: Promise<string[]>;
  paymentIds: Promise<string[]>;
  /** Whether this person sees the history — read once that's known. */
  withActivity: Promise<boolean>;
};

/**
 * Every read goes out at once, each as soon as what it needs is in; every
 * file is signed in ONE storage call. Never fails: what couldn't be read is
 * reported on the page.
 */
export function loadProjectPageExtras(supabase: SupabaseClient, input: ExtrasInput): Promise<ProjectPageExtras> {
  return readProjectPageExtras(supabase, input).catch((error: unknown) => ({
    projectDocuments: [],
    projectDocumentsError: error instanceof Error ? error.message : String(error),
    attachments: { expense: {}, session: {}, payment: {} },
    expenseAudit: {},
    paymentAudit: {},
    morningDocuments: [],
    morningDocumentsError: null,
    activity: [],
  }));
}

async function readProjectPageExtras(
  supabase: SupabaseClient,
  { id, expenseIds, sessionIds, paymentIds, withActivity }: ExtrasInput
): Promise<ProjectPageExtras> {
  const projectLinksRead = Promise.resolve(
    supabase
      .from("document_links")
      .select("document_id,entity_type,entity_id,created_at,document:documents(id,document_type,title,file_name,storage_key,uploaded_at,uploaded_by)")
      .eq("entity_type", "project")
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .range(0, 199)
  );
  const expenseLinksRead = expenseIds.then((ids) => loadLinkedDocuments(supabase, "expense", ids));
  const sessionLinksRead = sessionIds.then((ids) => loadLinkedDocuments(supabase, "session", ids));
  const paymentLinksRead = paymentIds.then((ids) => loadLinkedDocuments(supabase, "payment", ids));
  const expenseAuditRead = expenseIds.then((ids) => getLatestAuditByRecordIds(supabase, { tableName: "expenses", recordIds: ids }));
  const paymentAuditRead = paymentIds.then((ids) => getLatestAuditByRecordIds(supabase, { tableName: "payments", recordIds: ids }));
  const projectMorningRead = Promise.resolve(
    supabase.from("morning_documents").select(MORNING_SELECT).eq("project_id", id).order("issued_at", { ascending: false })
  );
  const paymentMorningRead = paymentIds.then(async (ids) => {
    if (ids.length === 0) return { data: [] as Row[], error: null };
    const { data, error } = await supabase
      .from("morning_documents")
      .select(MORNING_SELECT)
      .in("payment_id", ids)
      .order("issued_at", { ascending: false });
    return { data: (data ?? []) as Row[], error };
  });
  const uploaderNamesRead = projectLinksRead.then(({ data }) =>
    resolveUserDisplayNamesForValues(
      supabase,
      Array.from(
        new Set(
          ((data ?? []) as Row[]).map((link) => getString(linkedDocument(link), "uploaded_by")).filter((v): v is string => Boolean(v))
        )
      )
    )
  );
  // Every file the page shows — the project's and its rows' — signed in one call.
  const signedRead = Promise.all([projectLinksRead, expenseLinksRead, sessionLinksRead, paymentLinksRead]).then(
    async ([{ data: projectLinks }, expenseLinks, sessionLinks, paymentLinks]) => {
      const keys = new Set<string>();
      for (const link of [...((projectLinks ?? []) as Row[]), ...expenseLinks, ...sessionLinks, ...paymentLinks]) {
        const key = getString(linkedDocument(link), "storage_key");
        if (key) keys.add(key);
      }
      const urlByKey = new Map<string, string>();
      if (keys.size === 0) return urlByKey;
      const { data: signedList } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrls([...keys], 60 * 60);
      for (const entry of signedList ?? []) {
        if (entry && typeof entry.path === "string" && typeof entry.signedUrl === "string") urlByKey.set(entry.path, entry.signedUrl);
      }
      return urlByKey;
    }
  );
  // This project's own changes plus payments and worker shifts logged
  // against it — admin only, mirroring /activity access.
  const activityRead = withActivity.then((show) =>
    show
      ? getEntityAuditTrail(supabase, [
          { tableName: "projects", recordId: id },
          { tableName: "payments", jsonKey: "project_id", value: id },
          { tableName: "attendance_sessions", jsonKey: "project_id", value: id },
        ]).then((trail) => trail.items)
      : null
  );

  const [
    { data: projectLinks, error: projectLinksError },
    expenseLinks,
    sessionLinks,
    paymentLinks,
    expenseAudit,
    paymentAudit,
    { data: projectMorning, error: projectMorningError },
    { data: paymentMorning, error: paymentMorningError },
    uploaderNames,
    urlByKey,
    activity,
  ] = await Promise.all([
    projectLinksRead,
    expenseLinksRead,
    sessionLinksRead,
    paymentLinksRead,
    expenseAuditRead,
    paymentAuditRead,
    projectMorningRead,
    paymentMorningRead,
    uploaderNamesRead,
    signedRead,
    activityRead,
  ]);

  const projectDocuments: ProjectDocument[] = [];
  for (const link of (projectLinks ?? []) as Row[]) {
    const documentId = getString(link, "document_id");
    const doc = linkedDocument(link);
    if (!documentId || !doc) continue;
    const storageKey = getString(doc, "storage_key");
    const uploadedBy = getString(doc, "uploaded_by");
    projectDocuments.push({
      document_id: documentId,
      storage_key: storageKey,
      file_name: getString(doc, "file_name"),
      title: getString(doc, "title"),
      document_type: getString(doc, "document_type"),
      entity_type: getString(link, "entity_type"),
      entity_id: getString(link, "entity_id"),
      uploaded_at: getString(doc, "uploaded_at") ?? getString(link, "created_at"),
      uploaded_by_name: uploadedBy ? uploaderNames[uploadedBy] ?? null : null,
      url: storageKey ? urlByKey.get(storageKey) ?? null : null,
    });
  }

  const morningDocuments = Array.from(
    new Map(
      [...((projectMorning ?? []) as Row[]), ...((paymentMorning ?? []) as Row[])].map((row) => [
        getString(row, "id") ?? crypto.randomUUID(),
        row,
      ])
    ).values()
  ) as MorningLocalDocument[];

  return {
    projectDocuments,
    projectDocumentsError: projectLinksError?.message ?? null,
    attachments: {
      expense: attachmentsByEntity(expenseLinks, urlByKey),
      session: attachmentsByEntity(sessionLinks, urlByKey),
      payment: attachmentsByEntity(paymentLinks, urlByKey),
    },
    expenseAudit: expenseAudit.byRecordId,
    paymentAudit: paymentAudit.byRecordId,
    morningDocuments,
    morningDocumentsError: projectMorningError?.message ?? paymentMorningError?.message ?? null,
    activity,
  };
}
