"use client";

import { useEffect, useState } from "react";
import { Phone } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormDialog } from "@/components/ui/form-dialog";
import { AssigneeSelect } from "@/components/collections/AssigneeSelect";
import { useAssignableUsers } from "@/hooks/useAssignableUsers";
import { offlineFetch } from "@/lib/offline-queue";
import { toHebrewError } from "@/lib/error-messages";

// A logged call is inherently customer-related, so these entities all resolve to
// a customer_id plus (optionally) their own FK on the communication log.
export type CommEntityType = "customer" | "order" | "project" | "property" | "payment";

const ENTITY_FK: Record<CommEntityType, string | null> = {
  customer: null, // entityId IS the customer
  order: "order_id",
  project: "project_id",
  property: "property_id",
  payment: "payment_id",
};

const CHANNELS = [
  { value: "phone", label: "טלפון" },
  { value: "whatsapp", label: "וואטסאפ" },
  { value: "email", label: "מייל" },
  { value: "sms", label: "SMS" },
  { value: "meeting", label: "פגישה" },
  { value: "other", label: "אחר" },
];

// The topic a communication is ABOUT — this is what makes the log reusable across
// the business instead of living inside collections.
const TOPICS = [
  { value: "collection", label: "גבייה" },
  { value: "sales", label: "מכירה" },
  { value: "service", label: "שירות" },
  { value: "delivery", label: "משלוח" },
  { value: "general", label: "כללי" },
];

/**
 * Universal "➕ תיעוד שיחה" button — log a call/WhatsApp/meeting from any entity,
 * tagged by topic, with an optional follow-up reminder in the same step.
 */
export default function LogCommunicationButton({
  entityType,
  entityId,
  customerId,
  defaultTopic = "general",
  className,
  iconOnly = false,
  onSaved,
  hideTrigger = false,
  open: openProp,
  onOpenChange,
}: {
  entityType: CommEntityType;
  entityId: string;
  customerId?: string | null;
  defaultTopic?: string;
  className?: string;
  iconOnly?: boolean;
  onSaved?: () => void;
  /** Render only the dialog — for callers that trigger it from their own menu. */
  hideTrigger?: boolean;
  /** Control the dialog from outside (pairs with hideTrigger). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const { currentUserId } = useAssignableUsers();
  const resolvedCustomerId = entityType === "customer" ? entityId : customerId ?? "";

  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const [channel, setChannel] = useState("phone");
  const [direction, setDirection] = useState<"outgoing" | "incoming" | "missed">("outgoing");
  const [topic, setTopic] = useState(defaultTopic);
  const [content, setContent] = useState("");
  const [withFollowUp, setWithFollowUp] = useState(false);
  const [remindAt, setRemindAt] = useState("");
  const [assignee, setAssignee] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setChannel("phone");
    setDirection("outgoing");
    setTopic(defaultTopic);
    setContent("");
    setWithFollowUp(false);
    setRemindAt("");
    setAssignee(currentUserId ?? "");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit() {
    if (submitting) return;
    setError(null);
    if (!resolvedCustomerId) {
      setError("לא נמצא לקוח מקושר לתיעוד השיחה.");
      return;
    }
    if (withFollowUp && !remindAt) {
      setError("יש לבחור מועד לתזכורת המעקב.");
      return;
    }
    setSubmitting(true);
    try {
      const fk = ENTITY_FK[entityType];
      const payload: Record<string, unknown> = {
        customer_id: resolvedCustomerId,
        channel,
        direction, // outgoing | incoming | missed
        category: topic,
        content: content.trim() || undefined,
      };
      if (fk) payload[fk] = entityId;
      if (withFollowUp) {
        payload.follow_up = {
          remind_at: new Date(remindAt).toISOString(),
          action_type: "call",
          assigned_to: assignee || undefined,
        };
      }

      const result = await offlineFetch("/api/communications/create", payload, "תיעוד שיחה", { idempotent: true });
      if (result.queued) {
        onSaved?.();
        setOpen(false);
        return;
      }
      if (!result.ok) {
        setError(toHebrewError(result.error, "שמירה נכשלה."));
        return;
      }
      toast.success("השיחה תועדה.");
      onSaved?.();
      setOpen(false);
      router.refresh();
    } catch (err: unknown) {
      setError(toHebrewError(err, "שמירה נכשלה."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {hideTrigger ? null : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={className ?? (iconOnly ? "h-9 w-9 p-0" : "h-9")}
          title="תיעוד שיחה"
          aria-label="תיעוד שיחה"
          onClick={() => setOpen(true)}
        >
          <Phone className="h-4 w-4 text-success" />
          {iconOnly ? null : <span className="ms-1">תיעוד שיחה</span>}
        </Button>
      )}

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="תיעוד שיחה"
        description="רישום פנייה נכנסת או יוצאת, מתויגת לפי נושא."
        size="formMd"
        onSubmit={() => void submit()}
        submitLabel="שמירה"
        busyLabel="שומר..."
        busy={submitting}
        error={error || undefined}
      >

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">ערוץ</label>
                <NativeSelect
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                >
                  {CHANNELS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">כיוון</label>
                <NativeSelect
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as "outgoing" | "incoming" | "missed")}
                >
                  <option value="outgoing">יוצאת</option>
                  <option value="incoming">נכנסת</option>
                  <option value="missed">שלא נענתה</option>
                </NativeSelect>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">נושא</label>
              <NativeSelect
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              >
                {TOPICS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">תוכן</label>
              <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={withFollowUp} onChange={(e) => setWithFollowUp(e.target.checked)} />
              <span>הוספת תזכורת מעקב</span>
            </label>
            {withFollowUp ? (
              <div className="space-y-3 rounded-lg border border-border/70 p-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">מתי להזכיר? *</label>
                  <Input type="datetime-local" value={remindAt} onChange={(e) => setRemindAt(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">אחראי</label>
                  <AssigneeSelect value={assignee} onChange={setAssignee} includeMeDefault />
                </div>
              </div>
            ) : null}

          </div>
      </FormDialog>
    </>
  );
}
