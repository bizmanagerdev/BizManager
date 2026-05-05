"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
};

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
  const descriptionText = (props.description ?? "").trim();

  const entries = useMemo(() => {
    const raw = (props.notes ?? "").trim();
    if (!raw) return [];
    return raw
      .split("\n\n")
      .map((t) => t.trim())
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
    try {
      const res = await fetch("/api/tasks/add-comment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task_id: props.taskId, message }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("\u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05D4\u05D5\u05E1\u05E4\u05EA \u05D4\u05E2\u05E8\u05D4", {
          description: json?.error ?? "",
        });
        return;
      }
      toast.success("\u05D4\u05D4\u05E2\u05E8\u05D4 \u05E0\u05D5\u05E1\u05E4\u05D4");
      setMessage("");
      router.refresh();
    } catch (e: unknown) {
      toast.error("\u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05D4\u05D5\u05E1\u05E4\u05EA \u05D4\u05E2\u05E8\u05D4", {
        description: getErrorMessage(e),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function uploadAttachments(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
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
          toast.error("\u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05D4\u05E2\u05DC\u05D0\u05EA \u05E7\u05D5\u05D1\u05E5", {
            description: json?.error ?? "",
          });
          return;
        }
      }

      toast.success("\u05D4\u05E7\u05D1\u05E6\u05D9\u05DD \u05D4\u05D5\u05E2\u05DC\u05D5");
      router.refresh();
    } catch (e: unknown) {
      toast.error("\u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05D4\u05E2\u05DC\u05D0\u05EA \u05E7\u05D5\u05D1\u05E5", {
        description: getErrorMessage(e),
      });
    } finally {
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
    } catch (e: unknown) {
      toast.error("שגיאה במחיקה", { description: getErrorMessage(e) });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-3 flex-row items-start justify-between gap-3">
          <CardTitle className="text-lg">{props.subject}</CardTitle>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!props.fixedTarget?.id || props.userOptions.length === 0}
            onClick={() => setEditOpen(true)}
          >
            עריכה
          </Button>
        </CardHeader>
        <CardContent className="text-sm">
          <div className="flex flex-wrap gap-2 items-center">
            <StatusBadge value={props.status} type="task" />
            {props.priority ? (
              <StatusBadge value={props.priority} type="priority" />
            ) : null}
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-muted-foreground">
            <div>
              {"\u05EA\u05D0\u05E8\u05D9\u05DA \u05D9\u05E2\u05D3"}:{" "}
              <span className="text-foreground">{formatDate(props.dueDate)}</span>
            </div>
            <div>
              {"\u05DE\u05E9\u05D5\u05D9\u05DA"}:{" "}
              <span className="text-foreground">{props.assignedUserName ?? "—"}</span>
            </div>
            <div>
              {"\u05E4\u05E8\u05D5\u05D9\u05E7\u05D8"}:{" "}
              <span className="text-foreground">{props.projectName ?? "—"}</span>
            </div>
            <div>
              {"\u05DC\u05E7\u05D5\u05D7"}:{" "}
              <span className="text-foreground">{props.customerName ?? "—"}</span>
            </div>
          </div>

          <div className="mt-3 pt-3 border-t">
            <div className="text-xs text-muted-foreground">{"\u05EA\u05D9\u05D0\u05D5\u05E8"}</div>
            {descriptionText ? (
              <div className="mt-1 whitespace-pre-wrap">{descriptionText}</div>
            ) : (
              <div className="mt-1 text-muted-foreground">{"\u05D0\u05D9\u05DF \u05EA\u05D9\u05D0\u05D5\u05E8."}</div>
            )}
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
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {"\u05E7\u05D1\u05E6\u05D9\u05DD \u05DE\u05E6\u05D5\u05E8\u05E4\u05D9\u05DD"}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          <div className="flex items-center justify-between gap-2">
            <FileUploadActions
              files={[]}
              accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt"
              multiple
              disabled={uploading}
              onFilesSelected={(files) => void uploadAttachments(files)}
              chooseLabel={uploading ? "\u05DE\u05E2\u05DC\u05D4..." : "\u05D4\u05D5\u05E1\u05E4\u05EA \u05E7\u05D1\u05E6\u05D9\u05DD"}
            />
            <div className="text-xs text-muted-foreground">
              {props.attachments.length} {"\u05E7\u05D1\u05E6\u05D9\u05DD"}
            </div>
          </div>

          {props.attachments.length === 0 ? (
            <div className="text-muted-foreground">
              {"\u05D0\u05D9\u05DF \u05E7\u05D1\u05E6\u05D9\u05DD \u05DE\u05E6\u05D5\u05E8\u05E4\u05D9\u05DD."}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {props.attachments.map((a) => {
                const meta = [
                  a.original_name ?? null,
                  formatBytes(a.size_bytes),
                  a.created_at ? formatIsoStamp(a.created_at) : null,
                  a.uploader_name ? `הוזן ע״י ${a.uploader_name}` : null,
                ]
                  .filter(Boolean)
                  .join(" \u2022 ");

                return (
                  <div key={a.id} className="rounded-md border bg-card p-2">
                    {a.url && a.kind === "image" ? (
                      <a href={a.url} target="_blank" rel="noreferrer">
                        <Image
                          src={a.url}
                          alt={a.original_name ?? "image"}
                          width={1200}
                          height={704}
                          unoptimized
                          className="h-44 w-full rounded-md object-cover"
                        />
                      </a>
                    ) : a.url && a.kind === "video" ? (
                      <video
                        className="h-44 w-full rounded-md bg-muted object-cover"
                        src={a.url}
                        controls
                      />
                    ) : a.url ? (
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-md border bg-muted/30 p-3 text-primary hover:underline"
                      >
                        {a.original_name ?? "file"}
                      </a>
                    ) : (
                      <div className="rounded-md border bg-muted/30 p-3 text-muted-foreground">
                        {"\u05DC\u05D0 \u05E0\u05D9\u05EA\u05DF \u05DC\u05D8\u05E2\u05D5\u05DF \u05EA\u05E6\u05D5\u05D2\u05D4."}
                      </div>
                    )}

                    {meta ? (
                      <div className="mt-2 text-xs text-muted-foreground truncate">{meta}</div>
                    ) : null}

                    <div className="mt-2 flex justify-end">
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => openDeleteAttachment(a.id, a.original_name)}
                      >
                        מחיקה
                      </Button>
                    </div>
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
              פעולה זו תמחק את הקובץ מ־Storage ואת הרשומה מהמערכת (אם יש הרשאה).
            </DialogDescription>
          </DialogHeader>

          <div className="text-sm">
            למחוק את: <span className="font-medium">{deleteName || "קובץ"}</span> ?
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
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{"\u05EA\u05D2\u05D5\u05D1\u05D5\u05EA"}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          {entries.length === 0 ? (
            <div className="text-muted-foreground">
              {"\u05D0\u05D9\u05DF \u05D4\u05E2\u05E8\u05D5\u05EA \u05DC\u05D4\u05E6\u05D2\u05D4."}
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map((e, idx) => (
                <div key={idx} className="rounded-md border bg-card p-3">
                  {e.stamp && e.author ? (
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-xs font-mono text-muted-foreground">
                        [{formatIsoStamp(e.stamp)}]
                      </span>
                      <span className="text-sm font-medium">{e.author}:</span>
                    </div>
                  ) : null}
                  <div className="mt-1 whitespace-pre-wrap">{e.message ?? e.raw}</div>
                </div>
              ))}
            </div>
          )}

          <div className="pt-2 border-t space-y-2">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={"\u05DB\u05EA\u05D5\u05D1 \u05EA\u05D2\u05D5\u05D1\u05D4..."}
            />
            <div className="flex justify-end">
              <Button disabled={submitting || !message.trim()} onClick={() => void addComment()}>
                {submitting ? "\u05E9\u05D5\u05DE\u05E8..." : "\u05D4\u05D5\u05E1\u05E4\u05EA \u05EA\u05D2\u05D5\u05D1\u05D4"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
