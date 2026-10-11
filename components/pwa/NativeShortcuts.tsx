"use client";

import { useEffect } from "react";
import { hasDeliveriesAccess, type SectionAccess } from "@/lib/auth/sections";
import type { UserRole } from "@/lib/auth/requireProfile";

// The phone app's long-press shortcuts (APK 1.2), per person. The app starts
// with the owner's four (משלוחים, הזמנה חדשה, משימה חדשה, חיפוש — AppShortcuts.java);
// a worker can't create an order or use the search, so his are what he can do.
// Set from here, through BizHNative.setShortcuts, so they can change without a
// new APK. Renders nothing; does nothing in a browser or an older app.

type Shortcut = { id: string; label: string; url: string; icon: string };

/** The shortcuts for this person, in order (the first sits nearest the icon). */
export function shortcutsFor(role: string | undefined, locale: string | null | undefined, access: SectionAccess): Shortcut[] {
  if (role !== "worker") {
    return [
      { id: "deliveries", label: "משלוחים", url: "/deliveries", icon: "delivery" },
      { id: "new-order", label: "הזמנה חדשה", url: "/dashboard?quick=order", icon: "order" },
      { id: "new-task", label: "משימה חדשה", url: "/dashboard?quick=task", icon: "task" },
      { id: "search", label: "חיפוש", url: "/dashboard?quick=search", icon: "search" },
    ];
  }
  const arabic = locale === "ar";
  const list: Shortcut[] = [];
  // Deliveries stays Hebrew-only (nav-items.tsx), so an Arabic worker isn't offered it.
  if (!arabic && hasDeliveriesAccess(role as UserRole, access)) {
    list.push({ id: "deliveries", label: "משלוחים", url: "/deliveries", icon: "delivery" });
  }
  list.push(
    { id: "new-task", label: arabic ? "مهمة جديدة" : "משימה חדשה", url: "/dashboard?quick=task", icon: "task" },
    { id: "new-reminder", label: arabic ? "تذكير جديد" : "תזכורת חדשה", url: "/dashboard?quick=reminder", icon: "reminder" }
  );
  return list;
}

type CapacitorGlobal = {
  PluginHeaders?: Array<{ name: string; methods?: Array<{ name: string }> }>;
  Plugins?: Record<string, unknown>;
};

export default function NativeShortcuts({
  role,
  locale,
  access,
}: {
  role?: string;
  locale?: string | null;
  access: SectionAccess;
}) {
  const key = JSON.stringify(shortcutsFor(role, locale, access));

  useEffect(() => {
    if (!role) return;
    const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
    const canSet = capacitor?.PluginHeaders?.find((h) => h.name === "BizHNative")?.methods?.some((m) => m.name === "setShortcuts");
    if (!canSet) return;
    void (async () => {
      try {
        const { registerPlugin } = await import("@capacitor/core");
        type Plugin = { setShortcuts(options: { items: Shortcut[] }): Promise<void> };
        const bizh = (capacitor?.Plugins?.BizHNative as Plugin | undefined) ?? registerPlugin<Plugin>("BizHNative");
        await bizh.setShortcuts({ items: JSON.parse(key) as Shortcut[] });
      } catch {
        // The app keeps the shortcuts it has.
      }
    })();
  }, [key, role]);

  return null;
}
