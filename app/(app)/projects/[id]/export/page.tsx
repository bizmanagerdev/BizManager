import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { formatShortDate, formatShortDateTime } from "@/lib/date";
import ProjectWorkerExportActions from "@/app/(app)/projects/[id]/export/ProjectWorkerExportActions";
import { formatMovingEndpoint } from "@/lib/projects/movingAddress";

import { STORAGE_BUCKET } from "@/lib/storage";

const DOCUMENTS_BUCKET = STORAGE_BUCKET;

type UnknownRow = Record<string, unknown>;

function getFirstString(row: UnknownRow | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = row?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function getStringArray(row: UnknownRow | null | undefined, key: string) {
  const value = row?.[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function formatDate(value: string | null | undefined) {
  return formatShortDate(value, "—");
}

function formatDateTime(value: string | null | undefined) {
  return formatShortDateTime(value, "—");
}

function projectStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "quote":
      return "הצעת מחיר";
    case "planned":
      return "מתוכנן";
    case "active":
      return "פעיל";
    case "on_hold":
      return "בהמתנה";
    case "completed":
      return "הושלם";
    case "cancelled":
      return "בוטל";
    default:
      return status ?? "—";
  }
}

function projectTypeLabel(type: string | null | undefined) {
  switch (type) {
    case "logistics":
      return "לוגיסטיקה";
    case "construction":
      return "שיפוצים";
    case "moving":
      return "הובלה";
    case "property_management":
      return "ניהול נכסים";
    case "sales":
      return "מכירות";
    default:
      return type ?? "—";
  }
}

function isImageFile(fileName: string | null | undefined, documentType: string | null | undefined) {
  const name = fileName?.toLowerCase() ?? "";
  return /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif)$/i.test(name) || documentType?.includes("photo");
}

export default async function ProjectWorkerExportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const rawMode = Array.isArray(resolvedSearchParams?.mode)
    ? resolvedSearchParams?.mode[0]
    : resolvedSearchParams?.mode;
  const mode = rawMode === "worker" || !rawMode ? "worker" : rawMode;

  const { supabase } = await requireStaffPage();

  const { data: overview } = await supabase
    .from("project_overview_view")
    .select(
      "id,name,status,project_type,start_date,end_date,customer_id,customer_name,project_manager_name"
    )
    .eq("id", id)
    .maybeSingle();

  if (!overview?.id) {
    notFound();
  }

  const { data: projectDetails } = await supabase
    .from("projects")
    .select(
      "id,notes,items_to_move,origin_address,origin_floor,origin_has_elevator,destination_address,destination_floor,destination_has_elevator"
    )
    .eq("id", id)
    .maybeSingle();

  const { data: customerRow } = await supabase
    .from("customer_overview_view")
    .select("customer_id,customer_name,phone,email,address")
    .eq("customer_id", overview.customer_id)
    .maybeSingle();

  const [{ data: taskRows }, { data: sessionRows }, { data: projectDocumentLinks }] = await Promise.all([
    supabase
      .from("task_overview_view")
      .select("task_id,subject,status,priority,due_date,assigned_user_name")
      .eq("project_id", id)
      .order("due_date", { ascending: true })
      .range(0, 199),
    supabase
      .from("attendance_sessions")
      .select("id,user_id,clock_in")
      .eq("project_id", id)
      .order("clock_in", { ascending: false })
      .range(0, 999),
    supabase
      .from("document_links")
      .select("document_id,entity_type,entity_id,created_at")
      .eq("entity_type", "project")
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .range(0, 199),
  ]);

  const sessionUserIds = Array.from(
    new Set(
      ((sessionRows ?? []) as UnknownRow[])
        .map((row) => getFirstString(row, ["user_id"]))
        .filter((value): value is string => Boolean(value))
    )
  );

  const { data: workerRows } =
    sessionUserIds.length > 0
      ? await supabase.from("users").select("id,full_name,email,phone").in("id", sessionUserIds)
      : { data: [] as UnknownRow[] };

  const workerById = new Map<string, UnknownRow>();
  ((workerRows ?? []) as UnknownRow[]).forEach((row) => {
    const userId = getFirstString(row, ["id"]);
    if (userId) workerById.set(userId, row);
  });

  const projectDocumentIds = Array.from(
    new Set(
      ((projectDocumentLinks ?? []) as UnknownRow[])
        .map((row) => getFirstString(row, ["document_id"]))
        .filter((value): value is string => Boolean(value))
    )
  );

  const { data: projectDocuments } =
    projectDocumentIds.length > 0
      ? await supabase
          .from("documents")
          .select("id,title,file_name,storage_key,uploaded_at,document_type")
          .in("id", projectDocumentIds)
      : { data: [] as UnknownRow[] };

  const documentById = new Map<string, UnknownRow>();
  ((projectDocuments ?? []) as UnknownRow[]).forEach((row) => {
    const documentId = getFirstString(row, ["id"]);
    if (documentId) documentById.set(documentId, row);
  });

  const attachmentRows = [];
  for (const link of (projectDocumentLinks ?? []) as UnknownRow[]) {
    const documentId = getFirstString(link, ["document_id"]);
    if (!documentId) continue;
    const doc = documentById.get(documentId);
    if (!doc) continue;
    const storageKey = getFirstString(doc, ["storage_key"]);
    const { data: signed } = storageKey
      ? await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(storageKey, 60 * 60)
      : { data: null };
    attachmentRows.push({
      id: documentId,
      title: getFirstString(doc, ["title", "file_name"]) ?? "קובץ",
      fileName: getFirstString(doc, ["file_name"]),
      documentType: getFirstString(doc, ["document_type"]),
      uploadedAt: getFirstString(doc, ["uploaded_at"]) ?? getFirstString(link, ["created_at"]),
      url: typeof signed?.signedUrl === "string" ? signed.signedUrl : null,
    });
  }

  const photoAttachments = attachmentRows.filter((attachment) =>
    isImageFile(attachment.fileName, attachment.documentType)
  );

  const workerList = sessionUserIds.map((userId) => {
    const user = workerById.get(userId);
    return {
      id: userId,
      name: getFirstString(user, ["full_name", "email"]) ?? "עובד",
      phone: getFirstString(user, ["phone"]),
    };
  });

  const exportGeneratedAt = new Date().toISOString();
  const projectName = getFirstString(overview as UnknownRow, ["name"]) ?? "פרויקט";
  const customerName = getFirstString(overview as UnknownRow, ["customer_name"]) ?? "ללא לקוח";
  const shareTitle = `דף עבודה לצוות - ${projectName} | ${customerName}`;
  const exportContentId = "project-worker-export-content";
  const pdfFileName = `worker-brief-${id.slice(0, 8)}.pdf`;
  const itemsToMove = getStringArray(projectDetails as UnknownRow | null, "items_to_move");
  const projectNotes = getFirstString(projectDetails as UnknownRow | null, ["notes"]);
  const isMovingProject = getFirstString(overview as UnknownRow, ["project_type"]) === "moving";
  const detailsRow = projectDetails as UnknownRow | null;
  const rawOriginElevator = detailsRow?.origin_has_elevator;
  const rawDestinationElevator = detailsRow?.destination_has_elevator;
  const moveOrigin = formatMovingEndpoint({
    address: getFirstString(detailsRow, ["origin_address"]),
    floor: getFirstString(detailsRow, ["origin_floor"]),
    hasElevator: typeof rawOriginElevator === "boolean" ? rawOriginElevator : null,
  });
  const moveDestination = formatMovingEndpoint({
    address: getFirstString(detailsRow, ["destination_address"]),
    floor: getFirstString(detailsRow, ["destination_floor"]),
    hasElevator: typeof rawDestinationElevator === "boolean" ? rawDestinationElevator : null,
  });
  const address = getFirstString(customerRow as UnknownRow | null, ["address"]);
  const customerPhone = getFirstString(customerRow as UnknownRow | null, ["phone"]);
  const customerEmail = getFirstString(customerRow as UnknownRow | null, ["email"]);
  const openTasks = ((taskRows ?? []) as UnknownRow[]).filter((row) => {
    const status = getFirstString(row, ["status"]);
    return status !== "done" && status !== "cancelled";
  });

  return (
    <div className="min-h-screen bg-muted/20 text-right" dir="rtl">
      <ProjectWorkerExportActions
        shareTitle={shareTitle}
        exportContentId={exportContentId}
        pdfFileName={pdfFileName}
      />
      <main className="mx-auto w-full max-w-[210mm] bg-background px-4 py-6 text-sm sm:px-8 print:max-w-none print:px-6 print:py-4">
        <div id={exportContentId} className="space-y-6 rounded-2xl border bg-background p-5 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
          <header className="space-y-4 border-b pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{mode === "worker" ? "דף עבודה לצוות" : "ייצוא פרויקט"}</Badge>
                  <Badge variant="secondary">{projectStatusLabel(getFirstString(overview as UnknownRow, ["status"]))}</Badge>
                </div>
                <h1 className="text-2xl font-semibold">{getFirstString(overview as UnknownRow, ["name"]) ?? "פרויקט"}</h1>
                <div className="text-muted-foreground">
                  {getFirstString(overview as UnknownRow, ["customer_name"]) ?? "ללא לקוח"}
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                הופק בתאריך {formatDateTime(exportGeneratedAt)}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <section className="rounded-xl border p-3">
                <div className="text-xs text-muted-foreground">לקוח</div>
                <div className="mt-1 font-medium">{getFirstString(overview as UnknownRow, ["customer_name"]) ?? "—"}</div>
                {customerPhone ? <div className="mt-1">{customerPhone}</div> : null}
                {customerEmail ? <div className="mt-1">{customerEmail}</div> : null}
              </section>
              <section className="rounded-xl border p-3">
                <div className="text-xs text-muted-foreground">פרטי פרויקט</div>
                <div className="mt-1">סוג: {projectTypeLabel(getFirstString(overview as UnknownRow, ["project_type"]))}</div>
                <div className="mt-1">התחלה: {formatDate(getFirstString(overview as UnknownRow, ["start_date"]))}</div>
                <div className="mt-1">סיום: {formatDate(getFirstString(overview as UnknownRow, ["end_date"]))}</div>
              </section>
              <section className="rounded-xl border p-3">
                <div className="text-xs text-muted-foreground">מנהל פרויקט</div>
                <div className="mt-1 font-medium">{getFirstString(overview as UnknownRow, ["project_manager_name"]) ?? "לא הוגדר"}</div>
              </section>
            </div>

            {isMovingProject && (moveOrigin || moveDestination) ? (
              <section className="rounded-xl border p-3">
                <div className="text-xs text-muted-foreground">מסלול ההובלה</div>
                <div className="mt-1 space-y-1 font-medium">
                  <div>
                    <span className="text-muted-foreground">מוצא: </span>
                    {moveOrigin || "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">יעד: </span>
                    {moveDestination || "—"}
                  </div>
                </div>
              </section>
            ) : null}

            {address ? (
              <section className="rounded-xl border p-3">
                <div className="text-xs text-muted-foreground">כתובת / כתובות</div>
                <div className="mt-1 whitespace-pre-wrap font-medium">{address}</div>
              </section>
            ) : null}
          </header>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6">
              <section className="space-y-2">
                <h2 className="text-lg font-semibold">צוות עובדים</h2>
                {workerList.length === 0 ? (
                  <div className="rounded-xl border p-3 text-muted-foreground">עדיין אין עובדים רשומים לפרויקט הזה.</div>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {workerList.map((worker) => (
                      <div key={worker.id} className="rounded-xl border p-3">
                        <div className="font-medium">{worker.name}</div>
                        {worker.phone ? <div className="mt-1 text-muted-foreground">{worker.phone}</div> : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <h2 className="text-lg font-semibold">משימות / צ׳קליסט</h2>
                {openTasks.length === 0 ? (
                  <div className="rounded-xl border p-3 text-muted-foreground">אין משימות פתוחות כרגע.</div>
                ) : (
                  <div className="space-y-2">
                    {openTasks.map((task) => (
                      <div
                        key={
                          getFirstString(task, ["task_id"]) ??
                          `${getFirstString(task, ["subject"]) ?? "task"}-${getFirstString(task, ["due_date"]) ?? "nodate"}`
                        }
                        className="flex items-start gap-3 rounded-xl border p-3"
                      >
                        <div className="mt-0.5 h-5 w-5 rounded border" />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{getFirstString(task, ["subject"]) ?? "משימה"}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {[
                              getFirstString(task, ["assigned_user_name"]) ? `אחראי: ${getFirstString(task, ["assigned_user_name"])}` : null,
                              getFirstString(task, ["due_date"]) ? `יעד: ${formatDate(getFirstString(task, ["due_date"]))}` : null,
                            ]
                              .filter(Boolean)
                              .join(" • ")}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="space-y-6">
              <section className="space-y-2">
                <h2 className="text-lg font-semibold">פריטים להעברה</h2>
                {itemsToMove.length === 0 ? (
                  <div className="rounded-xl border p-3 text-muted-foreground">לא הוגדרו פריטים להעברה.</div>
                ) : (
                  <ul className="space-y-2 rounded-xl border p-3">
                    {itemsToMove.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <span className="mt-1 inline-block h-2 w-2 rounded-full bg-foreground/70" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-2">
                <h2 className="text-lg font-semibold">הערות חשובות</h2>
                <div className="rounded-xl border p-3 whitespace-pre-wrap min-h-28">
                  {projectNotes || "אין הערות מיוחדות."}
                </div>
              </section>
            </div>
          </section>

          {photoAttachments.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">תמונות מצורפות</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {photoAttachments.slice(0, 6).map((attachment) => (
                  <div key={attachment.id} className="overflow-hidden rounded-xl border p-2">
                    {attachment.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={attachment.url}
                        alt={attachment.title}
                        className="h-48 w-full rounded-lg object-cover"
                      />
                    ) : null}
                    <div className="mt-2 text-xs text-muted-foreground">
                      {attachment.title}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {attachmentRows.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">קבצים מצורפים</h2>
              <div className="flex flex-wrap gap-2 print:hidden">
                {attachmentRows.map((attachment) => (
                  <Button key={attachment.id} asChild variant="outline" size="sm">
                    <Link href={attachment.url ?? "#"} target="_blank">
                      {attachment.title}
                    </Link>
                  </Button>
                ))}
              </div>
              <ul className="hidden space-y-1 print:block">
                {attachmentRows.map((attachment) => (
                  <li key={attachment.id}>{attachment.title}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}

