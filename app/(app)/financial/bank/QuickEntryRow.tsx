"use client";

// הוספה מהירה — one always-open line above the account's register.
//
// This is for working down the bank's own site in the other half of a split
// screen: read a line there, type it here, hit הכנסה or הוצאה, read the next.
// No dialog to open and close per row, and the fields you'd otherwise retype
// (date, domain, category) stay filled while the description and amount clear
// themselves, so a run of lines off one page is a few keystrokes each.
//
// DESKTOP (md+) ONLY — hidden below md (user, 2026-08-31: "on mobile remove
// the quick add"). This is inherently a wide-screen, many-fields-in-a-row
// power tool for typing off a split-screen desktop window; on a phone there's
// no room for it and the + quick-create menu already covers recording money.
// It's pinned to the bottom of the WINDOW at all times, via `fixed` — not
// `sticky`, which only locks on once you've scrolled close to the end of a
// long register (user, 2026-08-27: "I don't want to scroll to it"). The right
// inset tracks the sidebar rail's current width (RAIL_WIDTH, collapsed/
// expanded); physical right, not logical end, per the same reasoning as
// DesktopQuickCreateFab — one less thing RTL can flip on us. The card itself
// is centered within that box (not stretched to its edges) — user,
// 2026-08-31: "center the bar in the page[, ]now its sticking to right of the
// table and looks funny".
//
// It writes through the SAME endpoints as everywhere else (/api/expenses/create,
// /api/payments/create), so audit, VAT and receipts behave identically — this is
// a faster way in, not a second way of recording money.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { AddIcon, HelpIcon, RemoveIcon, SpinnerIcon } from "@/components/ui/icons";
import { CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { DomainSelect } from "@/components/financial/DomainSelect";
import { HoverPanel, HoverPanelContent, HoverPanelTrigger, useHoverPanel } from "@/components/ui/hover-panel";
import { toHebrewError } from "@/lib/error-messages";
import { DEFAULT_EXPENSE_CATEGORY, EXPENSE_CATEGORY_OPTIONS } from "@/lib/expenses";
import { norm, type MerchantMemory } from "@/lib/financial/cardImport";
import { useSidebarCollapse } from "@/components/layout/sidebar-collapse-context";
import { cn } from "@/lib/utils";
import type { Account } from "@/lib/accounts";

// No reactive source — this only answers "are we on the client yet" (same
// pattern as DesktopQuickCreateFab, for the same reason below).
const subscribeClient = () => () => {};

// Spelled out for the first few sessions, then collapsed to a "?" — a
// permanently-visible keyboard-shortcut legend is onboarding, not something a
// daily user needs staring at them forever (user, 2026-08-31: "the keyboard
// hint is permanent ... show it for the first few sessions, then collapse to
// a ? next to the bar").
const HINT_STORAGE_KEY = "bizh:quickEntryHintSessions";
const HINT_MAX_SESSIONS = 3;

/** Today in the local calendar — a night-time entry mustn't slip a day (UTC would). */
function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

export default function QuickEntryRow({
  account,
  projects,
  properties,
  merchantMemory,
  onSaved,
  onHeightChange,
}: {
  account: Account;
  projects: Array<{ id: string; name: string }>;
  properties: Array<{ id: string; label: string }>;
  /** How a description like this was filed last time — fills the row for you. */
  merchantMemory: MerchantMemory;
  onSaved: () => void;
  /** Fires with the bar's live rendered height (px) whenever it changes — so a
   *  caller with its OWN internally-scrolling content (e.g. BankClient's
   *  bounded register list) can pad that content clear of the bar too. The
   *  page-level spacer below only reserves room in normal page flow, which
   *  does nothing for a sibling that scrolls in its own bounded box. */
  onHeightChange?: (px: number) => void;
}) {
  const { collapsed } = useSidebarCollapse();
  // Portaled straight to <body> (see the return statement below) — server
  // render → false, so nothing is emitted into the SSR HTML and there's no
  // hydration mismatch; the bar appears on the client re-render, same as
  // DesktopQuickCreateFab.
  const onClient = useSyncExternalStore(subscribeClient, () => true, () => false);
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [businessDomain, setBusinessDomain] = useState("");
  const [category, setCategory] = useState<string>(DEFAULT_EXPENSE_CATEGORY);
  const [projectId, setProjectId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [busy, setBusy] = useState<"income" | "expense" | null>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const hintPanel = useHoverPanel();

  // Defaults to showing the full hint (matches the pre-collapse behavior)
  // until this effect reads the real count on mount — by then onClient above
  // hasn't flipped yet either, so nothing has actually painted, and there's
  // no flash. Each of the first HINT_MAX_SESSIONS mounts counts as one
  // "session" and bumps the stored count once; from then on it stays a "?".
  const [showFullHint, setShowFullHint] = useState(true);
  useEffect(() => {
    let count = 0;
    try {
      count = Number(localStorage.getItem(HINT_STORAGE_KEY)) || 0;
    } catch {
      // Private browsing / storage disabled — just keep showing the hint.
      return;
    }
    setShowFullHint(count < HINT_MAX_SESSIONS);
    if (count < HINT_MAX_SESSIONS) {
      try {
        localStorage.setItem(HINT_STORAGE_KEY, String(count + 1));
      } catch {
        // Nothing to do if it can't be persisted — worst case the hint
        // shows a session longer than intended.
      }
    }
  }, []);

  // Once the bar leaves normal flow for `fixed` (md+), nothing reserves its
  // footprint any more, so it would sit on top of the register's last rows
  // instead of below them. Measuring its own height and rendering an
  // invisible spacer of the same size, right where <QuickEntryRow> was
  // called, restores that — and it tracks the real height (it changes with
  // the project row and the 2-row/1-row grid breakpoint) instead of a
  // guessed constant.
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(0);
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const update = () => {
      setBarHeight(el.offsetHeight);
      onHeightChange?.(el.offsetHeight);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onHeightChange]);

  /** Fill the שיוך from how this description was filed last time. */
  function rememberFor(text: string) {
    const remembered = merchantMemory[norm(text)];
    if (!remembered) return;
    // Never overwrite something already chosen by hand.
    if (!businessDomain) setBusinessDomain(remembered.businessDomain);
    if (remembered.category && category === DEFAULT_EXPENSE_CATEGORY) setCategory(remembered.category);
    if (!projectId && remembered.projectId) setProjectId(remembered.projectId);
    if (!propertyId && remembered.propertyId) setPropertyId(remembered.propertyId);
  }

  async function save(kind: "income" | "expense") {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("יש להזין סכום גדול מאפס.");
      return;
    }
    if (!businessDomain) {
      toast.error("יש לבחור תחום.");
      return;
    }
    if (businessDomain === "property_management" && !propertyId) {
      toast.error("יש לבחור נכס לתחום ניהול נכסים.");
      return;
    }

    setBusy(kind);
    try {
      // A cash box moves cash; everything else moves through the bank.
      const paymentMethod = account.kind === "cash" ? "cash" : "bank_transfer";
      const res =
        kind === "expense"
          ? await fetch("/api/expenses/create", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                expense_date: date,
                amount: value,
                category,
                description: description.trim() || category,
                business_domain: businessDomain,
                project_id: projectId || null,
                property_id: propertyId || null,
                payment_status: "paid",
                payment_method: paymentMethod,
                account_id: account.id,
              }),
            })
          : await fetch("/api/payments/create", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                payment_date: date,
                amount_total: value,
                business_domain: businessDomain,
                payment_method: paymentMethod,
                project_id: projectId || undefined,
                property_id: propertyId || undefined,
                notes: description.trim() || undefined,
                account_id: account.id,
              }),
            });

      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(toHebrewError(json.error, "השמירה נכשלה."));
        return;
      }

      toast.success(kind === "expense" ? "ההוצאה נרשמה." : "ההכנסה נרשמה.");
      // The date, the domain and the category stay — a run of lines off one
      // statement page is usually the same day and the same kind of thing.
      setDescription("");
      setAmount("");
      descriptionRef.current?.focus();
      onSaved();
    } catch (err: unknown) {
      toast.error(toHebrewError(err, "השמירה נכשלה."));
    } finally {
      setBusy(null);
    }
  }

  // The project/property picker only renders when the domain needs one, and
  // the two are mutually exclusive (a domain switch clears the other one —
  // see DomainSelect's onChange below), so at most one shows.
  const needsProject = businessDomain === "logistics_projects";
  const needsProperty = businessDomain === "property_management";

  const bar = (
    <div
      ref={barRef}
      className={cn(
        // Hidden below md — desktop-only (see the file header comment). No
        // bottom padding on the fixed box itself: its own bottom edge sits
        // exactly at bottom:0, not floating above it behind a gap.
        "hidden overflow-x-hidden md:fixed md:bottom-0 md:left-0 md:z-30 md:flex md:justify-center md:px-3",
        // Physical, not logical — the rail sits at the physical right edge in
        // this RTL app, so the box that clears it is `right`, not `end`. A
        // single `right-*` utility only (no `inset-x`) — two rules setting
        // `right` at equal specificity is a coin flip on which one the
        // generated stylesheet's ordering actually applies.
        collapsed ? "md:right-14" : "md:right-40"
      )}
    >
      {/* No max-width/mx-auto wrapper — the box sizes to its own content
          (flex-wrap row inside) and `justify-center` above centers THAT
          within the sidebar-cleared box, instead of stretching edge to edge
          and looking pinned to one side. */}
      {/* A plain div, not <Card> — Card's `.brand-frame` decoration paints its
          own faint inset gradient ring INSIDE whatever border you give it,
          which doubled up with a solid border here and read as "funny"
          (user, 2026-08-31). Full border in the chrome colour + a tinted body
          instead, so it doesn't melt into the pale register above it ("gets
          mixed with background" / "make the blue all around"). Square bottom
          corners so it sits flush against the true screen edge instead of
          leaving rounded slivers of page visible under it. */}
      <div className="w-fit max-w-full rounded-t-2xl border-2 border-primary bg-muted text-card-foreground shadow-[0_-8px_24px_rgba(0,0,0,0.18)]">
        <CardContent className="space-y-2 p-2.5">
            <div className="flex flex-wrap items-center gap-x-2 text-xs">
              <span className="text-sm font-medium">הוספה מהירה ל{account.name}</span>
              {showFullHint ? (
                <span className="text-muted-foreground">
                  Enter = הוצאה · Shift+Enter = הכנסה · התאריך והתחום נשארים לשורה הבאה
                </span>
              ) : (
                <HoverPanel open={hintPanel.open} onOpenChange={hintPanel.setOpen}>
                  <HoverPanelTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="h-5 w-5 text-muted-foreground hover:text-foreground"
                      aria-label="קיצורי מקלדת"
                      {...hintPanel.triggerProps}
                    >
                      <HelpIcon className="h-3.5 w-3.5" />
                    </Button>
                  </HoverPanelTrigger>
                  <HoverPanelContent align="start" className="w-64 p-2.5 text-xs" {...hintPanel.panelProps}>
                    Enter = הוצאה · Shift+Enter = הכנסה · התאריך והתחום נשארים לשורה הבאה
                  </HoverPanelContent>
                </HoverPanel>
              )}
            </div>

            {/* Flex-wrap, not a fixed grid template — every field gets a real
                width sized to its OWN longest option (so a select's chosen
                value never has to truncate; user, 2026-08-31: "i need to see
                the text in the dropdowns"), and the row only wraps to a
                second line if the window is genuinely too narrow, instead of
                forcing horizontal overflow. Description is deliberately
                narrow ("make description smaller for that") to leave room. */}
            <div className="flex flex-wrap items-center gap-2">
              <DateInput
                className="h-9 w-28"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-label="תאריך"
              />
              <CurrencyInput
                className="h-9"
                containerClassName="w-24"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="סכום"
                aria-label="סכום"
                onKeyDown={(e) => {
                  // Enter records an expense — the common case when reading a
                  // statement. Shift+Enter records an income.
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  void save(e.shiftKey ? "income" : "expense");
                }}
              />
              <Input
                ref={descriptionRef}
                className="h-9 w-32"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={(e) => rememberFor(e.target.value)}
                placeholder="תיאור"
                aria-label="תיאור"
              />
              <DomainSelect
                className="h-9 w-44"
                value={businessDomain}
                onChange={(value) => {
                  setBusinessDomain(value);
                  // A project/property picked under one domain doesn't carry over
                  // to another — leaving it set would send both project_id and
                  // property_id together, which the create APIs reject.
                  if (value !== "logistics_projects") setProjectId("");
                  if (value !== "property_management") setPropertyId("");
                }}
                placeholder="תחום *"
                ariaLabel="תחום"
              />
              <SearchableSelect
                className="h-9 w-40"
                options={EXPENSE_CATEGORY_OPTIONS.map((option) => ({ value: option, label: option }))}
                value={category}
                onChange={setCategory}
                placeholder="קטגוריה"
                ariaLabel="קטגוריה"
                searchThreshold={Infinity}
              />

              {needsProject && (
                <SearchableSelect
                  className="h-9 w-56"
                  options={projects.map((project) => ({ value: project.id, label: project.name }))}
                  value={projectId}
                  onChange={setProjectId}
                  placeholder="פרויקט"
                  emptyOptionLabel="ללא פרויקט"
                  ariaLabel="פרויקט"
                />
              )}
              {/* property_management requires a property — no "ללא" option, unlike
                  the project picker above, since the create APIs reject a
                  property_management row with no property_id. */}
              {needsProperty && (
                <SearchableSelect
                  className="h-9 w-56"
                  options={properties.map((property) => ({ value: property.id, label: property.label }))}
                  value={propertyId}
                  onChange={setPropertyId}
                  placeholder="נכס *"
                  ariaLabel="נכס"
                />
              )}

              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="success"
                  disabled={busy !== null}
                  onClick={() => void save("income")}
                  title="Shift+Enter"
                >
                  {busy === "income" ? (
                    <SpinnerIcon className="h-4 w-4 animate-spin" />
                  ) : (
                    <AddIcon className="h-4 w-4" />
                  )}
                  הכנסה
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={() => void save("expense")}
                  title="Enter"
                >
                  {busy === "expense" ? (
                    <SpinnerIcon className="h-4 w-4 animate-spin" />
                  ) : (
                    <RemoveIcon className="h-4 w-4" />
                  )}
                  הוצאה
                </Button>
              </div>
            </div>
          </CardContent>
        </div>
      </div>
  );

  return (
    <>
      {onClient ? createPortal(bar, document.body) : null}
      <div aria-hidden className="hidden md:block" style={{ height: barHeight }} />
    </>
  );
}
