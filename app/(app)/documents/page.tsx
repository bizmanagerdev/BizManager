import AppShell from "@/components/layout/AppShell";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { resolveUserDisplayNamesForValues } from "@/lib/audit";
import { isExpenseBusinessDomain, mapProjectTypeToExpenseDomain, type ExpenseBusinessDomain } from "@/lib/expenses";
import DocumentsArchiveClient, {
  type ArchiveTargetOption,
  type DocumentArchiveFilters,
  type DocumentArchiveItem,
} from "@/app/(app)/documents/DocumentsArchiveClient";

import { STORAGE_BUCKET } from "@/lib/storage";

const DOCUMENTS_BUCKET = STORAGE_BUCKET;
const MAX_DOCUMENTS = 1000;

type DocumentsSearchParams = {
  customer_id?: string;
  customer_name?: string;
  customer_page?: string;
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

function inferFileKind(name: string | null) {
  const value = normalizeString(name).toLowerCase();
  const ext = value.includes(".") ? value.split(".").pop() ?? "" : "";

  if (["pdf"].includes(ext)) return "pdf";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic"].includes(ext)) return "image";
  if (["doc", "docx", "txt", "rtf", "odt"].includes(ext)) return "document";
  if (["xls", "xlsx", "csv", "ods"].includes(ext)) return "spreadsheet";
  if (["ppt", "pptx", "key"].includes(ext)) return "presentation";
  if (["mp4", "mov", "webm", "mkv", "avi", "m4v"].includes(ext)) return "video";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archive";
  return "other";
}

function buildDocumentName(doc: DocumentRow) {
  return normalizeString(doc.title) || normalizeString(doc.file_name) || "מסמך";
}

function entityHref(entityType: string, entityId: string) {
  switch (entityType) {
    case "project":
      return `/projects/${entityId}?tab=documents`;
    case "property":
      return "/properties";
    case "task":
      return `/tasks/${entityId}`;
    case "customer":
      return `/customers`;
    case "order":
      return `/sales/orders/${entityId}`;
    default:
      return null;
  }
}

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

  const { data: documentsRaw, error: documentsError, count } = await supabase
    .from("documents")
    .select("id,document_type,business_domain,title,file_name,storage_key,uploaded_at,notes,uploaded_by", {
      count: "estimated",
    })
    .order("uploaded_at", { ascending: false, nullsFirst: false })
    .range(0, MAX_DOCUMENTS - 1);

  const documents = (documentsRaw ?? []) as DocumentRow[];
  const documentIds = documents.map((doc) => doc.id);
  const documentUploadedByValues = Array.from(
    new Set(
      documents
        .map((doc) => (typeof doc.uploaded_by === "string" ? doc.uploaded_by : null))
        .filter((value): value is string => Boolean(value))
    )
  );
  const documentUploaderNames = await resolveUserDisplayNamesForValues(supabase, documentUploadedByValues);

  // Vehicle/tag links per document (resilient: stays empty before the tags SQL is run).
  const tagsByDocument = new Map<string, Array<{ id: string; label: string }>>();
  // The "document year" the file is FOR (e.g. a 2026 טסט), stored on the tag link.
  // A doc can carry several tag rows → keep the latest ref_year present.
  const refYearByDocument = new Map<string, number>();
  let vehicleTagOptions: ArchiveTargetOption[] = [];
  if (documentIds.length > 0) {
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
        ? await supabase.from("tags").select("id,name").in("id", tagIdSet)
        : { data: [] };
      const tagNameById = new Map<string, string>();
      for (const t of (tagRows ?? []) as Array<Record<string, unknown>>) {
        const tid = normalizeString(t.id);
        if (tid) tagNameById.set(tid, normalizeString(t.name) || "תגית");
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
        list.push({ id: tid, label: name });
        tagsByDocument.set(docId, list);
      }
      const optMap = new Map<string, string>();
      for (const list of tagsByDocument.values()) for (const t of list) optMap.set(t.id, t.label);
      vehicleTagOptions = Array.from(optMap.entries())
        .map(([id, label]) => ({ id, label }))
        .sort(compareByLabel);
    }
  }

  const { data: linksRaw, error: linksError } =
    documentIds.length > 0
      ? await supabase
          .from("document_links")
          .select("document_id,entity_type,entity_id,created_at")
          .in("document_id", documentIds)
          .order("created_at", { ascending: false })
      : { data: [] as DocumentLinkRow[], error: null };

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
      .select("id,address")
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
      label: normalizeString(row.address) || `Property ${row.id.slice(0, 8)}`,
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

  const archiveItems = await Promise.all(
    documents.map(async (doc): Promise<DocumentArchiveItem> => {
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
          const label = normalizeString(property?.address) || `Property ${entityId.slice(0, 8)}`;
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
              label: normalizeString(property?.address) || "Property",
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
            href: `${entityHref(entityType, entityId)}?customer_id=${encodeURIComponent(entityId)}`,
          });
        }

        if (entityType === "order") {
          const order = ordersById.get(entityId);
          relatedBusinessDomains.add("sales");
          relatedOrders.set(entityId, { id: entityId, label: `הזמנה ${entityId.slice(0, 8)}` });
          linkedEntities.set(`${entityType}:${entityId}`, {
            type: entityType,
            id: entityId,
            label: `הזמנה ${entityId.slice(0, 8)}`,
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
      }

      const storageKey = normalizeString(doc.storage_key) || null;
      const latestLinkCreatedAt =
        docLinks.find((link) => normalizeString(link.created_at))?.created_at ?? null;
      const { data: signedUrlData } = storageKey
        ? await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(storageKey, 60 * 60)
        : { data: null };

      const title = buildDocumentName(doc);
      const documentType = normalizeString(doc.document_type);
      const linkedEntityList = Array.from(linkedEntities.values()).sort((a, b) =>
        a.label.localeCompare(b.label, "he")
      );
      const customerList = uniqueById(Array.from(relatedCustomers.values())).sort(compareByLabel);
      const projectList = uniqueById(Array.from(relatedProjects.values())).sort(compareByLabel);
      const propertyList = uniqueById(Array.from(relatedProperties.values())).sort(compareByLabel);
      const taskList = uniqueById(Array.from(relatedTasks.values())).sort(compareByLabel);
      const orderList = uniqueById(Array.from(relatedOrders.values())).sort(compareByLabel);
      // An explicit business_domain (override chosen on upload or via the UI)
      // wins. Otherwise infer from the linked entity (project → פרויקטים, order →
      // מכירות …), falling back to שוטף when there is no link.
      const storedDomain = isExpenseBusinessDomain(doc.business_domain) ? doc.business_domain : null;
      const businessDomainList = storedDomain
        ? [storedDomain]
        : relatedBusinessDomains.size > 0
          ? Array.from(relatedBusinessDomains.values())
          : (["general_business"] as ExpenseBusinessDomain[]);

      return {
        id: doc.id,
        title,
        file_name: normalizeString(doc.file_name) || null,
        document_type: documentType || null,
        file_kind: inferFileKind(doc.file_name),
        storage_key: storageKey,
        uploaded_at: normalizeString(doc.uploaded_at) || normalizeString(latestLinkCreatedAt) || null,
        created_at: normalizeString(latestLinkCreatedAt) || null,
        uploaded_by_name:
          typeof doc.uploaded_by === "string" ? documentUploaderNames[doc.uploaded_by] ?? null : null,
        url: typeof signedUrlData?.signedUrl === "string" ? signedUrlData.signedUrl : null,
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
    })
  );

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
      />
    </AppShell>
  );
}
