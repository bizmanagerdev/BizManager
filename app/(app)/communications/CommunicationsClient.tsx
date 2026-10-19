"use client";

import { useDeferredValue, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChatIcon, CommentIcon, MailIcon, MoreIcon, PhoneIcon, UsersIcon } from "@/components/ui/icons";
import type { IconComponent } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import AddCollectionEntryDialog from "@/components/collections/AddCollectionEntryDialog";
import EditCommunicationDialog, { type EditableCommunication } from "@/components/communications/EditCommunicationDialog";
import { channelLabel, directionLabel, type CommunicationLogWithCustomer } from "@/lib/communications";
import { formatShortDateTime } from "@/lib/date";
import { EditButton } from "@/components/ui/icon-button";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { Painted, SearchTermsProvider } from "@/components/search/Painted";
import { hourOf, searchList, type SearchRecord } from "@/lib/search/listSearch";

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
const CHANNEL_ICON: Record<string, IconComponent> = {
  phone: PhoneIcon,
  whatsapp: ChatIcon,
  email: MailIcon,
  sms: CommentIcon,
  meeting: UsersIcon,
};

// Whole-row colour by direction: incoming = blue, outgoing = green, missed = red.
// Kept clearly distinct so green vs blue read apart at a glance.
function directionRowClass(direction: string | null | undefined): string {
  if (direction === "incoming") return "border-info/60 bg-info/25";
  if (direction === "missed") return "border-destructive/60 bg-destructive/20";
  // outgoing (default) — the same green as the call phone icon (success token).
  return "border-success/70 bg-success/15";
}

// The search, by the global search's rules: everything the row shows — the
// customer and phone (however typed), the topic, what was said, the day and
// hour, who logged it, and the channel and direction.
function communicationSearchRecord(l: CommunicationLogWithCustomer): SearchRecord {
  return {
    text: [
      [null, l.customer_name],
      [null, l.content],
      [null, TOPIC_LABEL[l.category] ?? l.category],
      [null, l.created_by_name],
      [null, channelLabel(l.channel)],
      [null, directionLabel(l.direction)],
      [null, hourOf(l.created_at)],
    ],
    dates: [[null, l.created_at]],
    phones: [[null, l.customer_phone]],
  };
}

// Shared column template so every row (and the header) lines up into a table.
const GRID = "grid grid-cols-[1.5rem_minmax(9rem,1.4fr)_7rem_4.5rem_minmax(0,3fr)_9rem_2rem] items-center gap-x-3";

export default function CommunicationsClient({ logs: logsProp }: { logs: CommunicationLogWithCustomer[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const logs = useUndoOverlay(logsProp, (l) => l.id, "communication");
  const [topic, setTopic] = useState("all");
  const [channel, setChannel] = useState("all");
  const [search, setSearch] = useState("");
  const [addCallOpen, setAddCallOpen] = useState(false);
  const [editing, setEditing] = useState<EditableCommunication | null>(null);

  const deferredSearch = useDeferredValue(search);
  const found = useMemo(() => searchList(logs, communicationSearchRecord, deferredSearch), [logs, deferredSearch]);
  const filtered = useMemo(
    () =>
      logs.filter((l) => {
        if (topic !== "all" && (l.category ?? "general") !== topic) return false;
        if (channel !== "all" && l.channel !== channel) return false;
        return !found || found.reasons.has(l);
      }),
    [logs, topic, channel, found]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setAddCallOpen(true)}>
          <PhoneIcon className="h-4 w-4 text-success" />
          תיעוד שיחה
        </Button>
        <NativeSelect value={topic} onChange={(e) => setTopic(e.target.value)}>
          {TOPICS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={channel} onChange={(e) => setChannel(e.target.value)}>
          {CHANNELS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="שם, טלפון, תוכן, תאריך או שעה…" className="h-10 max-w-xs flex-1" />
        <div className="text-sm text-muted-foreground">{filtered.length} פניות</div>
      </div>

      <AddCollectionEntryDialog mode="call" open={addCallOpen} onOpenChange={setAddCallOpen} onSaved={() => startTransition(() => { router.refresh(); })} />
      {editing ? (
        <EditCommunicationDialog
          key={editing.id}
          log={editing}
          onClose={() => setEditing(null)}
          onSaved={() => startTransition(() => { router.refresh(); })}
        />
      ) : null}

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">אין פניות שתואמות את הסינון.</CardContent>
        </Card>
      ) : (
        <SearchTermsProvider terms={found?.search.terms ?? null}>
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
              const Icon = CHANNEL_ICON[l.channel] ?? MoreIcon;
              return (
                <div
                  key={l.id}
                  data-focus-id={l.id}
                  title={`${directionLabel(l.direction)} · ${channelLabel(l.channel)}`}
                  className={`${GRID} rounded-lg border px-2.5 py-1.5 text-sm ${directionRowClass(l.direction)}`}
                >
                  <Icon className="h-4 w-4 text-foreground/70" />
                  <div className="min-w-0 font-medium">
                    {l.customer_id ? (
                      <Link href={`/customers/${l.customer_id}`} className="hover:underline">
                        <Painted text={l.customer_name ?? "לקוח"} />
                      </Link>
                    ) : (
                      <Painted text={l.customer_name ?? "—"} />
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground"><Painted text={l.customer_phone ?? "—"} /></div>
                  <div className="text-xs text-muted-foreground"><Painted text={TOPIC_LABEL[l.category] ?? l.category} /></div>
                  <div className="min-w-0 text-muted-foreground"><Painted text={l.content ?? "—"} /></div>
                  <div className="text-xs text-muted-foreground">
                    <Painted text={formatShortDateTime(l.created_at, "-")} />
                    {l.created_by_name ? <> · <Painted text={l.created_by_name} /></> : ""}
                  </div>
                  <EditButton onClick={() =>
                      setEditing({ id: l.id, channel: l.channel, direction: l.direction, category: l.category, content: l.content })
                    } label="עריכה" />
                </div>
              );
            })}
          </div>
        </div>
        </SearchTermsProvider>
      )}
    </div>
  );
}
