"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { NetworkIcon } from "@/components/ui/icons";
import { hasDoneConnectionCheck, subscribeConnectionCheckDone } from "@/lib/connection-check";

// TEMPORARY (2026-10-05): the first thing on an admin's dashboard — please run
// the half-minute connection check (/connection-check) on this device. Gone
// from a device once the check has run there; the results are stored on their
// own. Remove with the check.

const TEXT = {
  he: {
    title: "בדיקת חיבור",
    body: "אנחנו עושים בדיקה כדי לראות אם משהו עובד עם הסינון. נא ללחוץ על הקישור.",
    action: "לבדיקה",
  },
  ar: {
    title: "فحص الاتصال",
    body: "نقوم بفحص لنرى إن كان شيء ما يعمل مع الفلتر. الرجاء الضغط على الرابط.",
    action: "للفحص",
  },
} as const;

export default function ConnectionCheckCard({ locale }: { locale: "he" | "ar" }) {
  // On the server and the first render: shown (most devices haven't run it).
  const done = useSyncExternalStore(subscribeConnectionCheckDone, hasDoneConnectionCheck, () => false);
  if (done) return null;
  const text = TEXT[locale];
  return (
    <Link
      href="/connection-check"
      className="flex items-center gap-3 rounded-[1.125rem] border-2 border-primary/40 bg-primary/5 p-4 transition-colors hover:bg-primary/10"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <NetworkIcon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block font-semibold">{text.title}</span>
        <span className="block text-sm text-muted-foreground">{text.body}</span>
      </span>
      <span className="hidden shrink-0 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground sm:block">
        {text.action}
      </span>
    </Link>
  );
}
