import dynamic from "next/dynamic";
import AppShell from "@/components/layout/AppShell";
import { DetailPageSkeleton } from "@/components/layout/DetailPageSkeleton";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { resolveUserColorsForValues, resolveUserDisplayNamesForValues } from "@/lib/audit";
import { isExpenseBusinessDomain, mapProjectTypeToExpenseDomain, type ExpenseBusinessDomain } from "@/lib/expenses";
import { propertyDisplayName } from "@/lib/properties";
import type {
  ArchiveTargetOption,
  DocumentArchiveFilters,
  DocumentArchiveItem,
} from "@/lib/documents/archive";

import { STORAGE_BUCKET } from "@/lib/storage";
import { buildDocumentDisplayName, inferFileKind } from "@/lib/documents";

// ~1,000 lines. Lazy-loaded so a visitor doesn't download it before actually
// landing on this route — same pattern as SalaryCenterClient/ProfileClient.
const DocumentsArchiveClient = dynamic(() => import("@/app/(app)/documents/DocumentsArchiveClient"), {
  loading: () => <DetailPageSkeleton />,
});

type Row = Record<string, unknown>;

const DOCUMENTS_BUCKET = STORAGE_BUCKET;
const MAX_DOCUMENTS = 1000;

type DocumentsSearchParams = {
  customer_id?: string;
  customer_name?: string;
  customer_page?: string;
  money?: string;
  project_id?: string;
  property_id?: string;
  business_domain?: string;
  entity_type?: string;
  type?: string;
  q?: string;
  /** Deep link (activity feed): open THIS document's preview on arrival. */
  focus?: string;
};

type DocumentRow = {
  id: string;
  document_type: string | null;
  business_domain: string | null;
  title: string | null;
  file_name: string | null;
  storage_key: string | null;
  uploaded_at: string | null;
  notes: string | null;
  uploaded_by?: string | null;
  source?: string | null;
  valid_until?: string | null;
  no_link_needed?: boolean | null;
};

type DocumentLinkRow = {
  document_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string | null;
};

type ProjectLookupRow = {
  id: string;
  name: string | null;
  project_type: string | null;
  customer_id: string | null;
  customer_name: string | null;
};

type ProjectUploadRow = {
  id: string;
  name: string | null;
};

type PropertyLookupRow = {
  id: string;
  name: string | null;
  address: string | null;
};

type TaskLookupRow = {
  task_id: string;
  subject: string | null;
  project_id: string | null;
  project_name: string | null;
};

type TaskMetaRow = {
  id: string;
  project_id: string | null;
  property_id: string | null;
};

type CustomerLookupRow = {
  customer_id: string;
  customer_name: string | null;
};

type OrderLookupRow = {
  order_id: string;
  customer_id: string | null;
  customer_name: string | null;
  order_date: string | null;
  status: string | null;
};

type LinkedEntity = {
  type: string;
  id: string;
  label: string;
  href: string | null;
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const map = new Map<string, T>();
  for (const item of items) {
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return Array.from(map.values());
}

function buildDocumentName(doc: DocumentRow) {
  return normalizeString(doc.title) || normalizeString(doc.file_name) || "מסמך";
}

function entityHref(entityType: string, entityId: string) {
  switch (entityType) {
    case "project":
      return `/projects/${entityId}?tab=documents`;
    case "property":
      return `/properties/${entityId}`;
    case "task":
      return `/tasks/${entityId}`;
    case "customer":
      return `/customers/${entityId}`;
    case "order":
      return `/sales/orders/${entityId}`;
    default:
      return null;
  }
}

// Links that represent a money/work record rather than a navigable entity.
// They have no page of their own, but a document tied to one is NOT unfiled.
const LEDGER_LINK_LABELS: Record<string, string> = {
  expense: "הוצאה",
  payment: "תשלום",
  session: "דיווח שעות",
  loan: "הלוואה",
};

function compareByLabel(a: { label: string }, b: { label: string }) {
  return a.label.localeCompare(b.label, "he");
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams?: Promise<DocumentsSearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const { profile, supabase } = await requireStaffPage();

  // `source` arrives with 20260922183535. Selecting a column the database does
  // not have yet 42703s the WHOLE query and blanks the archive, so fall back to
  // the pre-migration column list instead of failing the page.
  const DOC_COLUMNS_BASE =
    "id,document_type,business_domain,title,file_name,storage_key,uploaded_at,notes,uploaded_by";
  const runDocumentsQuery = (columns: string) =>
    supabase
      .from("documents")
      .select(columns, { count: "estimated" })
      .order("uploaded_at", { ascending: false, nullsFirst: false })
      .range(0, MAX_DOCUMENTS - 1);

  let { data: documentsRaw, error: documentsError, count } = await runDocumentsQuery(
    `${DOC_COLUMNS_BASE},source,valid_until,no_link_needed`
  );
  if (documentsError?.code === "42703") {
    ({ data: documentsRaw, error: documentsError, count } = await runDocumentsQuery(DOC_COLUMNS_BASE));
  }

  const documents = (documentsRaw ?? []) as unknown as DocumentRow[];
  const documentIds = documents.map((doc) => doc.id);
  const documentUploadedByValues = Array.from(
    new Set(
      documents
        .map((doc) => (typeof doc.uploaded_by === "string" ? doc.uploaded_by : null))
        .filter((value): value is string => Boolean(value))
    )
  );
  const [documentUploaderNames, documentUploaderColors] = await Promise.all([
    resolveUserDisplayNamesForValues(supabase, documentUploadedByValues),
    resolveUserColorsForValues(supabase, documentUploadedByValues),
  ]);

  // The tags lookup (entity_tags → tags, its own internal 2-step chain) and the
  // document_links fetch both only depend on documentIds, not on each other —
  // run them as one round trip instead of sequentially.
  const [fkOwnersResult] = await Promise.all([
    (async () => {
      const vehicleByDocument = new Map<string, { id: string; label: string }>();
      const statementDocumentIds = new Set<string>();
      const leaseByDocument = new Map<string, { id: string; label: string }>();
      if (documentIds.length === 0) {
        return { vehicleByDocument, statementDocumentIds, leaseByDocument };
      }
      const [vehiclesRes, statementsRes, leasesRes, bankRes] = await Promise.all([
        supabase
          .from("vehicles")
          .select("tag_id,license_plate,make_model,photo_document_id,tag:tags(name)")
          .in("photo_document_id", documentIds)
          .then((r) => r, () => ({ data: [] as Row[] })),
        supabase
          .from("card_statements")
          .select("id,document_id")
          .in("document_id", documentIds)
          .then((r) => r, () => ({ data: [] as Row[] })),
        supabase
          .from("lease_agreements")
          .select("id,document_id,property_id,property:properties(name,address)")
          .in("document_id", documentIds)
          .then((r) => r, () => ({ data: [] as Row[] })),
        // A separate table from card_statements, and the one that was still
        // orphaning "דף עובר ושב" files — see lib/documents/owners.ts.
        supabase
          .from("bank_statements")
          .select("id,document_id")
          .in("document_id", documentIds)
          .then((r) => r, () => ({ data: [] as Row[] })),
      ]);
      for (const row of ((vehiclesRes as { data?: Row[] }).data ?? [])) {
        const documentId = normalizeString(row.photo_document_id);
        const tagId = normalizeString(row.tag_id);
        if (!documentId || !tagId) continue;
        const tagRow = (Array.isArray(row.tag) ? row.tag[0] : row.tag) as Row | undefined;
        vehicleByDocument.set(documentId, {
          id: tagId,
          label:
            normalizeString(tagRow?.name) ||
            normalizeString(row.license_plate) ||
            normalizeString(row.make_model) ||
            "רכב",
        });
      }
      for (const row of ((statementsRes as { data?: Row[] }).data ?? [])) {
        const documentId = normalizeString(row.document_id);
        if (documentId) statementDocumentIds.add(documentId);
      }
      for (const row of ((bankRes as { data?: Row[] }).data ?? [])) {
        const documentId = normalizeString(row.document_id);
        if (documentId) statementDocumentIds.add(documentId);
      }
      for (const row of ((leasesRes as { data?: Row[] }).data ?? [])) {
        const documentId = normalizeString(row.document_id);
        const propertyId = normalizeString(row.property_id);
        if (!documentId || !propertyId) continue;
        const propertyRow = (Array.isArray(row.property) ? row.property[0] : row.property) as Row | undefined;
        leaseByDocument.set(documentId, {
          id: propertyId,
          label: normalizeString(propertyRow?.name) || normalizeString(propertyRow?.address) || "נכס",
        });
      }
      return { vehicleByDocument, statementDocumentIds, leaseByDocument };
    })(),
  ]);
  const { vehicleByDocument, statementDocumentIds, leaseByDocument } = fkOwnersResult;

  const [linksResult, tagsResult] = await Promise.all([
    documentIds.length > 0
      ? supabase
          .from("document_links")
          .select("document_id,entity_type,entity_id,created_at")
          .in("document_id", documentIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as DocumentLinkRow[], error: null }),
    (async () => {
      // Vehicle/tag links per document (resilient: stays empty before the tags SQL is run).
      const tagsByDocument = new Map<string, Array<{ id: string; label: string; href: string | null }>>();
      // The "document year" the file is FOR (e.g. a 2026 טסט), stored on the tag link.
      // A doc can carry several tag rows → keep the latest ref_year present.
      const refYearByDocument = new Map<string, number>();
      let vehicleTagOptions: ArchiveTargetOption[] = [];
      if (documentIds.length === 0) {
        return { tagsByDocument, refYearByDocument, vehicleTagOptions };
      }
      const { data: docTagRows, error: docTagErr } = await supabase
        .from("entity_tags")
        .select("entity_id,tag_id,ref_year")
        .eq("entity_type", "document")
        .in("entity_id", documentIds);
      const tagLinks = (!docTagErr && Array.isArray(docTagRows) ? docTagRows : []) as Array<Record<string, unknown>>;
      if (tagLinks.length > 0) {
        const tagIdSet = Array.from(
          new Set(tagLinks.map((r) => normalizeString(r.tag_id)).filter(Boolean))
        );
        const { data: tagRows } = tagIdSet.length
          ? await supabase.from("tags").select("id,name,kind").in("id", tagIdSet)
          : { data: [] };
        const tagNameById = new Map<string, string>();
        // Only 'vehicle' tags have a page of their own (/vehicles/[tagId]) — every
        // other kind (general/campaign/equipment/…) has nowhere to link to yet.
        const vehicleTagIds = new Set<string>();
        for (const t of (tagRows ?? []) as Array<Record<string, unknown>>) {
          const tid = normalizeString(t.id);
          if (!tid) continue;
          tagNameById.set(tid, normalizeString(t.name) || "תגית");
          if (t.kind === "vehicle") vehicleTagIds.add(tid);
        }
        for (const r of tagLinks) {
          const docId = normalizeString(r.entity_id);
          const refYearValue = Number(r.ref_year);
          if (docId && Number.isInteger(refYearValue) && refYearValue > 0) {
            const existing = refYearByDocument.get(docId);
            if (existing === undefined || refYearValue > existing) {
              refYearByDocument.set(docId, refYearValue);
            }
          }
          const tid = normalizeString(r.tag_id);
          const name = tagNameById.get(tid);
          if (!docId || !tid || !name) continue;
          const list = tagsByDocument.get(docId) ?? [];
          list.push({ id: tid, label: name, href: vehicleTagIds.has(tid) ? `/vehicles/${tid}` : null });
          tagsByDocument.set(docId, list);
        }
        const optMap = new Map<string, string>();
        for (const list of tagsByDocument.values()) for (const t of list) optMap.set(t.id, t.label);
        vehicleTagOptions = Array.from(optMap.entries())
          .map(([id, label]) => ({ id, label }))
          .sort(compareByLabel);
      }
      return { tagsByDocument, refYearByDocument, vehicleTagOptions };
    })(),
  ]);

  const { data: linksRaw, error: linksError } = linksResult;
  const { tagsByDocument, refYearByDocument, vehicleTagOptions } = tagsResult;

  for (const [documentId, vehicle] of vehicleByDocument) {
    const existing = tagsByDocument.get(documentId) ?? [];
    if (existing.some((tag) => tag.id === vehicle.id)) continue;
    existing.push({ id: vehicle.id, label: vehicle.label, href: `/vehicles/${vehicle.id}` });
    tagsByDocument.set(documentId, existing);
  }
  const links = (linksRaw ?? []) as DocumentLinkRow[];
  const linksByDocumentId = new Map<string, DocumentLinkRow[]>();

  for (const link of links) {
    const documentId = normalizeString(link.document_id);
    if (!documentId) continue;
    const current = linksByDocumentId.get(documentId) ?? [];
    current.push(link);
    linksByDocumentId.set(documentId, current);
  }

  const projectIds = new Set<string>();
  const taskIds = new Set<string>();
  const customerIds = new Set<string>();
  const orderIds = new Set<string>();
  const userIds = new Set<string>();

  for (const link of links) {
    const entityType = normalizeString(link.entity_type);
    const entityId = normalizeString(link.entity_id);
    if (!entityType || !entityId) continue;
    if (entityType === "project") projectIds.add(entityId);
    if (entityType === "task") taskIds.add(entityId);
    if (entityType === "customer") customerIds.add(entityId);
    if (entityType === "order") orderIds.add(entityId);
    if (entityType === "user") userIds.add(entityId);
  }

  // Worker names for session attachments linked via entity_type='user'
  // (attendance_sessions.user_id = public.users.id).
  const workerNames =
    userIds.size > 0 ? await resolveUserDisplayNamesForValues(supabase, Array.from(userIds)) : {};

  const [allProjectsResult, uploadProjectsResult, allPropertiesResult, tasksOverviewResult, tasksMetaResult, ordersResult] = await Promise.all([
    supabase.from("project_overview_view").select("id,name,project_type,customer_id,customer_name"),
    supabase
      .from("project_dashboard_view")
      .select("id,name")
      .order("name", { ascending: true })
      .range(0, 999),
    supabase
      .from("properties")
      .select("id,name,address")
      .order("address", { ascending: true })
      .range(0, 999),
    taskIds.size > 0
      ? supabase
          .from("task_overview_view")
          .select("task_id,subject,project_id,project_name")
          .in("task_id", Array.from(taskIds))
      : Promise.resolve({ data: [] as TaskLookupRow[], error: null }),
    taskIds.size > 0
      ? supabase.from("tasks").select("id,project_id,property_id").in("id", Array.from(taskIds))
      : Promise.resolve({ data: [] as TaskMetaRow[], error: null }),
    orderIds.size > 0
      ? supabase
          .from("order_overview_view")
          .select("order_id,customer_id,customer_name,order_date,status")
          .in("order_id", Array.from(orderIds))
      : Promise.resolve({ data: [] as OrderLookupRow[], error: null }),
  ]);

  const taskMetaRows = (tasksMetaResult.data ?? []) as TaskMetaRow[];
  const projectCustomerIdByProjectId = new Map<string, string>();
  ((allProjectsResult.data ?? []) as ProjectLookupRow[]).forEach((row) => {
    const projectId = normalizeString(row.id);
    const customerId = normalizeString(row.customer_id);
    if (!projectId || !customerId) return;
    projectCustomerIdByProjectId.set(projectId, customerId);
  });

  const derivedCustomerIds = new Set<string>(Array.from(customerIds));
  for (const row of taskMetaRows) {
    const projectId = normalizeString(row.project_id);
    const customerId = projectId ? normalizeString(projectCustomerIdByProjectId.get(projectId)) : null;
    if (customerId) derivedCustomerIds.add(customerId);
  }

  const customersResult =
    derivedCustomerIds.size > 0
      ? await supabase
          .from("customer_overview_view")
          .select("customer_id,customer_name")
          .in("customer_id", Array.from(derivedCustomerIds))
      : { data: [] as CustomerLookupRow[], error: null };

  const projectsById = new Map<string, ProjectLookupRow>();
  ((allProjectsResult.data ?? []) as ProjectLookupRow[]).forEach((row) => {
    projectsById.set(row.id, row);
  });

  const uploadProjectOptions: ArchiveTargetOption[] = ((uploadProjectsResult.data ?? []) as ProjectUploadRow[])
    .map((row) => ({
      id: row.id,
      label: normalizeString(row.name) || `פרויקט ${row.id.slice(0, 8)}`,
    }))
    .sort(compareByLabel);

  const propertiesById = new Map<string, PropertyLookupRow>();
  ((allPropertiesResult.data ?? []) as PropertyLookupRow[]).forEach((row) => {
    propertiesById.set(row.id, row);
  });

  const uploadPropertyOptions: ArchiveTargetOption[] = ((allPropertiesResult.data ?? []) as PropertyLookupRow[])
    .map((row) => ({
      id: row.id,
      label: propertyDisplayName({ name: row.name, address: row.address ?? "" }) || `Property ${row.id.slice(0, 8)}`,
    }))
    .sort(compareByLabel);

  const tasksOverviewById = new Map<string, TaskLookupRow>();
  ((tasksOverviewResult.data ?? []) as TaskLookupRow[]).forEach((row) => {
    tasksOverviewById.set(row.task_id, row);
  });

  const tasksMetaById = new Map<string, TaskMetaRow>();
  taskMetaRows.forEach((row) => {
    tasksMetaById.set(row.id, row);
  });

  const customersById = new Map<string, CustomerLookupRow>();
  ((customersResult.data ?? []) as CustomerLookupRow[]).forEach((row) => {
    customersById.set(row.customer_id, row);
  });

  const ordersById = new Map<string, OrderLookupRow>();
  ((ordersResult.data ?? []) as OrderLookupRow[]).forEach((row) => {
    ordersById.set(row.order_id, row);
  });

  // ONE batched signed-URL call for every document instead of one call per
  // document (was up to MAX_DOCUMENTS=1000 concurrent Storage round trips).
  const documentStorageKeys = Array.from(
    new Set(documents.map((doc) => normalizeString(doc.storage_key)).filter(Boolean))
  );
  const signedUrlByStorageKey = new Map<string, string>();
  if (documentStorageKeys.length > 0) {
    const { data: signed } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrls(documentStorageKeys, 60 * 60);
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) signedUrlByStorageKey.set(item.path, item.signedUrl);
    }
  }

  const archiveItems = documents.map((doc): DocumentArchiveItem => {
      const docLinks = linksByDocumentId.get(doc.id) ?? [];
      const relatedProjects = new Map<string, { id: string; label: string }>();
      const relatedProperties = new Map<string, { id: string; label: string }>();
      const relatedCustomers = new Map<string, { id: string; label: string }>();
      const relatedOrders = new Map<string, { id: string; label: string }>();
      const relatedTasks = new Map<string, { id: string; label: string }>();
      const linkedEntities = new Map<string, LinkedEntity>();
      const relatedBusinessDomains = new Set<ExpenseBusinessDomain>();

      for (const link of docLinks) {
        const entityType = normalizeString(link.entity_type);
        const entityId = normalizeString(link.entity_id);
        if (!entityType || !entityId) continue;

        if (entityType === "project") {
          const project = projectsById.get(entityId);
          const label = normalizeString(project?.name) || `פרויקט ${entityId.slice(0, 8)}`;
          relatedProjects.set(entityId, { id: entityId, label });
          relatedBusinessDomains.add(mapProjectTypeToExpenseDomain(project?.project_type));
          linkedEntities.set(`${entityType}:${entityId}`, {
            type: entityType,
            id: entityId,
            label,
            href: entityHref(entityType, entityId),
          });

          const customerId = normalizeString(project?.customer_id);
          const customerName = normalizeString(project?.customer_name);
          if (customerId) {
            relatedCustomers.set(customerId, {
              id: customerId,
              label: customerName || customersById.get(customerId)?.customer_name || "לקוח",
            });
          }
        }

        if (entityType === "property") {
          const property = propertiesById.get(entityId);
          const label =
            propertyDisplayName({ name: property?.name ?? null, address: property?.address ?? "" }) ||
            `Property ${entityId.slice(0, 8)}`;
          relatedProperties.set(entityId, { id: entityId, label });
          relatedBusinessDomains.add("property_management");
          linkedEntities.set(`${entityType}:${entityId}`, {
            type: entityType,
            id: entityId,
            label,
            href: entityHref(entityType, entityId),
          });
        }

        if (entityType === "task") {
          const task = tasksOverviewById.get(entityId);
          const taskMeta = tasksMetaById.get(entityId);
          const label = normalizeString(task?.subject) || `משימה ${entityId.slice(0, 8)}`;
          relatedTasks.set(entityId, { id: entityId, label });
          linkedEntities.set(`${entityType}:${entityId}`, {
            type: entityType,
            id: entityId,
            label,
            href: entityHref(entityType, entityId),
          });

          const projectId =
            normalizeString(task?.project_id) || normalizeString(taskMeta?.project_id);
          if (projectId) {
            const project = projectsById.get(projectId);
            relatedBusinessDomains.add(mapProjectTypeToExpenseDomain(project?.project_type));
            relatedProjects.set(projectId, {
              id: projectId,
              label: normalizeString(task?.project_name) || normalizeString(project?.name) || "פרויקט",
            });
            const customerId = normalizeString(project?.customer_id);
            const customerName = normalizeString(project?.customer_name);
            if (customerId) {
              relatedCustomers.set(customerId, {
                id: customerId,
                label: customerName || customersById.get(customerId)?.customer_name || "לקוח",
              });
            }
          }

          const propertyId = normalizeString(taskMeta?.property_id);
          if (propertyId) {
            const property = propertiesById.get(propertyId);
            relatedProperties.set(propertyId, {
              id: propertyId,
              label: propertyDisplayName({ name: property?.name ?? null, address: property?.address ?? "" }) || "Property",
            });
            relatedBusinessDomains.add("property_management");
          }

          const customerId = null;
          if (customerId) {
            relatedCustomers.set(customerId, {
              id: customerId,
              label: normalizeString(customersById.get(customerId)?.customer_name) || "לקוח",
            });
          }
        }

        if (entityType === "customer") {
          const customer = customersById.get(entityId);
          const label = normalizeString(customer?.customer_name) || `לקוח ${entityId.slice(0, 8)}`;
          relatedCustomers.set(entityId, { id: entityId, label });
          linkedEntities.set(`${entityType}:${entityId}`, {
            type: entityType,
            id: entityId,
            label,
            href: entityHref(entityType, entityId),
          });
        }

        if (entityType === "order") {
          const order = ordersById.get(entityId);
          relatedBusinessDomains.add("sales");
          // Orders have no human-readable number, so a UUID slice was the label —
          // "הזמנה bca3eb83" identifies nothing. Name it by who it is for, which
          // is what someone hunting for the paperwork actually remembers.
          const orderCustomerName =
            normalizeString(order?.customer_name) ||
            normalizeString(customersById.get(normalizeString(order?.customer_id))?.customer_name);
          const orderDate = normalizeString(order?.order_date).slice(0, 10);
          const orderLabel = orderCustomerName
            ? `הזמנה · ${orderCustomerName}`
            : orderDate
              ? `הזמנה · ${orderDate}`
              : `הזמנה ${entityId.slice(0, 8)}`;
          relatedOrders.set(entityId, { id: entityId, label: orderLabel });
          linkedEntities.set(`${entityType}:${entityId}`, {
            type: entityType,
            id: entityId,
            label: orderLabel,
            href: entityHref(entityType, entityId),
          });

          const customerId = normalizeString(order?.customer_id);
          if (customerId) {
            relatedCustomers.set(customerId, {
              id: customerId,
              label:
                normalizeString(order?.customer_name) ||
                normalizeString(customersById.get(customerId)?.customer_name) ||
                "לקוח",
            });
          }
        }

        if (entityType === "user") {
          const label = normalizeString(workerNames[entityId]) || `עובד ${entityId.slice(0, 8)}`;
          linkedEntities.set(`${entityType}:${entityId}`, {
            type: entityType,
            id: entityId,
            label,
            href: entityHref(entityType, entityId),
          });
        }

        // Owners that attach by a plain FK on the other table, not by a
        // document_links row: a vehicle's cover photo and an imported
        // statement. Without these they reported "ללא שיוך" forever.
        // (placed before the ledger-label block so the loop order is unchanged)
        // expense / payment / session / loan links were silently dropped here —
        // only the six types above ever became a linkedEntity. A property
        // expense receipt therefore reported "ללא שיוך" while its
        // document_links row existed the whole time. They get no href (there is
        // no page for a single expense), but they must still count as linked.
        if (LEDGER_LINK_LABELS[entityType]) {
          linkedEntities.set(`${entityType}:${entityId}`, {
            type: entityType,
            id: entityId,
            label: LEDGER_LINK_LABELS[entityType]!,
            href: null,
          });
        }
      }

      const ownerVehicle = vehicleByDocument.get(doc.id);
      if (ownerVehicle) {
        linkedEntities.set(`vehicle:${ownerVehicle.id}`, {
          type: "vehicle",
          id: ownerVehicle.id,
          label: ownerVehicle.label,
          href: `/vehicles/${ownerVehicle.id}`,
        });
      }
      const ownerLease = leaseByDocument.get(doc.id);
      if (ownerLease) {
        relatedProperties.set(ownerLease.id, { id: ownerLease.id, label: ownerLease.label });
        linkedEntities.set(`property:${ownerLease.id}`, {
          type: "property",
          id: ownerLease.id,
          label: ownerLease.label,
          href: entityHref("property", ownerLease.id),
        });
      }
      if (statementDocumentIds.has(doc.id)) {
        linkedEntities.set("statement:self", {
          type: "statement",
          id: doc.id,
          label: "דף חיוב מיובא",
          href: "/financial/statements",
        });
      }

      const storageKey = normalizeString(doc.storage_key) || null;
      const latestLinkCreatedAt =
        docLinks.find((link) => normalizeString(link.created_at))?.created_at ?? null;
      // A Morning/GreenInvoice document has no file in our bucket — it lives on
      // their side, and lib/morning/service.ts stores that address in `notes`
      // with storage_key null. Without this fallback every Morning invoice had
      // no url at all: no preview, and the "open it in a new tab" empty state
      // with nothing to open.
      const externalUrl = /^https?:\/\//i.test(normalizeString(doc.notes))
        ? normalizeString(doc.notes)
        : null;
      const signedUrl = storageKey
        ? signedUrlByStorageKey.get(storageKey) ?? null
        : externalUrl;

      const title = buildDocumentName(doc);
      const documentType = normalizeString(doc.document_type);
      const linkedEntityList = Array.from(linkedEntities.values()).sort((a, b) =>
        a.label.localeCompare(b.label, "he")
      );
      const withHref =
        (entityType: string) =>
        (item: { id: string; label: string }) => ({ ...item, href: entityHref(entityType, item.id) });
      const customerList = uniqueById(Array.from(relatedCustomers.values()))
        .sort(compareByLabel)
        .map(withHref("customer"));
      const projectList = uniqueById(Array.from(relatedProjects.values()))
        .sort(compareByLabel)
        .map(withHref("project"));
      const propertyList = uniqueById(Array.from(relatedProperties.values()))
        .sort(compareByLabel)
        .map(withHref("property"));
      const taskList = uniqueById(Array.from(relatedTasks.values()))
        .sort(compareByLabel)
        .map(withHref("task"));
      const orderList = uniqueById(Array.from(relatedOrders.values()))
        .sort(compareByLabel)
        .map(withHref("order"));
      // An explicit business_domain (override chosen on upload or via the UI)
      // wins. Otherwise infer from the linked entity (project → פרויקטים, order →
      // מכירות …), falling back to שוטף when there is no link.
      const storedDomain = isExpenseBusinessDomain(doc.business_domain) ? doc.business_domain : null;
      const businessDomainList = storedDomain
        ? [storedDomain]
        : relatedBusinessDomains.size > 0
          ? Array.from(relatedBusinessDomains.values())
          : (["general_business"] as ExpenseBusinessDomain[]);

      // A row titled "jpg.1001262226" tells you nothing. Prefer the real title,
      // and when there is not one, say what the document is and who it is for:
      // "צילום משלוח · בית הכנסת מאורות משה".
      const primaryEntityLabel =
        customerList[0]?.label ??
        orderList[0]?.label ??
        projectList[0]?.label ??
        propertyList[0]?.label ??
        linkedEntityList[0]?.label ??
        null;
      const displayTitle = buildDocumentDisplayName(title, documentType, primaryEntityLabel);

      return {
        id: doc.id,
        title: displayTitle,
        file_name: normalizeString(doc.file_name) || null,
        document_type: documentType || null,
        source: normalizeString(doc.source) || null,
        valid_until: normalizeString(doc.valid_until) || null,
        no_link_needed: doc.no_link_needed === true,
        file_kind: inferFileKind(doc.file_name),
        storage_key: storageKey,
        uploaded_at: normalizeString(doc.uploaded_at) || normalizeString(latestLinkCreatedAt) || null,
        created_at: normalizeString(latestLinkCreatedAt) || null,
        uploaded_by_name:
          typeof doc.uploaded_by === "string" ? documentUploaderNames[doc.uploaded_by] ?? null : null,
        uploaded_by_color:
          typeof doc.uploaded_by === "string" ? documentUploaderColors[doc.uploaded_by] ?? null : null,
        url: signedUrl,
        entity_types: Array.from(
          new Set(linkedEntityList.map((item) => item.type).filter(Boolean))
        ),
        linked_entities: linkedEntityList,
        customers: customerList,
        projects: projectList,
        properties: propertyList,
        tasks: taskList,
        orders: orderList,
        business_domains: businessDomainList,
        ref_year: refYearByDocument.get(doc.id) ?? null,
        tags: tagsByDocument.get(doc.id) ?? [],
        search_text: [
          title,
          normalizeString(doc.file_name),
          documentType,
          normalizeString(doc.notes),
          storageKey ?? "",
          ...businessDomainList,
          ...(tagsByDocument.get(doc.id) ?? []).map((t) => t.label),
          ...linkedEntityList.map((item) => item.label),
          ...customerList.map((item) => item.label),
          ...projectList.map((item) => item.label),
          ...propertyList.map((item) => item.label),
          ...taskList.map((item) => item.label),
          ...orderList.map((item) => item.label),
        ]
          .join(" ")
          .toLowerCase(),
      };
    });

  const { data: allCustomerRows } = await supabase
    .from("customer_overview_view")
    .select("customer_id,customer_name")
    .order("customer_name", { ascending: true })
    .range(0, 999);
  const customerAssignOptions: ArchiveTargetOption[] = (allCustomerRows ?? [])
    .map((row) => ({
      id: normalizeString((row as Row).customer_id),
      label: normalizeString((row as Row).customer_name),
    }))
    .filter((option) => option.id && option.label);

  const [{ data: allOrderRows }, { data: allTaskRows }] = await Promise.all([
    supabase
      .from("order_overview_view")
      .select("order_id,customer_id,customer_name,order_date")
      .order("order_date", { ascending: false })
      .range(0, 499),
    supabase
      .from("tasks")
      .select("id,subject,created_at")
      .order("created_at", { ascending: false })
      .range(0, 499),
  ]);
  const orderAssignOptions: ArchiveTargetOption[] = (allOrderRows ?? [])
    .map((row) => {
      const id = normalizeString((row as Row).order_id);
      const who = normalizeString((row as Row).customer_name);
      const when = normalizeString((row as Row).order_date).slice(0, 10);
      const label = [who || "הזמנה", when].filter(Boolean).join(" · ");
      return { id, label, customerId: normalizeString((row as Row).customer_id) || null, date: when || null };
    })
    .filter((option) => option.id);
  const taskAssignOptions: ArchiveTargetOption[] = (allTaskRows ?? [])
    .map((row) => ({
      id: normalizeString((row as Row).id),
      label: normalizeString((row as Row).subject),
    }))
    .filter((option) => option.id && option.label);

  const filterCustomerId = normalizeString(params.customer_id) || "";
  let filterCustomerPhone = "";
  if (filterCustomerId) {
    const { data: filterCustomerRow } = await supabase
      .from("customer_overview_view")
      .select("phone")
      .eq("customer_id", filterCustomerId)
      .maybeSingle<{ phone: string | null }>();
    filterCustomerPhone = normalizeString(filterCustomerRow?.phone) || "";
  }

  const initialFilters: DocumentArchiveFilters = {
    customer_id: filterCustomerId,
    customer_name: normalizeString(params.customer_name) || "",
    customer_phone: filterCustomerPhone,
    customer_page: normalizeString(params.customer_page) || "",
    // ?money=unlinked — where the document_unlinked_money inbox line lands.
    money: normalizeString(params.money) || "",
    project_id: normalizeString(params.project_id) || "",
    property_id: normalizeString(params.property_id) || "",
    business_domain:
      normalizeString(params.business_domain) ||
      (normalizeString(params.project_id)
        ? "logistics_projects"
        : normalizeString(params.property_id)
          ? "property_management"
          : ""),
    entity_type: normalizeString(params.entity_type) || "",
    type: normalizeString(params.type) || "",
    q: normalizeString(params.q) || "",
  };

  const errorMessage =
    documentsError?.message ??
    linksError?.message ??
    allProjectsResult.error?.message ??
    uploadProjectsResult.error?.message ??
    allPropertiesResult.error?.message ??
    tasksOverviewResult.error?.message ??
    tasksMetaResult.error?.message ??
    customersResult.error?.message ??
    ordersResult.error?.message ??
    null;

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <DocumentsArchiveClient
        documents={archiveItems}
        error={errorMessage}
        initialFilters={initialFilters}
        focusDocumentId={normalizeString(params.focus) || null}
        projectOptions={uploadProjectOptions}
        propertyOptions={uploadPropertyOptions}
        vehicleTagOptions={vehicleTagOptions}
        totalDocuments={typeof count === "number" ? count : archiveItems.length}
        isTruncated={typeof count === "number" ? count > archiveItems.length : false}
        canManageCategories={profile.role === "admin"}
        customerOptions={customerAssignOptions}
        orderOptions={orderAssignOptions}
        taskOptions={taskAssignOptions}
      />

    </AppShell>
  );
}
