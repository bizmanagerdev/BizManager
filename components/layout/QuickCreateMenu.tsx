"use client";

// The top-bar "+" — create anything from anywhere without leaving the page.
// The whole point: you're deep in /financial or /sales, you need to jot a task or
// log an expense, and you should not have to navigate away and find your place
// again. Every action opens a dialog ON TOP of the current page; closing it (or
// saving) leaves you exactly where you were.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUpCircle,
  Bell,
  FolderKanban,
  HandCoins,
  ListTodo,
  Loader2,
  Plus,
  ShoppingCart,
  Upload,
  User,
} from "lucide-react";
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

type MenuItem = { action: QuickCreateAction; label: string; icon: typeof ListTodo };

// Laid out two per row, in this exact order (user-specified):
//   משימה  תזכורת   /   הכנסה  הוצאה   /   הזמנה  פרויקט   /
//   העברה בין חשבונות  לקוח   /   קליטת תשלום  מסמך
// The count is kept EVEN so the grid never ends on a half row — the two newest
// tiles (transfer + customer) sit together in the second-to-last row, at the
// user's direction. לקוח was deliberately absent at first (a customer is nearly
// always created inside an order/project wizard); the user asked for it anyway.
// Glyphs here carry NO "+" badge (User, not UserPlus; Bell, not BellPlus): the
// whole grid already lives behind the + button, so every tile repeating it is
// noise. The user's call.
const MENU_ITEMS: MenuItem[] = [
  { action: "task", label: "משימה", icon: ListTodo },
  { action: "reminder", label: "תזכורת", icon: Bell },
  { action: "income", label: "הכנסה", icon: ArrowDownCircle },
  { action: "expense", label: "הוצאה", icon: ArrowUpCircle },
  { action: "order", label: "הזמנה", icon: ShoppingCart },
  { action: "project", label: "פרויקט", icon: FolderKanban },
  // Not "העברה" on its own — that already means a bank-transfer payment method
  // elsewhere in the app; this one moves money between OUR accounts.
  { action: "transfer", label: "העברה בין חשבונות", icon: ArrowLeftRight },
  { action: "customer", label: "לקוח", icon: User },
  { action: "collect", label: "קליטת תשלום", icon: HandCoins },
  { action: "document", label: "מסמך", icon: Upload },
];

// The only colored glyphs — money in / money out. Everything else stays white.
const TILE_TONE: Partial<Record<QuickCreateAction, "income" | "expense">> = {
  income: "income",
  expense: "expense",
  collect: "income",
};

// Reading the ledger / moving money between accounts is admin/office-only — the
// API would 403 a worker, so don't offer them the tile.
const ADMIN_OR_OFFICE_ACTIONS = new Set<QuickCreateAction>(["collect", "transfer"]);

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
  const items = privileged ? MENU_ITEMS : MENU_ITEMS.filter((item) => !ADMIN_OR_OFFICE_ACTIONS.has(item.action));
  // Hover reveals the whole grid; clicking the + still toggles it, and on touch
  // (where there is no hover) the tap is the only interaction.
  const panel = useHoverPanel();
  const [action, setAction] = useState<QuickCreateAction | null>(null);
  const [data, setData] = useState<QuickCreateData | null>(dataCache);
  // A due date carried in from an external trigger (the calendar's "add to this
  // day"); cleared when the dialog closes so it never leaks into the + menu.
  const [quickDate, setQuickDate] = useState<string | undefined>(undefined);
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
      const detail = (event as CustomEvent<{ action?: QuickCreateAction; dueDate?: string }>).detail;
      if (!detail?.action) return;
      // Fall back to a task if the caller asked for something this role can't create.
      const action =
        ADMIN_OR_OFFICE_ACTIONS.has(detail.action) && !privileged ? "task" : detail.action;
      prefetch();
      setQuickDate(detail.dueDate);
      setAction(action);
    }
    window.addEventListener("bizh:quick-create", onQuickCreate);
    return () => window.removeEventListener("bizh:quick-create", onQuickCreate);
  }, [variant, prefetch, privileged]);

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
            <Plus strokeWidth={TOPBAR_ICON_STROKE} />
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
        }}
        title="טוען..."
        description="מכין את הרשימות לטופס."
        size="formSm"
      >
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </ViewDialog>

      {dialogsMounted ? (
        <QuickCreateDialogs
          action={data ? action : null}
          onClose={() => {
            setAction(null);
            setQuickDate(undefined);
          }}
          data={data ?? EMPTY_QUICK_CREATE_DATA}
          quickCreateDate={quickDate}
        />
      ) : null}
    </>
  );
}

export default QuickCreateMenu;
