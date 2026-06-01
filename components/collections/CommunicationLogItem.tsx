"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  COMMUNICATION_CHANNELS,
  channelLabel,
  directionLabel,
  type CommunicationLog,
} from "@/lib/communications";

type LogItem = CommunicationLog & {
  customer_name?: string | null;
  customer_phone?: string | null;
};

function formatDateTime(value: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("he-IL", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

// One logged contact in a timeline — shows the call details and lets an
// admin/office user edit or delete it. Used in the גבייה activity feed and the
// per-customer מעקב גבייה panel.
export default function CommunicationLogItem({
  log,
  showCustomer = false,
  onChanged,
}: {
  log: LogItem;
  showCustomer?: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [channel, setChannel] = useState(log.channel);
  const [direction, setDirection] = useState(log.direction);
  const [content, setContent] = useState(log.content ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/communications/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: log.id, channel, direction, content: content.trim() || null }),
      });
      if (res.ok) {
        setEditing(false);
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/communications/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: log.id }),
      });
      if (res.ok) onChanged();
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-border/60 bg-background/50 p-2 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {COMMUNICATION_CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="outgoing">שיחה יוצאת</option>
            <option value="incoming">שיחה נכנסת</option>
          </select>
        </div>
        <Textarea
          className="mt-2"
          rows={2}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="מה סוכם? מה הלקוח אמר?"
        />
        <div className="mt-2 flex justify-end gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => void save()}
            disabled={busy}
          >
            {busy ? "שומר..." : "שמירה"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => {
              setEditing(false);
              setChannel(log.channel);
              setDirection(log.direction);
              setContent(log.content ?? "");
            }}
            disabled={busy}
          >
            ביטול
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-background/50 p-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {showCustomer ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {log.customer_id ? (
                <NavLink to={`/customers/${log.customer_id}`} className="font-medium hover:underline">
                  {log.customer_name ?? "לקוח"}
                </NavLink>
              ) : (
                <span className="font-medium">{log.customer_name ?? "כללי"}</span>
              )}
              {log.customer_phone ? (
                <a href={`tel:${log.customer_phone}`} className="text-xs text-muted-foreground hover:underline">
                  ☎ {log.customer_phone}
                </a>
              ) : null}
            </div>
          ) : null}
          <div
            className={`flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground ${showCustomer ? "mt-1" : ""}`}
          >
            <span>{channelLabel(log.channel)}</span>
            <span>· {directionLabel(log.direction)}</span>
            <span>· {formatDateTime(log.created_at)}</span>
            {log.created_by_name ? <span>· {log.created_by_name}</span> : null}
          </div>
          {log.content ? <div className="mt-1">{log.content}</div> : null}
        </div>
        <div className="flex shrink-0 gap-1">
          {confirmDelete ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="h-7 text-xs"
                onClick={() => void remove()}
                disabled={busy}
              >
                {busy ? "מוחק..." : "אישור"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setConfirmDelete(false)}
                disabled={busy}
              >
                ביטול
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title="עריכה"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-destructive hover:text-destructive"
                title="מחיקה"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
