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
  ArrowUpCircle,
  BellPlus,
  FolderKanban,
  HandCoins,
  ListTodo,
  Loader2,
  Plus,
  ShoppingCart,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AdaptiveDialog } from "@/components/layout/page-layout";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TOPBAR_ICON_BUTTON, TOPBAR_ICON_STROKE } from "@/components/layout/topbar-icon";
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
//   משימה  תזכורת   /   הכנסה  הוצאה   /   הזמנה  פרויקט   /   קליטת תשלום  מסמך
// No "לקוח" tile: a customer is virtually always created in the flow of an order
// or a project, so the order/project wizards are the right doors for it.
const MENU_ITEMS: MenuItem[] = [
  { action: "task", label: "משימה", icon: ListTodo },
  { action: "reminder", label: "תזכורת", icon: BellPlus },
  { action: "income", label: "הכנסה", icon: ArrowDownCircle },
  { action: "expense", label: "הוצאה", icon: ArrowUpCircle },
  { action: "order", label: "הזמנה", icon: ShoppingCart },
  { action: "project", label: "פרויקט", icon: FolderKanban },
  { action: "collect", label: "קליטת תשלום", icon: HandCoins },
  { action: "document", label: "מסמך", icon: Upload },
];

// ── Tile colors ─────────────────────────────────────────────────────────────
// ONE place to decide what each tile looks like. The tile body stays primary
// blue so the grid reads as a single block (same as the dashboard); the GLYPH
// carries the meaning — money out is red, money in is green, matching the
// dashboard exactly. To recolor an action, add a line here and nothing else.
const TILE_ICON_COLOR: Partial<Record<QuickCreateAction, string>> = {
  expense: "!text-destructive",
  income: "!text-success",
};

// Reading the ledger is admin/office-only — the API would 403 a worker, so don't
// offer them the tile.
const ADMIN_OR_OFFICE_ACTIONS = new Set<QuickCreateAction>(["collect"]);

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

export function QuickCreateMenu({ viewerRole }: { viewerRole?: string }) {
  const privileged = viewerRole === "admin" || viewerRole === "office";
  const items = privileged ? MENU_ITEMS : MENU_ITEMS.filter((item) => !ADMIN_OR_OFFICE_ACTIONS.has(item.action));
  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<QuickCreateAction | null>(null);
  const [data, setData] = useState<QuickCreateData | null>(dataCache);
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

  return (
    <>
      <DropdownMenu
        modal={false}
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (open) prefetch();
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            // Same transparent glyph treatment as its neighbours (no fill — the
            // user vetoed a colored blob up here); only the size is bumped, since
            // it's the one button you act with rather than glance at.
            className={`${TOPBAR_ICON_BUTTON} h-9 w-9 [&_svg]:!size-5`}
            aria-label="הוספה מהירה"
            id="topbar-quick-create-trigger"
            onPointerEnter={prefetch}
          >
            <Plus strokeWidth={TOPBAR_ICON_STROKE} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto rounded-2xl p-2">
          {/* Same square blue tiles as the dashboard quick actions, two per row. */}
          <div className="grid grid-cols-2 gap-2">
            {items.map((item) => (
              <DropdownMenuItem
                key={item.action}
                onSelect={() => {
                  prefetch();
                  setAction(item.action);
                }}
                className="h-auto aspect-square w-[4.5rem] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-transparent !bg-primary p-1.5 text-center text-[0.7rem] leading-tight !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal focus:!bg-primary/90 hover:!bg-primary/90"
              >
                <item.icon
                  className={`!h-7 !w-7 ${TILE_ICON_COLOR[item.action] ?? ""}`}
                  strokeWidth={2.2}
                />
                <span className="font-semibold">{item.label}</span>
              </DropdownMenuItem>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Never hand a half-loaded picker to the user (project/customer lists come
          from the same fetch) — hold the action behind a short loading dialog
          until the data is in, then open the real form. */}
      <Dialog open={action !== null && data === null} onOpenChange={() => setAction(null)}>
        <AdaptiveDialog size="formSm">
          <DialogHeader>
            <DialogTitle>טוען...</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </AdaptiveDialog>
      </Dialog>

      {dialogsMounted ? (
        <QuickCreateDialogs
          action={data ? action : null}
          onClose={() => setAction(null)}
          data={data ?? EMPTY_QUICK_CREATE_DATA}
        />
      ) : null}
    </>
  );
}

export default QuickCreateMenu;
