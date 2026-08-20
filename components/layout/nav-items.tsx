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
import { ActivityIcon, BankIcon, BuildingIcon, CalendarIcon, CardIcon, CashIcon, ChatIcon, ClockIcon, CoinsIcon, DashboardIcon, DeliveryIcon, FolderIcon, HomeIcon, OrderIcon, PaymentIcon, ProjectIcon, ReceiptIcon, ReportIcon, ScheduleIcon, SettingsIcon, TaskIcon, TransferIcon, UsersIcon, VehicleIcon, WalletIcon } from "@/components/ui/icons";

export type SidebarNavItem = {
  title: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
  children?: SidebarNavItem[];
};

const SIDEBAR_ITEMS: SidebarNavItem[] = [
  { title: "דשבורד", url: "/dashboard", icon: DashboardIcon },
  { title: "יומן", url: "/calendar", icon: CalendarIcon },
  { title: "פרויקטים", url: "/projects", icon: ProjectIcon },
  { title: "משימות", url: "/tasks", icon: TaskIcon },
  { title: "מכירות", url: "/sales", icon: OrderIcon },
  { title: "לקוחות", url: "/customers", icon: UsersIcon },
  { title: "תיעוד פניות", url: "/communications", icon: ChatIcon },
  {
    title: "נכסים",
    url: "/properties",
    icon: BuildingIcon,
    children: [
      { title: "דירות", url: "/properties", icon: HomeIcon },
      { title: "רכבים", url: "/vehicles", icon: VehicleIcon },
    ],
  },
  {
    title: "פיננסי",
    url: "/financial",
    icon: BankIcon,
    children: [
      { title: "תזרים", url: "/financial", icon: BankIcon },
      { title: "גבייה", url: "/collections", icon: CoinsIcon },
      { title: "תשלומים", url: "/financial/payments-calendar", icon: ScheduleIcon },
      { title: "דוחות", url: "/financial/reports", icon: ReportIcon },
      { title: "חשבונות", url: "/financial/bank", icon: TransferIcon },
      { title: "מע״מ ומסים", url: "/financial/taxes", icon: ReceiptIcon },
      { title: "צ׳קים", url: "/checks", icon: CashIcon },
      { title: "הלוואות", url: "/financial/loans", icon: PaymentIcon },
      { title: "כ. אשראי", url: "/financial/statements", icon: CardIcon },
    ],
  },
  {
    title: "עובדים",
    url: "/payroll",
    icon: WalletIcon,
    children: [
      { title: "עובדים ושכר", url: "/payroll", icon: WalletIcon },
      // The attendance queue is its own destination, not a tab inside the salary
      // center: it's the daily approve-shifts job, and it carries a count badge.
      { title: "דיווחי נוכחות", url: "/payroll/attendance", icon: ClockIcon },
    ],
  },
  { title: "מסמכים", url: "/documents", icon: FolderIcon },
  { title: "פעילות", url: "/activity", icon: ActivityIcon },
  { title: "הגדרות ניהול", url: "/settings", icon: SettingsIcon },
];

// Three tabs + עוד, with the centre "+" taking the middle slot — so the bar
// reads דשבורד · פרויקטים · [+] · מכירות · עוד. Five thumb targets, no more:
// everything else lives behind עוד.
const BOTTOM_NAV_ITEMS: SidebarNavItem[] = [
  { title: "דשבורד", url: "/dashboard", icon: DashboardIcon },
  { title: "פרויקטים", url: "/projects", icon: ProjectIcon },
  { title: "מכירות", url: "/sales", icon: OrderIcon },
];

const BOTTOM_NAV_MORE_ITEMS: SidebarNavItem[] = [
  { title: "לקוחות", url: "/customers", icon: UsersIcon },
  { title: "יומן", url: "/calendar", icon: CalendarIcon },
  { title: "משימות", url: "/tasks", icon: TaskIcon },
  { title: "גבייה", url: "/collections", icon: CoinsIcon },
  { title: "תיעוד פניות", url: "/communications", icon: ChatIcon },
  { title: "דירות", url: "/properties", icon: HomeIcon },
  { title: "רכבים", url: "/vehicles", icon: VehicleIcon },
  { title: "פיננסי", url: "/financial", icon: BankIcon },
  { title: "תשלומים", url: "/financial/payments-calendar", icon: ScheduleIcon },
  { title: "דוחות", url: "/financial/reports", icon: ReportIcon },
  { title: "חשבונות", url: "/financial/bank", icon: TransferIcon },
  { title: "מע״מ ומסים", url: "/financial/taxes", icon: ReceiptIcon },
  { title: "צ׳קים", url: "/checks", icon: CashIcon },
  { title: "הלוואות", url: "/financial/loans", icon: PaymentIcon },
  { title: "כ. אשראי", url: "/financial/statements", icon: CardIcon },
  { title: "עובדים", url: "/payroll", icon: WalletIcon },
  { title: "דיווחי נוכחות", url: "/payroll/attendance", icon: ClockIcon },
  { title: "מסמכים", url: "/documents", icon: FolderIcon },
  { title: "פעילות", url: "/activity", icon: ActivityIcon },
  { title: "הגדרות ניהול", url: "/settings", icon: SettingsIcon },
];

const ADMIN_ONLY_URLS = new Set(["/activity", "/financial", "/settings", "/financial/loans", "/financial/reports", "/financial/bank"]);
const ADMIN_OR_OFFICE_URLS = new Set<string>(["/payroll", "/payroll/attendance", "/collections", "/communications", "/checks", "/financial/statements", "/financial/taxes", "/financial/payments-calendar", "/vehicles"]);

// A worker's whole world — the deliveries he drives, his tasks and his calendar.
// (His hours and pay are on his profile, reached from the avatar, so they don't
// need a nav slot of their own.) This is NOT the security boundary — that's the
// server-side guards in lib/auth/roleAccess.ts, which allow the same prefixes;
// it just keeps him from being shown doors that would bounce him to /no-access.
const WORKER_NAV_ITEMS: SidebarNavItem[] = [
  { title: "דשבורד", url: "/dashboard", icon: DashboardIcon },
  { title: "משלוחים", url: "/deliveries", icon: DeliveryIcon },
  { title: "משימות", url: "/tasks", icon: TaskIcon },
  { title: "יומן", url: "/calendar", icon: CalendarIcon },
];

// Arabic labels for a worker who set locale='ar' — no "التوصيلات" (deliveries)
// slot: that route stays Hebrew-only, for Hebrew-speaking drivers.
const WORKER_NAV_ITEMS_AR: SidebarNavItem[] = [
  { title: "الرئيسية", url: "/dashboard", icon: DashboardIcon },
  { title: "المهام", url: "/tasks", icon: TaskIcon },
  { title: "التقويم", url: "/calendar", icon: CalendarIcon },
];

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

export function useNavItems(initialRole?: string | null, initialLocale?: string | null) {
  // No caching/fetch needed like role: AppShell mounts once per session (see its
  // "persist across navigations" comment) and the locale toggle in /profile
  // calls router.refresh(), which re-runs app/(app)/layout.tsx server-side and
  // feeds a fresh prop straight through — a plain default is enough.
  const workerNavItems = initialLocale === "ar" ? WORKER_NAV_ITEMS_AR : WORKER_NAV_ITEMS;
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
  const isWorker = viewerRole === "worker";

  const sidebarItems = useMemo(
    () => (isWorker ? workerNavItems : filterByRole(SIDEBAR_ITEMS, isAdmin, isOffice)),
    [isAdmin, isOffice, isWorker, workerNavItems]
  );
  // Three thumb targets + the centre "+", same as everyone else; the fourth
  // destination ("השעות שלי") sits behind עוד so the bar keeps its shape.
  const bottomNavItems = useMemo(
    () => (isWorker ? workerNavItems.slice(0, 3) : BOTTOM_NAV_ITEMS),
    [isWorker, workerNavItems]
  );
  const bottomNavMoreItems = useMemo(
    () => (isWorker ? workerNavItems.slice(3) : filterByRole(BOTTOM_NAV_MORE_ITEMS, isAdmin, isOffice)),
    [isAdmin, isOffice, isWorker, workerNavItems]
  );

  return { sidebarItems, bottomNavItems, bottomNavMoreItems };
}
