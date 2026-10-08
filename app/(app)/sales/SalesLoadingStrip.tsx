"use client";

import { usePathname } from "next/navigation";
import { PageHeaderToolbarSpace } from "@/components/layout/PageHeaderToolbar";

// Every sales tab has its search / filters in the phone's header strip, so the
// sales loading screen holds that strip open — the tab arriving then doesn't
// push the page down. Only on /sales itself: this loading screen also shows on
// the way to the pages under it (a new order, an order's edit page), which
// have no strip.
export default function SalesLoadingStrip() {
  return usePathname() === "/sales" ? <PageHeaderToolbarSpace /> : null;
}
