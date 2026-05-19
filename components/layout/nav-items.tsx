"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";

// useLayoutEffect is client-only (fires before paint, never on the server).
// Falling back to useEffect on the server means the initial SSR state stays null
// on both sides — no hydration mismatch — while the client restores the cached
// role synchronously before the first paint so admin tabs never flash away.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const ROLE_CACHE_KEY = "biz_viewer_role";
const ROLE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function readCachedRole(): string | null {
  try {
    const raw = localStorage.getItem(ROLE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { role: string; ts: number };
    if (Date.now() - parsed.ts > ROLE_CACHE_TTL_MS) return null;
    return parsed.role;
  } catch {
    return null;
  }
}

function writeCachedRole(role: string) {
  try {
    localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify({ role, ts: Date.now() }));
  } catch {
    // storage full or private mode
  }
}
import {
  Activity,
  Bell,
  Building2,
  FolderKanban,
  FolderOpen,
  Landmark,
  LayoutDashboard,
  ListTodo,
  MessageSquareMore,
  Settings,
  ShoppingCart,
  Users,
  Wallet,
} from "lucide-react";

export type SidebarNavItem = {
  title: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
};

const SIDEBAR_ITEMS: SidebarNavItem[] = [
  { title: "דשבורד", url: "/dashboard", icon: LayoutDashboard },
  { title: "התראות", url: "/alerts", icon: Bell },
  { title: "פרויקטים", url: "/projects", icon: FolderKanban },
  { title: "משימות", url: "/tasks", icon: ListTodo },
  { title: "מכירות", url: "/sales", icon: ShoppingCart },
  { title: "לקוחות", url: "/customers", icon: Users },
  { title: "פניות", url: "/inquiries", icon: MessageSquareMore },
  { title: "ניהול נכסים", url: "/properties", icon: Building2 },
  { title: "פיננסי", url: "/financial", icon: Landmark },
  { title: "עובדים ושכר", url: "/payroll", icon: Wallet },
  { title: "מסמכים", url: "/documents", icon: FolderOpen },
  { title: "פעילות", url: "/activity", icon: Activity },
  { title: "הגדרות ניהול", url: "/settings", icon: Settings },
];

const BOTTOM_NAV_ITEMS: SidebarNavItem[] = [
  { title: "דשבורד", url: "/dashboard", icon: LayoutDashboard },
  { title: "פרויקטים", url: "/projects", icon: FolderKanban },
  { title: "מכירות", url: "/sales", icon: ShoppingCart },
  { title: "לקוחות", url: "/customers", icon: Users },
  { title: "פניות", url: "/inquiries", icon: MessageSquareMore },
];

const BOTTOM_NAV_MORE_ITEMS: SidebarNavItem[] = [
  { title: "התראות", url: "/alerts", icon: Bell },
  { title: "משימות", url: "/tasks", icon: ListTodo },
  { title: "ניהול נכסים", url: "/properties", icon: Building2 },
  { title: "פיננסי", url: "/financial", icon: Landmark },
  { title: "עובדים ושכר", url: "/payroll", icon: Wallet },
  { title: "מסמכים", url: "/documents", icon: FolderOpen },
  { title: "פעילות", url: "/activity", icon: Activity },
  { title: "הגדרות ניהול", url: "/settings", icon: Settings },
];

const ADMIN_ONLY_URLS = new Set(["/payroll", "/activity"]);

function filterByRole(items: SidebarNavItem[], isAdmin: boolean) {
  return items.filter((item) => isAdmin || !ADMIN_ONLY_URLS.has(item.url));
}

export function useNavItems() {
  const [viewerRole, setViewerRole] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  // Restore cached role before first paint — client-only, no SSR mismatch.
  useIsomorphicLayoutEffect(() => {
    const cached = readCachedRole();
    if (cached) setViewerRole(cached);
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const cached = readCachedRole();

    let active = true;

    void fetch("/api/profile/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json().catch(() => null)) as { role?: string | null } | null;
      })
      .then((json) => {
        if (!active) return;
        const freshRole = typeof json?.role === "string" ? json.role : null;
        if (freshRole) {
          writeCachedRole(freshRole);
          setViewerRole(freshRole);
        } else if (!cached) {
          // Fetch failed and no cache — keep null
          setViewerRole(null);
        }
        // If fetch failed but cache exists, leave cached value in place
      })
      .catch(() => {
        // Network error — cached value already applied above, nothing to do
      });

    return () => {
      active = false;
    };
  }, []);

  const isAdmin = viewerRole === "admin";

  const sidebarItems = useMemo(
    () => filterByRole(SIDEBAR_ITEMS, isAdmin),
    [isAdmin]
  );
  const bottomNavMoreItems = useMemo(
    () => filterByRole(BOTTOM_NAV_MORE_ITEMS, isAdmin),
    [isAdmin]
  );

  return { sidebarItems, bottomNavItems: BOTTOM_NAV_ITEMS, bottomNavMoreItems };
}
