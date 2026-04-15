import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import DocumentsArchiveClient, {
  type DocumentArchiveFilters,
  type DocumentArchiveItem,
} from "@/app/documents/DocumentsArchiveClient";

const DOCUMENTS_BUCKET = "business-documents";
const MAX_DOCUMENTS = 1000;

type DocumentsSearchParams = {
  customer_id?: string;
  customer_name?: string;
  customer_page?: string;
  project_id?: string;
  entity_type?: string;
  type?: string;
  q?: string;
};

type DocumentRow = {
  id: string;
  document_type: string | null;
  title: string | null;
  file_name: string | null;
  storage_key: string | null;
  uploaded_at: string | null;
  notes: string | null;
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
  customer_id: string | null;
  customer_name: string | null;
};

type ProjectUploadRow = {
  id: string;
  name: string | null;
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
  customer_id: string | null;
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

type UploadProjectOption = {
  id: string;
  label: string;
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
  const { profile, supabase } = await requireProfile();

  const { data: documentsRaw, error: documentsError, count } = await supabase
    .from("documents")
    .select("id,document_type,title,file_name,storage_key,uploaded_at,notes", {
      count: "estimated",
    })
    .order("uploaded_at", { ascending: false, nullsFirst: false })
    .range(0, MAX_DOCUMENTS - 1);

  const documents = (documentsRaw ?? []) as DocumentRow[];
  const documentIds = documents.map((doc) => doc.id);

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

  for (const link of links) {
    const entityType = normalizeString(link.entity_type);
    const entityId = normalizeString(link.entity_id);
    if (!entityType || !entityId) continue;
    if (entityType === "project") projectIds.add(entityId);
    if (entityType === "task") taskIds.add(entityId);
    if (entityType === "customer") customerIds.add(entityId);
    if (entityType === "order") orderIds.add(entityId);
  }

  const [allProjectsResult, uploadProjectsResult, tasksOverviewResult, tasksMetaResult, ordersResult] = await Promise.all([
    supabase.from("project_overview_view").select("id,name,customer_id,customer_name"),
    supabase
      .from("project_dashboard_view")
      .select("id,name")
      .order("name", { ascending: true })
      .range(0, 999),
    taskIds.size > 0
      ? supabase
          .from("task_overview_view")
          .select("task_id,subject,project_id,project_name")
          .in("task_id", Array.from(taskIds))
      : Promise.resolve({ data: [] as TaskLookupRow[], error: null }),
    taskIds.size > 0
      ? supabase.from("tasks").select("id,project_id,customer_id").in("id", Array.from(taskIds))
      : Promise.resolve({ data: [] as TaskMetaRow[], error: null }),
    orderIds.size > 0
      ? supabase
          .from("order_overview_view")
          .select("order_id,customer_id,customer_name,order_date,status")
          .in("order_id", Array.from(orderIds))
      : Promise.resolve({ data: [] as OrderLookupRow[], error: null }),
  ]);

  const taskMetaRows = (tasksMetaResult.data ?? []) as TaskMetaRow[];
  const derivedCustomerIds = new Set<string>(Array.from(customerIds));
  for (const row of taskMetaRows) {
    const customerId = normalizeString(row.customer_id);
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

  const uploadProjectOptions: UploadProjectOption[] = ((uploadProjectsResult.data ?? []) as ProjectUploadRow[])
    .map((row) => ({
      id: row.id,
      label: normalizeString(row.name) || `פרויקט ${row.id.slice(0, 8)}`,
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
      const relatedCustomers = new Map<string, { id: string; label: string }>();
      const relatedOrders = new Map<string, { id: string; label: string }>();
      const relatedTasks = new Map<string, { id: string; label: string }>();
      const linkedEntities = new Map<string, LinkedEntity>();

      for (const link of docLinks) {
        const entityType = normalizeString(link.entity_type);
        const entityId = normalizeString(link.entity_id);
        if (!entityType || !entityId) continue;

        if (entityType === "project") {
          const project = projectsById.get(entityId);
          const label = normalizeString(project?.name) || `פרויקט ${entityId.slice(0, 8)}`;
          relatedProjects.set(entityId, { id: entityId, label });
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

          const customerId = normalizeString(taskMeta?.customer_id);
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
      const taskList = uniqueById(Array.from(relatedTasks.values())).sort(compareByLabel);
      const orderList = uniqueById(Array.from(relatedOrders.values())).sort(compareByLabel);

      return {
        id: doc.id,
        title,
        file_name: normalizeString(doc.file_name) || null,
        document_type: documentType || null,
        file_kind: inferFileKind(doc.file_name),
        storage_key: storageKey,
        uploaded_at: normalizeString(doc.uploaded_at) || normalizeString(latestLinkCreatedAt) || null,
        created_at: normalizeString(latestLinkCreatedAt) || null,
        url: typeof signedUrlData?.signedUrl === "string" ? signedUrlData.signedUrl : null,
        entity_types: Array.from(
          new Set(linkedEntityList.map((item) => item.type).filter(Boolean))
        ),
        linked_entities: linkedEntityList,
        customers: customerList,
        projects: projectList,
        tasks: taskList,
        orders: orderList,
        search_text: [
          title,
          normalizeString(doc.file_name),
          documentType,
          normalizeString(doc.notes),
          storageKey ?? "",
          ...linkedEntityList.map((item) => item.label),
          ...customerList.map((item) => item.label),
          ...projectList.map((item) => item.label),
          ...taskList.map((item) => item.label),
          ...orderList.map((item) => item.label),
        ]
          .join(" ")
          .toLowerCase(),
      };
    })
  );

  const initialFilters: DocumentArchiveFilters = {
    customer_id: normalizeString(params.customer_id) || "",
    customer_name: normalizeString(params.customer_name) || "",
    customer_page: normalizeString(params.customer_page) || "",
    project_id: normalizeString(params.project_id) || "",
    entity_type: normalizeString(params.entity_type) || "",
    type: normalizeString(params.type) || "",
    q: normalizeString(params.q) || "",
  };

  const errorMessage =
    documentsError?.message ??
    linksError?.message ??
    allProjectsResult.error?.message ??
    uploadProjectsResult.error?.message ??
    tasksOverviewResult.error?.message ??
    tasksMetaResult.error?.message ??
    customersResult.error?.message ??
    ordersResult.error?.message ??
    null;

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <DocumentsArchiveClient
        documents={archiveItems}
        error={errorMessage}
        initialFilters={initialFilters}
        projectOptions={uploadProjectOptions}
        totalDocuments={typeof count === "number" ? count : archiveItems.length}
        isTruncated={typeof count === "number" ? count > archiveItems.length : false}
      />
    </AppShell>
  );
}
