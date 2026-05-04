import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { resolveUserDisplayNamesForValues } from "@/lib/audit";
import TaskDetailClient from "@/app/tasks/[id]/TaskDetailClient";

const DOCUMENTS_BUCKET = "business-documents";

type TaskOverviewRow = {
  task_id: string;
  subject: string | null;
  status: string | null;
  priority: string | null;
  due_date: string | null;
  project_id: string | null;
  project_name: string | null;
  assigned_user_name: string | null;
};

type TaskRow = {
  id: string;
  description: string | null;
  notes: string | null;
  project_id: string | null;
  customer_id: string | null;
};

type DocumentLinkRow = {
  document_id: string | null;
  created_at: string | null;
};

type DocumentRow = {
  id: string;
  document_type: string | null;
  file_name: string | null;
  storage_key: string | null;
  uploaded_at: string | null;
  uploaded_by?: string | null;
};

type ProjectLookupRow = {
  id: string;
  name: string | null;
  customer_name: string | null;
};

type Attachment = {
  id: string;
  kind: string;
  mime_type: string | null;
  size_bytes: number | null;
  original_name: string | null;
  created_at: string;
  uploader_name: string | null;
  url: string | null;
};

function inferKindFromFilename(name: string | null) {
  const value = (name ?? "").toLowerCase();
  const ext = value.includes(".") ? value.split(".").pop() ?? "" : "";

  const imageExts = new Set([
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp",
    "bmp",
    "svg",
    "heic",
  ]);
  const videoExts = new Set([
    "mp4",
    "mov",
    "webm",
    "mkv",
    "avi",
    "m4v",
  ]);

  if (imageExts.has(ext)) return "image";
  if (videoExts.has(ext)) return "video";
  return "file";
}

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ returnTo?: string }>;
}) {
  const { id } = await params;
  const { returnTo } = (await searchParams) ?? {};
  const { profile, supabase } = await requireProfile();

  const { data: overview, error: overviewError } = await supabase
    .from("task_overview_view")
    .select(
      "task_id,subject,status,priority,due_date,project_id,project_name,assigned_user_id,assigned_user_name,created_at,updated_at"
    )
    .eq("task_id", id)
    .maybeSingle<TaskOverviewRow>();

  const { data: taskRow, error: taskError } = await supabase
    .from("tasks")
    .select("id,description,notes,project_id,customer_id")
    .eq("id", id)
    .maybeSingle<TaskRow>();

  let attachments: Attachment[] = [];

  try {
      const { data: links, error: linksError } = await supabase
        .from("document_links")
        .select("document_id,created_at")
      .eq("entity_type", "task")
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
        .range(0, 49);

      if (!linksError && links && links.length > 0) {
        const docIds = (links as DocumentLinkRow[])
          .map((l) => (typeof l.document_id === "string" ? l.document_id : null))
          .filter((value): value is string => Boolean(value));

        const { data: docs, error: docsError } = await supabase
          .from("documents")
          .select("id,document_type,file_name,storage_key,uploaded_at,uploaded_by")
          .in("id", docIds);

        if (!docsError && docs) {
          const uploaderNames = await resolveUserDisplayNamesForValues(
            supabase,
            (docs as DocumentRow[])
              .map((doc) => (typeof doc.uploaded_by === "string" ? doc.uploaded_by : null))
              .filter((value): value is string => Boolean(value))
          );
          const docById = new Map<string, DocumentRow>(
            (docs as DocumentRow[]).map((d) => [String(d.id), d])
          );

          const resolved = await Promise.all(
            (links as DocumentLinkRow[]).map(async (l): Promise<Attachment | null> => {
              const docId = typeof l.document_id === "string" ? l.document_id : "";
              const doc = docById.get(docId);
              if (!doc) return null;

            const key = typeof doc.storage_key === "string" ? doc.storage_key : "";
            const name = typeof doc.file_name === "string" ? doc.file_name : null;
            const kind = inferKindFromFilename(name);

              const { data: signed, error: signError } = key
                ? await supabase.storage
                    .from(DOCUMENTS_BUCKET)
                    .createSignedUrl(key, 60 * 60)
                : { data: null, error: null };

            return {
              id: docId,
              kind,
              mime_type: null,
              size_bytes: null,
              original_name: name,
              created_at:
                (typeof doc.uploaded_at === "string" && doc.uploaded_at) ||
                (typeof l.created_at === "string" ? l.created_at : new Date().toISOString()),
              uploader_name:
                typeof doc.uploaded_by === "string" ? uploaderNames[doc.uploaded_by] ?? null : null,
              url: signError ? null : signed?.signedUrl ?? null,
            };
          })
          );

          attachments = resolved.filter((value): value is Attachment => value !== null);
        }
      }
  } catch {
    // If the table/bucket isn't created yet, don't break the task page render.
    attachments = [];
  }

  const projectId =
    typeof taskRow?.project_id === "string"
      ? taskRow.project_id
      : typeof overview?.project_id === "string"
        ? overview.project_id
        : null;

  const { data: projectOverview } = projectId
    ? await supabase
        .from("project_overview_view")
        .select("id,name,customer_name")
        .eq("id", projectId)
        .maybeSingle<ProjectLookupRow>()
    : { data: null as ProjectLookupRow | null };

  const error =
    overviewError?.message ?? taskError?.message ?? null;

  const safeReturnTo =
    typeof returnTo === "string" && returnTo.startsWith("/") ? returnTo : null;

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">משימות</h1>
          <Link
            className="text-sm text-primary"
            href={safeReturnTo ?? "/tasks"}
          >
            {safeReturnTo ? "חזרה לפרויקט" : "חזרה לרשימת משימות"}
          </Link>
        </div>

        {error ? (
          <div className="text-destructive text-sm">שגיאה: {error}</div>
        ) : !overview ? (
          <div className="text-muted-foreground">משימה לא נמצאה.</div>
        ) : (
          <TaskDetailClient
            taskId={overview.task_id}
            subject={overview.subject ?? "משימה"}
            status={overview.status ?? "todo"}
            priority={overview.priority ?? null}
            dueDate={overview.due_date ?? null}
            assignedUserName={overview.assigned_user_name ?? null}
            projectName={projectOverview?.name ?? overview.project_name ?? null}
            customerName={projectOverview?.customer_name ?? null}
            description={taskRow?.description ?? null}
            notes={taskRow?.notes ?? null}
            attachments={attachments}
          />
        )}
      </div>
    </AppShell>
  );
}
