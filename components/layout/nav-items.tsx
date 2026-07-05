"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";

// useLayoutEffect is client-only (fires before paint, never on the server).
// Falling back to useEffect on the server means the initial SSR state stays null
// on both sides — no hydration mismatch — while the client restores the cached
// role synchronously before the first paint so admin tabs never flash away.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const ROLE_CACHE_KEY = "biz_viewer_role";
const ROLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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
  ArrowLeftRight,
  Banknote,
  Building2,
  CalendarDays,
  Car,
  Coins,
  CreditCard,
  FileBarChart,
  FolderKanban,
  FolderOpen,
  HandCoins,
  Landmark,
  LayoutDashboard,
  ListTodo,
  MessageCircle,
  Receipt,
  Settings,
  ShoppingCart,
  Users,
  Wallet,
} from "lucide-react";

export type SidebarNavItem = {
  title: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
  children?: SidebarNavItem[];
};

const SIDEBAR_ITEMS: SidebarNavItem[] = [
  { title: "דשבורד", url: "/dashboard", icon: LayoutDashboard },
  { title: "יומן", url: "/calendar", icon: CalendarDays },
  { title: "פרויקטים", url: "/projects", icon: FolderKanban },
  { title: "משימות", url: "/tasks", icon: ListTodo },
  { title: "מכירות", url: "/sales", icon: ShoppingCart },
  { title: "לקוחות", url: "/customers", icon: Users },
  { title: "גבייה וחייבים", url: "/collections", icon: Coins },
  { title: "תיעוד פניות", url: "/communications", icon: MessageCircle },
  { title: "ניהול נכסים", url: "/properties", icon: Building2 },
  { title: "רכבים", url: "/vehicles", icon: Car },
  {
    title: "פיננסי",
    url: "/financial",
    icon: Landmark,
    children: [
      { title: "תזרים", url: "/financial", icon: Landmark },
      { title: "דוחות (רווח והפסד)", url: "/financial/reports", icon: FileBarChart },
      { title: "חשבונות", url: "/financial/bank", icon: ArrowLeftRight },
      { title: "מע״מ ומסים", url: "/financial/taxes", icon: Receipt },
      { title: "צ׳קים", url: "/checks", icon: Banknote },
      { title: "הלוואות והחזרים", url: "/financial/loans", icon: HandCoins },
      { title: "כרטיסי אשראי", url: "/financial/statements", icon: CreditCard },
    ],
  },
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
  { title: "גבייה", url: "/collections", icon: Coins },
];

const BOTTOM_NAV_MORE_ITEMS: SidebarNavItem[] = [
  { title: "יומן", url: "/calendar", icon: CalendarDays },
  { title: "משימות", url: "/tasks", icon: ListTodo },
  { title: "תיעוד פניות", url: "/communications", icon: MessageCircle },
  { title: "ניהול נכסים", url: "/properties", icon: Building2 },
  { title: "רכבים", url: "/vehicles", icon: Car },
  { title: "פיננסי", url: "/financial", icon: Landmark },
  { title: "דוחות (רווח והפסד)", url: "/financial/reports", icon: FileBarChart },
  { title: "חשבונות", url: "/financial/bank", icon: ArrowLeftRight },
  { title: "מע״מ ומסים", url: "/financial/taxes", icon: Receipt },
  { title: "צ׳קים", url: "/checks", icon: Banknote },
  { title: "הלוואות והחזרים", url: "/financial/loans", icon: HandCoins },
  { title: "כרטיסי אשראי", url: "/financial/statements", icon: CreditCard },
  { title: "עובדים ושכר", url: "/payroll", icon: Wallet },
  { title: "מסמכים", url: "/documents", icon: FolderOpen },
  { title: "פעילות", url: "/activity", icon: Activity },
  { title: "הגדרות ניהול", url: "/settings", icon: Settings },
];

const ADMIN_ONLY_URLS = new Set(["/activity", "/financial", "/settings", "/financial/loans", "/financial/reports", "/financial/bank"]);
const ADMIN_OR_OFFICE_URLS = new Set<string>(["/payroll", "/collections", "/communications", "/checks", "/financial/statements", "/financial/taxes", "/vehicles"]);

function filterByRole(items: SidebarNavItem[], isAdmin: boolean, isOffice: boolean): SidebarNavItem[] {
  return items.flatMap((item) => {
    if (item.children) {
      const children = filterByRole(item.children, isAdmin, isOffice);
      return children.length > 0 ? [{ ...item, children }] : [];
    }
    if (ADMIN_ONLY_URLS.has(item.url)) return isAdmin ? [item] : [];
    if (ADMIN_OR_OFFICE_URLS.has(item.url)) return isAdmin || isOffice ? [item] : [];
    return [item];
  });
}

export function useNavItems(initialRole?: string | null) {
  const [viewerRole, setViewerRole] = useState<string | null>(() => {
    // Server-provided role takes priority; fall back to localStorage cache.
    if (initialRole) return initialRole;
    if (typeof window !== "undefined") return readCachedRole();
    return null;
  });
  const fetchedRef = useRef(false);

  // Sync server-provided role into cache so subsequent loads benefit.
  useIsomorphicLayoutEffect(() => {
    if (initialRole) {
      writeCachedRole(initialRole);
      setViewerRole(initialRole);
      return;
    }
    const cached = readCachedRole();
    if (cached) setViewerRole(cached);
  }, [initialRole]);

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
  const isOffice = viewerRole === "office";

  const sidebarItems = useMemo(
    () => filterByRole(SIDEBAR_ITEMS, isAdmin, isOffice),
    [isAdmin, isOffice]
  );
  const bottomNavMoreItems = useMemo(
    () => filterByRole(BOTTOM_NAV_MORE_ITEMS, isAdmin, isOffice),
    [isAdmin, isOffice]
  );

  return { sidebarItems, bottomNavItems: BOTTOM_NAV_ITEMS, bottomNavMoreItems };
}
