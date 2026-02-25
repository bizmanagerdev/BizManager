"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";
type TaskPriority = "low" | "medium" | "high" | "urgent";

function taskStatusLabel(status: TaskStatus | string) {
  switch (status) {
    case "todo":
      return "לביצוע";
    case "in_progress":
      return "בתהליך";
    case "blocked":
      return "בהמתנה";
    case "done":
      return "בוצע";
    case "cancelled":
      return "בוטל";
    default:
      return status;
  }
}

function taskPriorityLabel(priority: TaskPriority | string) {
  switch (priority) {
    case "low":
      return "נמוכה";
    case "medium":
      return "בינונית";
    case "high":
      return "גבוהה";
    case "urgent":
      return "דחופה";
    default:
      return priority;
  }
}

function priorityToVariant(priority: TaskPriority | string) {
  switch (priority) {
    case "low":
      return "secondary" as const;
    case "medium":
      return "warning" as const;
    case "high":
      return "destructive" as const;
    case "urgent":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

function statusToVariant(status: TaskStatus | string) {
  switch (status) {
    case "done":
      return "success" as const;
    case "in_progress":
      return "warning" as const;
    case "blocked":
      return "destructive" as const;
    case "todo":
      return "secondary" as const;
    case "cancelled":
      return "outline" as const;
    default:
      return "outline" as const;
  }
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("he-IL").format(date);
}

function formatIsoStamp(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("he-IL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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
};

export default function TaskDetailClient(props: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
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
      });
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
      const json = await res.json();
      if (!res.ok) {
        toast.error("שגיאה בהוספת הערה", { description: json?.error ?? "" });
        return;
      }
      toast.success("ההערה נוספה");
      setMessage("");
      router.refresh();
    } catch (e: any) {
      toast.error("שגיאה בהוספת הערה", { description: e?.message ?? "" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">{props.subject}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <div className="flex flex-wrap gap-2 items-center">
            <Badge variant={statusToVariant(props.status)}>
              {taskStatusLabel(props.status)}
            </Badge>
            {props.priority ? (
              <Badge variant={priorityToVariant(props.priority)}>
                {taskPriorityLabel(props.priority)}
              </Badge>
            ) : null}
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-muted-foreground">
            <div>תאריך יעד: <span className="text-foreground">{formatDate(props.dueDate)}</span></div>
            <div>משויך: <span className="text-foreground">{props.assignedUserName ?? "—"}</span></div>
            <div>פרויקט: <span className="text-foreground">{props.projectName ?? "—"}</span></div>
            <div>לקוח: <span className="text-foreground">{props.customerName ?? "—"}</span></div>
          </div>

          <div className="mt-3 pt-3 border-t">
            <div className="text-xs text-muted-foreground">תיאור</div>
            {descriptionText ? (
              <div className="mt-1 whitespace-pre-wrap">{descriptionText}</div>
            ) : (
              <div className="mt-1 text-muted-foreground">אין תיאור.</div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">תגובות</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          {entries.length === 0 ? (
            <div className="text-muted-foreground">אין הערות להצגה.</div>
          ) : (
            <div className="space-y-2">
              {entries.map((e: any, idx) => (
                <div key={idx} className="rounded-md border bg-card p-3">
                  {e.stamp && e.author ? (
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-xs font-mono text-muted-foreground">
                        [{formatIsoStamp(e.stamp)}]
                      </span>
                      <span className="text-sm font-medium">{e.author}:</span>
                    </div>
                  ) : null}
                  <div className="mt-1 whitespace-pre-wrap">
                    {e.message ?? e.raw}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="pt-2 border-t space-y-2">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="כתוב תגובה..."
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
