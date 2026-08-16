"use client";

// The top-bar "+" — create anything from anywhere without leaving the page.
// The whole point: you're deep in /financial or /sales, you need to jot a task or
// log an expense, and you should not have to navigate away and find your place
// again. Every action opens a dialog ON TOP of the current page; closing it (or
// saving) leaves you exactly where you were.
//
// This is now the app's ONLY quick-action surface. The dashboard used to carry a
// tile grid of its own with a partly-overlapping, partly-different set; that grid
// is gone and everything it offered lives here, so "where do I add a…" has one
// answer on every screen.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { AddIcon, AddUserIcon, CashIcon, ClockIcon, ExpenseIcon, IncomeIcon, NotificationIcon, OrderIcon, PaymentIcon, ProjectIcon, SpinnerIcon, TaskIcon, TimerIcon, TransferIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { HoverPanel, HoverPanelContent, HoverPanelTrigger, useHoverPanel } from "@/components/ui/hover-panel";
import { ViewDialog } from "@/components/ui/view-dialog";
import { TOPBAR_ICON_BUTTON, TOPBAR_ICON_STROKE } from "@/components/layout/topbar-icon";
import { QUICK_TILE_CLASS_SM, QuickTileContent } from "@/components/ui/quick-tile";
import {
  EMPTY_QUICK_CREATE_DATA,
  type QuickCreateAction,
  type QuickCreateData,
} from "@/components/layout/quick-create-types";

// The dialogs (order wizard, project wizard, expense form…) are a big chunk of
// JS. Nobody pays for it until the + menu is first opened.
const QuickCreateDialogs = dynamic(() => import("@/components/layout/QuickCreateDialogs"), { ssr: false });

type MenuItem = { action: QuickCreateAction; label: string; icon: typeof TaskIcon };

// Laid out two per row, in this order: the everyday create flows first, then
// money, then the payroll ones an admin reaches for far less often.
// Glyphs here carry NO "+" badge (Bell, not BellPlus): the whole grid already
// lives behind the + button, so every tile repeating it is noise. The user's call.
//
// לקוח was pulled from this menu on 2026-08-10 (a customer is nearly always
// created inside an order or project wizard) but the dashboard grid kept its own
// "לקוח חדש" tile. With that grid gone this is the only place left for it, so
// it's back. מסמך stays tile-less — a document is uploaded from the record it
// belongs to — though the ACTION still exists for the `bizh:quick-create` event.
const MENU_ITEMS: MenuItem[] = [
  { action: "task", label: "משימה", icon: TaskIcon },
  { action: "reminder", label: "תזכורת", icon: NotificationIcon },
  { action: "income", label: "הכנסה", icon: IncomeIcon },
  { action: "expense", label: "הוצאה", icon: ExpenseIcon },
  { action: "order", label: "הזמנה", icon: OrderIcon },
  { action: "project", label: "פרויקט", icon: ProjectIcon },
  { action: "customer", label: "לקוח", icon: AddUserIcon },
  { action: "collect", label: "קליטת תשלום", icon: PaymentIcon },
  // Not "העברה" on its own — that already means a bank-transfer payment method
  // elsewhere in the app; this one moves money between OUR accounts.
  { action: "transfer", label: "העברה בין חשבונות", icon: TransferIcon },
  // Log a worker's clock in/out into the phone-attendance queue (boss classifies later).
  { action: "attendance", label: "דיווח נוכחות", icon: ClockIcon },
  { action: "workerPayment", label: "תשלום לעובד", icon: CashIcon },
  // A CLOSED shift, typed in after the fact — writes a session directly, unlike
  // "דיווח נוכחות" above, which lands in the approval queue.
  { action: "manualSession", label: "משמרת ידנית", icon: TimerIcon },
];

// No "פתיחת משמרת" tile. It was here for a day (2026-08-16) and the user removed
// it: every shift a worker logs is meant to reach the approval queue through
// "דיווח נוכחות", and a tile that opened a session directly was a second,
// unreviewed way in. Clocking yourself in still exists on /profile.

// The only colored glyphs — money in / money out. Everything else stays white.
// (תשלום לעובד is money out, but it settles a debt we already booked, so it is
// deliberately NOT red: nothing new leaves the P&L when it's recorded.)
const TILE_TONE: Partial<Record<QuickCreateAction, "income" | "expense">> = {
  income: "income",
  expense: "expense",
  collect: "income",
};

// Reading the ledger / moving money between accounts / anything payroll is
// admin-or-office only — the API would 403 a worker, so don't offer them the tile.
const ADMIN_OR_OFFICE_ACTIONS = new Set<QuickCreateAction>([
  "collect",
  "transfer",
  "attendance",
  "workerPayment",
  "manualSession",
]);

// A worker's + is only what he can actually act on. The rest of the menu
// (income, expense, order, project) creates records on screens he can't open —
// see WORKER_ALLOWED_PREFIXES in lib/auth/roleAccess.ts. "דיווח נוכחות" IS his:
// the foreman on site signs his crew in and out, and it lands in the same
// approval queue as everything else.
const WORKER_ACTIONS = new Set<QuickCreateAction>(["task", "reminder", "attendance"]);

// Module-scope cache: the top bar remounts on some navigations, and the picker
// data (customers / products / projects…) is the same for the whole session, so
// fetch it at most once per page load and share it across mounts.
let dataCache: QuickCreateData | null = null;
let inFlight: Promise<QuickCreateData | null> | null = null;

function loadQuickCreateData(): Promise<QuickCreateData | null> {
  if (dataCache) return Promise.resolve(dataCache);
  if (!inFlight) {
    inFlight = fetch("/api/quick-actions/data", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((json: QuickCreateData | null) => {
        if (json) dataCache = { ...EMPTY_QUICK_CREATE_DATA, ...json };
        return dataCache;
      })
      .catch(() => null)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function QuickCreateMenu({
  viewerRole,
  variant = "topbar",
}: {
  viewerRole?: string;
  /** "fab" = the raised circular + in the mobile bottom nav. */
  variant?: "topbar" | "fab";
}) {
  const privileged = viewerRole === "admin" || viewerRole === "office";
  const items = privileged
    ? MENU_ITEMS
    : viewerRole === "worker"
      ? MENU_ITEMS.filter((item) => WORKER_ACTIONS.has(item.action))
      : MENU_ITEMS.filter((item) => !ADMIN_OR_OFFICE_ACTIONS.has(item.action));
  // Hover reveals the whole grid; clicking the + still toggles it, and on touch
  // (where there is no hover) the tap is the only interaction.
  const panel = useHoverPanel();
  const [action, setAction] = useState<QuickCreateAction | null>(null);
  const [data, setData] = useState<QuickCreateData | null>(dataCache);
  // A due date carried in from an external trigger (the calendar's "add to this
  // day"); cleared when the dialog closes so it never leaks into the + menu.
  const [quickDate, setQuickDate] = useState<string | undefined>(undefined);
  // Likewise an account (the חשבונות page's per-account + / −), so the money
  // lands on the account the user was looking at without picking it again.
  const [quickAccountId, setQuickAccountId] = useState<string | undefined>(undefined);
  // Once mounted, keep the dialog host mounted — remounting it would reset any
  // in-progress wizard draft state the user might reopen to.
  const [dialogsMounted, setDialogsMounted] = useState(false);
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  // Warm the data (and the dialog bundle) the moment the menu is opened, so the
  // form is ready by the time the user has picked an item.
  const prefetch = useCallback(() => {
    setDialogsMounted(true);
    if (dataCache) {
      setData(dataCache);
      return;
    }
    void loadQuickCreateData().then((loaded) => {
      if (activeRef.current && loaded) setData(loaded);
    });
  }, []);

  // Other pages can open a quick-create dialog (optionally pre-dated) by firing a
  // `bizh:quick-create` window event — e.g. the calendar's "הוספה ליום זה". Only
  // the top-bar instance handles it, so the twin FAB copy doesn't open a second
  // dialog. See app/(app)/calendar/CalendarView.tsx.
  useEffect(() => {
    if (variant !== "topbar") return;
    function onQuickCreate(event: Event) {
      const detail = (
        event as CustomEvent<{ action?: QuickCreateAction; dueDate?: string; accountId?: string }>
      ).detail;
      if (!detail?.action) return;
      // Fall back to a task if the caller asked for something this role can't
      // create. Checked against the same lists the tiles use, so a worker firing
      // "attendance" (which IS his) isn't quietly turned into a task.
      const allowed = privileged
        ? true
        : viewerRole === "worker"
          ? WORKER_ACTIONS.has(detail.action)
          : !ADMIN_OR_OFFICE_ACTIONS.has(detail.action);
      const action = allowed ? detail.action : "task";
      prefetch();
      setQuickDate(detail.dueDate);
      setQuickAccountId(detail.accountId);
      setAction(action);
    }
    window.addEventListener("bizh:quick-create", onQuickCreate);
    return () => window.removeEventListener("bizh:quick-create", onQuickCreate);
  }, [variant, prefetch, privileged, viewerRole]);

  const tiles = items.map((item) => (
    <Button
      key={item.action}
      type="button"
      variant="outline"
      className={QUICK_TILE_CLASS_SM}
      onClick={() => {
        panel.hide();
        prefetch();
        setQuickDate(undefined);
        setAction(item.action);
      }}
    >
      <QuickTileContent icon={item.icon} label={item.label} tone={TILE_TONE[item.action]} size="sm" />
    </Button>
  ));

  return (
    <>
      <HoverPanel
        open={panel.open}
        onOpenChange={(open) => {
          panel.setOpen(open);
          if (open) prefetch();
        }}
      >
        <HoverPanelTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={
              variant === "fab"
                ? // The one filled, raised control in the bottom bar — it's the
                  // primary action on mobile, so it reads as a button, not a glyph.
                  "h-[52px] w-[52px] -translate-y-3 rounded-2xl bg-secondary text-secondary-foreground shadow-lg shadow-secondary/30 ring-4 ring-sidebar hover:bg-secondary hover:text-secondary-foreground [&_svg]:!size-7"
                : // Same transparent glyph treatment as its neighbours (no fill — the
                  // user vetoed a colored blob up here); only the size is bumped, since
                  // it's the one button you act with rather than glance at.
                  `${TOPBAR_ICON_BUTTON} [&_svg]:!size-5`
            }
            aria-label="הוספה מהירה"
            id={variant === "fab" ? "bottomnav-quick-create-trigger" : "topbar-quick-create-trigger"}
            // Hover-to-open only makes sense with a real pointer. On the touch FAB
            // it raced the trigger's click-toggle, so the panel flashed open and
            // shut — there, tapping is the only interaction.
            {...(variant === "fab"
              ? { onPointerDown: prefetch }
              : {
                  ...panel.triggerProps,
                  onPointerEnter: () => {
                    prefetch();
                    panel.show();
                  },
                })}
          >
            <AddIcon strokeWidth={TOPBAR_ICON_STROKE} />
          </Button>
        </HoverPanelTrigger>
        <HoverPanelContent
          align={variant === "fab" ? "center" : "end"}
          side={variant === "fab" ? "top" : "bottom"}
          // Keep it on screen without letting it be shoved somewhere odd, and cap
          // the height so it can never run past the viewport.
          collisionPadding={12}
          className="w-auto rounded-2xl p-2"
          // No mouse-leave close on the FAB: on touch that fires while scrolling.
          {...(variant === "fab" ? {} : panel.panelProps)}
        >
          {/* Same tiles as the dashboard quick actions, two per row. */}
          <div className="grid max-h-[70svh] grid-cols-2 gap-2 overflow-y-auto overscroll-contain">
            {tiles}
          </div>
        </HoverPanelContent>
      </HoverPanel>

      {/* Never hand a half-loaded picker to the user (project/customer lists come
          from the same fetch) — hold the action behind a short loading dialog
          until the data is in, then open the real form. */}
      <ViewDialog
        open={action !== null && data === null}
        onOpenChange={() => {
          setAction(null);
          setQuickDate(undefined);
          setQuickAccountId(undefined);
        }}
        title="טוען..."
        description="מכין את הרשימות לטופס."
        size="formSm"
      >
        <div className="flex items-center justify-center py-8">
          <SpinnerIcon className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </ViewDialog>

      {dialogsMounted ? (
        <QuickCreateDialogs
          action={data ? action : null}
          onClose={() => {
            setAction(null);
            setQuickDate(undefined);
            setQuickAccountId(undefined);
          }}
          data={data ?? EMPTY_QUICK_CREATE_DATA}
          quickCreateDate={quickDate}
          quickCreateAccountId={quickAccountId}
        />
      ) : null}
    </>
  );
}

export default QuickCreateMenu;
