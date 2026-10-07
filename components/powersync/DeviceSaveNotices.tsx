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
} from "@/lib/powersync/local-writes";

// What the saves made on the device copy (lib/powersync/local-writes.ts) tell
// the person, wherever they are in the app:
// - the server refused one (not allowed, invalid): a toast with its reason —
//   the change itself is undone by the next sync;
// - one reached the server: a page the server draws (a project's page, the
//   inbox…) reloads its data, since it doesn't read the copy. Pages drawn from
//   the copy (they carry DeviceFrameMark's data-device-page) show it already.

const REFRESH_AFTER_MS = 400;

export default function DeviceSaveNotices({ locale }: { locale: Locale }) {
  const router = useRouter();

  useEffect(() => {
    const titles: Record<DeviceSaveKind, string> = {
      "task-status": t(tasksDict, locale, "toastErrorUpdateStatus"),
      "task-delete": t(tasksDict, locale, "toastErrorDeleteTask"),
      "task-create": t(tasksDict, locale, "toastErrorCreateTask"),
      "task-update": t(tasksDict, locale, "toastErrorUpdateTask"),
      "task-comment": t(tasksDict, locale, "toastErrorAddComment"),
    };
    const onRefused = (event: Event) => {
      const { kind, message } = (event as CustomEvent<DeviceSaveRefused>).detail;
      toast.error(titles[kind] ?? titles["task-update"], { description: message });
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSent = () => {
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
