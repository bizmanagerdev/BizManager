"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { t } from "@/lib/i18n/t";
import { tasksDict } from "@/lib/i18n/dictionaries/tasks";
import type { Locale } from "@/lib/i18n/types";
import {
  DEVICE_SAVE_REFUSED_EVENT,
  DEVICE_SAVE_SENT_EVENT,
  type DeviceSaveKind,
  type DeviceSaveRefused,
  type DeviceSaveSent,
} from "@/lib/powersync/local-writes";
import { notifyAlertsChanged, resyncAlerts } from "@/lib/ui/alerts-refresh";
import { refreshAlerts } from "@/lib/ui/alerts-store";
import { loadDraft, saveDraft } from "@/lib/offline-queue";
import { useLocalDatabase } from "@/lib/powersync/store";
import { retryParkedSaves } from "@/lib/powersync/connector";
import {
  DEVICE_SAVE_PARKED_EVENT,
  PARKED_SAVE_SENT_EVENT,
  PARKED_SAVES_RETRY_EVENT,
  type DeviceSaveParked,
  type ParkedSaveSent,
} from "@/lib/powersync/parked-saves";

// What the saves made on the device copy (lib/powersync/local-writes.ts) tell
// the person, wherever they are in the app:
// - the server refused one (not allowed, invalid): a toast with its reason —
//   the change itself is undone by the next sync; a refused new order is put
//   back as the order form's draft, so nothing typed is lost;
// - the server kept failing one: it's parked on the phone to be sent again
//   (lib/powersync/parked-saves.ts) — a toast says so, and another when it has
//   gone up. This sends the parked ones again: soon after the app opens, every
//   few minutes, when the connection comes back, when the app is looked at
//   again, and when the waiting list asks (its "שלח עכשיו");
// - one reached the server: a page the server draws (a project's page, the
//   inbox…) reloads its data, since it doesn't read the copy. Pages drawn from
//   the copy (they carry DeviceFrameMark's data-device-page) show it already.

const REFRESH_AFTER_MS = 400;
/** Parked saves sent again this long after the app opens, then this often. */
const PARKED_FIRST_RETRY_MS = 5_000;
const PARKED_RETRY_MS = 3 * 60_000;

/** The new-order form's two drafts (the page, the + menu). */
const ORDER_DRAFT_KEYS = ["order-create", "quick-create-order"];

/**
 * Put a refused new order back as the order form's draft — under its own
 * form's key, or the other one if a new order is already being written
 * there (never over it). False when both are taken.
 */
function keepAsDraft(key: string, draft: unknown): boolean {
  for (const candidate of [key, ...ORDER_DRAFT_KEYS.filter((other) => other !== key)]) {
    if (loadDraft(candidate)) continue;
    saveDraft(candidate, draft);
    return true;
  }
  return false;
}

export default function DeviceSaveNotices({ locale }: { locale: Locale }) {
  const router = useRouter();
  const db = useLocalDatabase();

  useEffect(() => {
    if (!db) return;
    const retry = () => void retryParkedSaves(db).catch(() => {});
    const onVisible = () => {
      if (document.visibilityState === "visible") retry();
    };
    const first = window.setTimeout(retry, PARKED_FIRST_RETRY_MS);
    const timer = window.setInterval(retry, PARKED_RETRY_MS);
    window.addEventListener("online", retry);
    window.addEventListener(PARKED_SAVES_RETRY_EVENT, retry);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      window.removeEventListener("online", retry);
      window.removeEventListener(PARKED_SAVES_RETRY_EVENT, retry);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [db]);

  useEffect(() => {
    const onParked = (event: Event) => {
      const { label } = (event as CustomEvent<DeviceSaveParked>).detail;
      toast.warning("השרת לא ענה — השמירה ממתינה בטלפון", {
        description: `${label}. היא תישלח שוב לבד; אפשר לראות אותה ב"פרטים" בפס שלמעלה.`,
        duration: 10_000,
      });
    };
    const onParkedSent = (event: Event) => {
      const { label } = (event as CustomEvent<ParkedSaveSent>).detail;
      toast.success("השמירה שהמתינה בטלפון הגיעה לשרת", { description: label });
    };
    window.addEventListener(DEVICE_SAVE_PARKED_EVENT, onParked);
    window.addEventListener(PARKED_SAVE_SENT_EVENT, onParkedSent);
    return () => {
      window.removeEventListener(DEVICE_SAVE_PARKED_EVENT, onParked);
      window.removeEventListener(PARKED_SAVE_SENT_EVENT, onParkedSent);
    };
  }, []);

  useEffect(() => {
    const titles: Record<DeviceSaveKind, string> = {
      "task-status": t(tasksDict, locale, "toastErrorUpdateStatus"),
      "task-delete": t(tasksDict, locale, "toastErrorDeleteTask"),
      "task-create": t(tasksDict, locale, "toastErrorCreateTask"),
      "task-update": t(tasksDict, locale, "toastErrorUpdateTask"),
      "task-comment": t(tasksDict, locale, "toastErrorAddComment"),
      "task-comment-edit": t(tasksDict, locale, "toastErrorEditComment"),
      "task-comment-delete": t(tasksDict, locale, "toastErrorDeleteComment"),
      "task-snooze": t(tasksDict, locale, "toastErrorSnooze"),
      "customer-create": "הלקוח לא נשמר",
      "project-create": "הפרויקט לא נשמר",
      "project-update": "השינויים בפרויקט לא נשמרו",
      "project-status": "סטטוס הפרויקט לא עודכן",
      "project-approve-quote": "אישור הצעת המחיר לא נשמר",
      "project-price": "מחיר הבסיס לא עודכן",
      "order-create": "ההזמנה לא נשמרה",
      "order-update": "השינויים בהזמנה לא נשמרו",
      "order-payment": "התשלום להזמנה לא נשמר",
      "project-payment": "ההכנסה לפרויקט לא נשמרה",
      "payment-collected": "סימון הגבייה לא נשמר",
      "reminder-action": "ההתראה לא עודכנה",
      "expense-create": "ההוצאה לא נשמרה",
      "income-create": "ההכנסה לא נשמרה",
      "ledger-check": "הסימון \"נבדק מול הבנק\" לא נשמר",
      "expense-delete": "ההוצאה לא נמחקה",
      "payment-delete": "התשלום לא נמחק",
      "order-payment-delete": "התשלום לא נמחק",
      "worker-payment-delete": "התשלום לעובד לא נמחק",
      "loan-delete": "ההלוואה לא נמחקה",
      "repayment-delete": "החזר ההלוואה לא נמחק",
      "card-charge-delete": "חיוב האשראי לא נמחק",
      "transfer-delete": "ההעברה לא נמחקה",
    };
    const onRefused = (event: Event) => {
      const { kind, message, restore } = (event as CustomEvent<DeviceSaveRefused>).detail;
      const kept = restore ? keepAsDraft(restore.key, restore.draft) : false;
      toast.error(titles[kind] ?? titles["task-update"], {
        description: kept ? `${message} — ההזמנה חזרה לטיוטה: פתחו "הזמנה חדשה" כדי לתקן ולשלוח שוב.` : message,
        duration: kept ? 12_000 : undefined,
      });
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSent = (event: Event) => {
      const kind = (event as CustomEvent<DeviceSaveSent>).detail?.kind ?? "";
      // A project priced (or marked ללא חיוב) resolves the "closed unbilled" alert.
      if (kind.startsWith("project-")) void resyncAlerts();
      // A reminder acted on: the bell, the alert strip and the badges, which the server counts.
      if (kind === "reminder-action") {
        refreshAlerts();
        notifyAlertsChanged();
      }
      if (document.querySelector("[data-device-page]")) return;
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), REFRESH_AFTER_MS);
    };
    window.addEventListener(DEVICE_SAVE_REFUSED_EVENT, onRefused);
    window.addEventListener(DEVICE_SAVE_SENT_EVENT, onSent);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(DEVICE_SAVE_REFUSED_EVENT, onRefused);
      window.removeEventListener(DEVICE_SAVE_SENT_EVENT, onSent);
    };
  }, [locale, router]);

  return null;
}
