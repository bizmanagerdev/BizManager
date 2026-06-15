import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { resolveUserDisplayNamesForValues } from "@/lib/audit";
import TaskDetailClient from "@/app/tasks/[id]/TaskDetailClient";

import { STORAGE_BUCKET } from "@/lib/storage";

const DOCUMENTS_BUCKET = STORAGE_BUCKET;

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
  due_time: string | null;
  city: string | null;
  address: string | null;
  project_id: string | null;
  property_id: string | null;
  business_domain: string | null;
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

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  active: boolean | null;
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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { profile, supabase } = await requireProfile();

  const { data: userRows } = await supabase
    .from("users")
    .select("id,full_name,email,active")
    .order("full_name", { ascending: true })
    .range(0, 499);

  const userOptions = ((userRows ?? []) as UserRow[])
    .filter((u) => u.active !== false && typeof u.id === "string" && u.id)
    .map((u) => ({ id: u.id, label: u.full_name ?? u.email ?? "" }))
    .filter((u) => Boolean(u.label));

  const { data: overview, error: overviewError } = await supabase
    .from("task_overview_view")
    .select(
      "task_id,subject,status,priority,due_date,project_id,project_name,assigned_user_id,assigned_user_name,created_at,updated_at"
    )
    .eq("task_id", id)
    .maybeSingle<TaskOverviewRow>();

  const { data: taskRow, error: taskError } = await supabase
    .from("tasks")
    .select("id,description,notes,due_time,city,address,project_id,property_id,business_domain")
    .eq("id", id)
    .maybeSingle<TaskRow>();

  // Members, structured comments and task reminders (Trello card data).
  const [membersResult, commentsResult, remindersResult] = await Promise.all([
    supabase.from("task_members").select("user_id").eq("task_id", id),
    supabase
      .from("task_comments")
      .select("id,author_id,body,created_at")
      .eq("task_id", id)
      .order("created_at", { ascending: true })
      .range(0, 199),
    supabase
      .from("reminders")
      .select("id,remind_at,content,status,assigned_to")
      .eq("task_id", id)
      .order("remind_at", { ascending: true })
      .range(0, 99),
  ]);

  const memberUserIds = ((membersResult.data ?? []) as Array<{ user_id: string | null }>)
    .map((r) => (typeof r.user_id === "string" ? r.user_id : null))
    .filter((v): v is string => Boolean(v));
  const commentRows = (commentsResult.data ?? []) as Array<Record<string, unknown>>;
  const reminderRows = (remindersResult.data ?? []) as Array<Record<string, unknown>>;

  const nameValues = [
    ...memberUserIds,
    ...commentRows.map((r) => (typeof r.author_id === "string" ? r.author_id : null)),
    ...reminderRows.map((r) => (typeof r.assigned_to === "string" ? r.assigned_to : null)),
  ].filter((v): v is string => Boolean(v));
  const nameMap = await resolveUserDisplayNamesForValues(supabase, nameValues);

  const members = memberUserIds.map((userId) => ({ id: userId, name: nameMap[userId] ?? "" }));
  const comments = commentRows.map((r) => ({
    id: typeof r.id === "string" ? r.id : "",
    author_id: typeof r.author_id === "string" ? r.author_id : null,
    author_name: typeof r.author_id === "string" ? nameMap[r.author_id] ?? null : null,
    body: typeof r.body === "string" ? r.body : "",
    created_at: typeof r.created_at === "string" ? r.created_at : "",
  }));
  const reminders = reminderRows.map((r) => ({
    id: typeof r.id === "string" ? r.id : "",
    remind_at: typeof r.remind_at === "string" ? r.remind_at : "",
    content: typeof r.content === "string" ? r.content : null,
    status: typeof r.status === "string" ? r.status : "pending",
    assigned_to: typeof r.assigned_to === "string" ? r.assigned_to : null,
    assigned_to_name: typeof r.assigned_to === "string" ? nameMap[r.assigned_to] ?? null : null,
  }));

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

  const propertyId =
    typeof taskRow?.property_id === "string" ? taskRow.property_id : null;

  const fixedTarget = projectId
    ? { type: "project" as const, id: projectId }
    : propertyId
      ? { type: "property" as const, id: propertyId }
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

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
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
            dueTime={taskRow?.due_time ?? null}
            city={taskRow?.city ?? null}
            address={taskRow?.address ?? null}
            assignedUserName={overview.assigned_user_name ?? null}
            members={members}
            projectName={projectOverview?.name ?? overview.project_name ?? null}
            customerName={projectOverview?.customer_name ?? null}
            description={taskRow?.description ?? null}
            notes={taskRow?.notes ?? null}
            comments={comments}
            reminders={reminders}
            attachments={attachments}
            userOptions={userOptions}
            fixedTarget={fixedTarget}
          />
        )}
      </div>
    </AppShell>
  );
}
