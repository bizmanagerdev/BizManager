"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ellipsis, Mail, MessageCircle, MessageSquare, Pencil, Phone, Users, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import AddCollectionEntryDialog from "@/components/collections/AddCollectionEntryDialog";
import EditCommunicationDialog, { type EditableCommunication } from "@/components/communications/EditCommunicationDialog";
import { channelLabel, directionLabel, type CommunicationLogWithCustomer } from "@/lib/communications";
import { formatShortDateTime } from "@/lib/date";

const TOPICS = [
  { value: "all", label: "כל הנושאים" },
  { value: "collection", label: "גבייה" },
  { value: "sales", label: "מכירה" },
  { value: "service", label: "שירות" },
  { value: "delivery", label: "משלוח" },
  { value: "general", label: "כללי" },
];
const CHANNELS = [
  { value: "all", label: "כל הערוצים" },
  { value: "phone", label: "טלפון" },
  { value: "whatsapp", label: "וואטסאפ" },
  { value: "email", label: "מייל" },
  { value: "sms", label: "SMS" },
  { value: "meeting", label: "פגישה" },
  { value: "other", label: "אחר" },
];
const TOPIC_LABEL: Record<string, string> = {
  collection: "גבייה",
  sales: "מכירה",
  service: "שירות",
  delivery: "משלוח",
  general: "כללי",
};

// The channel IS the icon — a phone for a call, a bubble for WhatsApp, etc.
const CHANNEL_ICON: Record<string, LucideIcon> = {
  phone: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  sms: MessageSquare,
  meeting: Users,
};

// Whole-row colour by direction: incoming = blue, outgoing = green, missed = red.
// Kept clearly distinct so green vs blue read apart at a glance.
function directionRowClass(direction: string | null | undefined): string {
  if (direction === "incoming") return "border-info/60 bg-info/25";
  if (direction === "missed") return "border-destructive/60 bg-destructive/20";
  // outgoing (default) — the same green as the call phone icon (success token).
  return "border-success/70 bg-success/15";
}

// Shared column template so every row (and the header) lines up into a table.
const GRID = "grid grid-cols-[1.5rem_minmax(9rem,1.4fr)_7rem_4.5rem_minmax(0,3fr)_9rem_2rem] items-center gap-x-3";

export default function CommunicationsClient({ logs }: { logs: CommunicationLogWithCustomer[] }) {
  const router = useRouter();
  const [topic, setTopic] = useState("all");
  const [channel, setChannel] = useState("all");
  const [search, setSearch] = useState("");
  const [addCallOpen, setAddCallOpen] = useState(false);
  const [editing, setEditing] = useState<EditableCommunication | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (deletedIds.has(l.id)) return false;
      if (topic !== "all" && (l.category ?? "general") !== topic) return false;
      if (channel !== "all" && l.channel !== channel) return false;
      if (q) {
        const hay = `${l.customer_name ?? ""} ${l.customer_phone ?? ""} ${l.content ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, topic, channel, search, deletedIds]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setAddCallOpen(true)}>
          <Phone className="me-1 h-4 w-4 text-success" />
          תיעוד שיחה
        </Button>
        <select value={topic} onChange={(e) => setTopic(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          {TOPICS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          {CHANNELS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש לפי שם, טלפון או תוכן…" className="h-10 max-w-xs flex-1" />
        <div className="text-sm text-muted-foreground">{filtered.length} פניות</div>
      </div>

      <AddCollectionEntryDialog mode="call" open={addCallOpen} onOpenChange={setAddCallOpen} onSaved={() => router.refresh()} />
      <EditCommunicationDialog
        log={editing}
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={() => router.refresh()}
        onDeleted={(id) => setDeletedIds((prev) => new Set(prev).add(id))}
      />

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">אין פניות שתואמות את הסינון.</CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[54rem] space-y-1">
            {/* Header */}
            <div className={`${GRID} px-2.5 pb-1 text-xs text-muted-foreground`}>
              <span />
              <span>לקוח</span>
              <span>טלפון</span>
              <span>נושא</span>
              <span>תוכן</span>
              <span>תאריך</span>
              <span />
            </div>

            {filtered.map((l) => {
              const Icon = CHANNEL_ICON[l.channel] ?? Ellipsis;
              return (
                <div
                  key={l.id}
                  title={`${directionLabel(l.direction)} · ${channelLabel(l.channel)}`}
                  className={`${GRID} rounded-lg border px-2.5 py-1.5 text-sm ${directionRowClass(l.direction)}`}
                >
                  <Icon className="h-4 w-4 text-foreground/70" />
                  <div className="min-w-0 truncate font-medium">
                    {l.customer_id ? (
                      <Link href={`/customers/${l.customer_id}`} className="hover:underline">
                        {l.customer_name ?? "לקוח"}
                      </Link>
                    ) : (
                      l.customer_name ?? "—"
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{l.customer_phone ?? "—"}</div>
                  <div className="truncate text-xs text-muted-foreground">{TOPIC_LABEL[l.category] ?? l.category}</div>
                  <div className="min-w-0 truncate text-muted-foreground">{l.content ?? "—"}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {formatShortDateTime(l.created_at, "-")}
                    {l.created_by_name ? ` · ${l.created_by_name}` : ""}
                  </div>
                  <button
                    type="button"
                    aria-label="עריכה"
                    title="עריכה"
                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background/60 hover:text-foreground"
                    onClick={() =>
                      setEditing({ id: l.id, channel: l.channel, direction: l.direction, category: l.category, content: l.content })
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
