"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  emitProgressActivityEnd,
  emitProgressActivityStart,
} from "@/components/layout/TopNavigationProgress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatShortDate, formatShortDateTime } from "@/lib/date";
import { TaskUpsertDialog } from "@/components/tasks/TaskUpsertDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function formatDate(value: string | null) {
  return formatShortDate(value, "—");
}

function formatIsoStamp(iso: string) {
  return formatShortDateTime(iso, iso);
}

function formatBytes(value: number | null) {
  if (!value || value <= 0) return null;
  const kb = value / 1024;
  if (kb < 1024) return `${Math.round(kb)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)}GB`;
}

type TaskAttachment = {
  id: string;
  kind: string;
  mime_type: string | null;
  size_bytes: number | null;
  original_name: string | null;
  created_at: string;
  uploader_name?: string | null;
  url: string | null;
};

type NoteEntry = {
  raw: string;
  stamp: string | null;
  author: string | null;
  message: string | null;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "";
}

type Props = {
  taskId: string;
  subject: string;
  status: string;
  priority: string | null;
  dueDate: string | null;
  assignedUserName: string | null;
  projectName: string | null;
  customerName: string | null;
  description: string | null;
  notes: string | null;
  attachments: TaskAttachment[];
  userOptions: Array<{ id: string; label: string }>;
  fixedTarget: { type: "project" | "property"; id: string } | null;
  returnTo?: string | null;
};

function DetailItem({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{value || "—"}</div>
    </div>
  );
}

export default function TaskDetailClient(props: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteName, setDeleteName] = useState<string>("");
  const [deleting, setDeleting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [taskDeleting, setTaskDeleting] = useState(false);
  const descriptionText = (props.description ?? "").trim();

  const entries = useMemo(() => {
    const raw = (props.notes ?? "").trim();
    if (!raw) return [];
    return raw
      .split("\n\n")
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => {
        const match = text.match(/^\[(.+?)\]\s(.+?):\s([\s\S]*)$/);
        if (!match) return { raw: text, stamp: null, author: null, message: null };
        return {
          raw: text,
          stamp: match[1] ?? null,
          author: match[2] ?? null,
          message: match[3] ?? null,
        };
      }) as NoteEntry[];
  }, [props.notes]);

  async function addComment() {
    if (!message.trim()) return;
    setSubmitting(true);
    emitProgressActivityStart();
    try {
      const res = await fetch("/api/tasks/add-comment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task_id: props.taskId, message }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("שגיאה בהוספת תגובה", {
          description: json?.error ?? "",
        });
        return;
      }
      toast.success("התגובה נוספה");
      setMessage("");
      router.refresh();
    } catch (error: unknown) {
      toast.error("שגיאה בהוספת תגובה", {
        description: getErrorMessage(error),
      });
    } finally {
      emitProgressActivityEnd();
      setSubmitting(false);
    }
  }

  async function uploadAttachments(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    emitProgressActivityStart();
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set("task_id", props.taskId);
        form.set("file", file);

        const res = await fetch("/api/tasks/attachments/upload", {
          method: "POST",
          body: form,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error("שגיאה בהעלאת קובץ", {
            description: json?.error ?? "",
          });
          return;
        }
      }

      toast.success("הקבצים הועלו");
      router.refresh();
    } catch (error: unknown) {
      toast.error("שגיאה בהעלאת קובץ", {
        description: getErrorMessage(error),
      });
    } finally {
      emitProgressActivityEnd();
      setUploading(false);
    }
  }

  function openDeleteAttachment(documentId: string, name: string | null) {
    setDeleteId(documentId);
    setDeleteName(name ?? "");
    setDeleteOpen(true);
  }

  async function confirmDeleteAttachment() {
    if (!deleteId) return;
    setDeleting(true);
    emitProgressActivityStart();
    try {
      const res = await fetch("/api/documents/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document_id: deleteId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("שגיאה במחיקה", { description: json?.error ?? "" });
        return;
      }
      toast.success("הקובץ נמחק");
      setDeleteOpen(false);
      setDeleteId(null);
      setDeleteName("");
      router.refresh();
    } catch (error: unknown) {
      toast.error("שגיאה במחיקה", { description: getErrorMessage(error) });
    } finally {
      emitProgressActivityEnd();
      setDeleting(false);
    }
  }

  async function deleteTask() {
    const ok = window.confirm(`למחוק את המשימה "${props.subject}"?`);
    if (!ok) return;

    setTaskDeleting(true);
    emitProgressActivityStart();
    try {
      const res = await fetch("/api/tasks/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: props.taskId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("שגיאה במחיקת משימה", { description: json?.error ?? "" });
        return;
      }
      toast.success("המשימה נמחקה");
      router.push(props.returnTo ?? "/tasks");
      router.refresh();
    } catch (error: unknown) {
      toast.error("שגיאה במחיקת משימה", { description: getErrorMessage(error) });
    } finally {
      emitProgressActivityEnd();
      setTaskDeleting(false);
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="space-y-3 pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <CardTitle className="text-lg leading-tight">{props.subject}</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge value={props.status} type="task" />
                {props.priority ? <StatusBadge value={props.priority} type="priority" /> : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!props.fixedTarget?.id || props.userOptions.length === 0}
                onClick={() => setEditOpen(true)}
              >
                עריכה
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={taskDeleting}
                onClick={() => void deleteTask()}
              >
                {taskDeleting ? "מוחק..." : "מחיקה"}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3 pt-0 text-sm">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <DetailItem label="תאריך יעד" value={formatDate(props.dueDate)} />
            <DetailItem label="משויך" value={props.assignedUserName} />
            <DetailItem label="פרויקט" value={props.projectName} />
            <DetailItem label="לקוח" value={props.customerName} />
          </div>

          <div className="rounded-md border bg-muted/10 px-3 py-2">
            <div className="text-[11px] text-muted-foreground">תיאור</div>
            <div className="mt-1 whitespace-pre-wrap text-sm">
              {descriptionText || "אין תיאור."}
            </div>
          </div>
        </CardContent>
      </Card>

      <TaskUpsertDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        taskId={props.taskId}
        users={props.userOptions}
        fixedTarget={props.fixedTarget}
        onSaved={() => router.refresh()}
      />

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">קבצים מצורפים</CardTitle>
            <div className="flex items-center gap-2">
              <div className="text-xs text-muted-foreground">
                {props.attachments.length} קבצים
              </div>
              <FileUploadActions
                files={[]}
                accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt"
                multiple
                disabled={uploading}
                onFilesSelected={(files) => void uploadAttachments(files)}
                chooseLabel={uploading ? "מעלה..." : "הוספת קבצים"}
                showPreview={false}
                notifyOnAdd={false}
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0 text-sm">
          {props.attachments.length === 0 ? (
            <div className="text-muted-foreground">אין קבצים מצורפים.</div>
          ) : (
            <div className="space-y-2">
              {props.attachments.map((attachment) => {
                const meta = [
                  formatBytes(attachment.size_bytes),
                  attachment.created_at ? formatIsoStamp(attachment.created_at) : null,
                  attachment.uploader_name ? `הועלה ע"י ${attachment.uploader_name}` : null,
                ]
                  .filter(Boolean)
                  .join(" • ");

                return (
                  <div
                    key={attachment.id}
                    className="flex flex-col gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {attachment.url && attachment.kind === "image" ? (
                        <a href={attachment.url} target="_blank" rel="noreferrer">
                          <Image
                            src={attachment.url}
                            alt={attachment.original_name ?? "image"}
                            width={80}
                            height={80}
                            unoptimized
                            className="h-12 w-12 rounded-md object-cover"
                          />
                        </a>
                      ) : attachment.url && attachment.kind === "video" ? (
                        <video className="h-12 w-12 rounded-md bg-muted object-cover" src={attachment.url} />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
                          קובץ
                        </div>
                      )}

                      <div className="min-w-0">
                        {attachment.url ? (
                          <a
                            href={attachment.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate font-medium text-primary hover:underline"
                          >
                            {attachment.original_name ?? "קובץ"}
                          </a>
                        ) : (
                          <div className="truncate font-medium">{attachment.original_name ?? "קובץ"}</div>
                        )}
                        {meta ? (
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</div>
                        ) : null}
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => openDeleteAttachment(attachment.id, attachment.original_name)}
                    >
                      מחיקה
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && deleting) return;
          setDeleteOpen(open);
          if (!open) {
            setDeleteId(null);
            setDeleteName("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>מחיקת קובץ</DialogTitle>
            <DialogDescription>
              פעולה זו תמחק את הקובץ מהאחסון ואת הרשומה שלו מהמערכת.
            </DialogDescription>
          </DialogHeader>

          <div className="text-sm">
            למחוק את <span className="font-medium">{deleteName || "הקובץ"}</span>?
          </div>

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="secondary"
              disabled={deleting}
              onClick={() => setDeleteOpen(false)}
            >
              ביטול
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting || !deleteId}
              onClick={() => void confirmDeleteAttachment()}
            >
              {deleting ? "מוחק..." : "מחיקה"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">תגובות</CardTitle>
        </CardHeader>

        <CardContent className="space-y-3 pt-0 text-sm">
          {entries.length === 0 ? (
            <div className="text-muted-foreground">אין תגובות להצגה.</div>
          ) : (
            <div className="space-y-2">
              {entries.map((entry, index) => (
                <div key={index} className="rounded-md border px-3 py-2">
                  {entry.stamp && entry.author ? (
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-[11px] text-muted-foreground">
                        {formatIsoStamp(entry.stamp)}
                      </span>
                      <span className="text-sm font-medium">{entry.author}</span>
                    </div>
                  ) : null}
                  <div className="mt-1 whitespace-pre-wrap">{entry.message ?? entry.raw}</div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2 border-t pt-3">
            <Textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="כתבו תגובה..."
              className="min-h-24"
            />
            <div className="flex justify-end">
              <Button disabled={submitting || !message.trim()} onClick={() => void addComment()}>
                {submitting ? "שומר..." : "הוספת תגובה"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
