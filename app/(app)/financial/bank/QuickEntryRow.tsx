"use client";

// הוספה מהירה — one always-open line above the account's register.
//
// This is for working down the bank's own site in the other half of a split
// screen: read a line there, type it here, hit הכנסה or הוצאה, read the next.
// No dialog to open and close per row, and the fields you'd otherwise retype
// (date, domain, category) stay filled while the description and amount clear
// themselves, so a run of lines off one page is a few keystrokes each.
//
// On DESKTOP (md+) it's pinned to the bottom of the WINDOW at all times, via
// `fixed` — not `sticky`. Sticky only locks on once you've scrolled close to
// the end of a long register, which for a page whose whole point is fast
// repeated entry means it's off-screen most of the time (user, 2026-08-27:
// "I don't want to scroll to it"). The right inset tracks the sidebar rail's
// current width (RAIL_WIDTH, collapsed/expanded) so its left/right edges keep
// lining up with the register above it as the rail toggles; physical
// left/right, not logical start/end, per the same reasoning as
// DesktopQuickCreateFab — one less thing RTL can flip on us.
//
// Below md there's no sidebar, and the mobile BottomNav takes the fixed-bottom
// slot instead — it's fixed to the true bottom (58px + its safe-area inset)
// with a higher z-index, so pinning this bar under it (not sticky at
// bottom-0) keeps its buttons out from behind the nav bar's opaque
// background. It folds into two short rows on a narrow window, so half a
// screen is enough.
//
// It writes through the SAME endpoints as everywhere else (/api/expenses/create,
// /api/payments/create), so audit, VAT and receipts behave identically — this is
// a faster way in, not a second way of recording money.

import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AddIcon, RemoveIcon, SpinnerIcon } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { DomainSelect } from "@/components/financial/DomainSelect";
import { toHebrewError } from "@/lib/error-messages";
import { DEFAULT_EXPENSE_CATEGORY, EXPENSE_CATEGORY_OPTIONS } from "@/lib/expenses";
import { norm, type MerchantMemory } from "@/lib/financial/cardImport";
import { useSidebarCollapse } from "@/components/layout/sidebar-collapse-context";
import { cn } from "@/lib/utils";
import type { Account } from "@/lib/accounts";

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
  merchantMemory,
  onSaved,
}: {
  account: Account;
  projects: Array<{ id: string; name: string }>;
  /** How a description like this was filed last time — fills the row for you. */
  merchantMemory: MerchantMemory;
  onSaved: () => void;
}) {
  const { collapsed } = useSidebarCollapse();
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [businessDomain, setBusinessDomain] = useState("");
  const [category, setCategory] = useState<string>(DEFAULT_EXPENSE_CATEGORY);
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState<"income" | "expense" | null>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);

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
    const update = () => setBarHeight(el.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** Fill the שיוך from how this description was filed last time. */
  function rememberFor(text: string) {
    const remembered = merchantMemory[norm(text)];
    if (!remembered) return;
    // Never overwrite something already chosen by hand.
    if (!businessDomain) setBusinessDomain(remembered.businessDomain);
    if (remembered.category && category === DEFAULT_EXPENSE_CATEGORY) setCategory(remembered.category);
    if (!projectId && remembered.projectId) setProjectId(remembered.projectId);
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

  return (
    <>
      <div
        ref={barRef}
        className={cn(
          "sticky bottom-[calc(58px+env(safe-area-inset-bottom))] z-30 md:fixed md:bottom-0 md:left-0",
          // Physical, not logical — the rail sits at the physical right edge in
          // this RTL app, so the box that clears it is `right`, not `end`. A
          // single `right-*` utility only (no `inset-x`) — two rules setting
          // `right` at equal specificity is a coin flip on which one the
          // generated stylesheet's ordering actually applies.
          collapsed ? "md:right-14" : "md:right-40"
        )}
      >
      {/* Mirrors AppShell's own `mx-auto max-w-[1600px] px-3 md:p-6 lg:p-8` so
          the bar's edges keep lining up with the register above it once this
          leaves normal flow for `fixed`. */}
      <div className="md:mx-auto md:max-w-[1600px] md:px-6 lg:px-8">
        <Card className="border-t-2 border-t-primary/20 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
          <CardContent className="space-y-2 p-2.5">
            <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span className="text-sm font-medium">הוספה מהירה ל{account.name}</span>
              <span className="text-muted-foreground">
                Enter = הוצאה · Shift+Enter = הכנסה · התאריך והתחום נשארים לשורה הבאה
              </span>
            </div>

            {/* Two short rows on a narrow window (half a split screen), one line on
                a wide one. An amount is never long, so it stays narrow and the
                DESCRIPTION takes all the slack — it is the field with something to
                say. */}
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-[7.5rem_7rem_minmax(9rem,1fr)_9rem_9rem_auto]">
              <DateInput
                className="h-9"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-label="תאריך"
              />
              <CurrencyInput
                className="h-9"
                containerClassName="xl:order-none"
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
                className="col-span-2 h-9 xl:col-span-1 xl:order-none"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={(e) => rememberFor(e.target.value)}
                placeholder="תיאור"
                aria-label="תיאור"
              />
              <DomainSelect
                className="h-9"
                value={businessDomain}
                onChange={setBusinessDomain}
                placeholder="תחום *"
                ariaLabel="תחום"
              />
              <SearchableSelect
                className="h-9"
                options={EXPENSE_CATEGORY_OPTIONS.map((option) => ({ value: option, label: option }))}
                value={category}
                onChange={setCategory}
                placeholder="קטגוריה"
                ariaLabel="קטגוריה"
                searchThreshold={Infinity}
              />

              <div className="col-span-2 flex items-center gap-1.5 xl:col-span-1">
                <Button
                  type="button"
                  variant="success"
                  className="flex-1 xl:flex-none"
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
                  className="flex-1 xl:flex-none"
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

            {/* Only asked for when the domain says a project is involved. */}
            {businessDomain === "logistics_projects" && (
              <SearchableSelect
                className="h-9 sm:w-64"
                options={projects.map((project) => ({ value: project.id, label: project.name }))}
                value={projectId}
                onChange={setProjectId}
                placeholder="פרויקט"
                emptyOptionLabel="ללא פרויקט"
                ariaLabel="פרויקט"
              />
            )}
          </CardContent>
        </Card>
      </div>
      </div>
      <div aria-hidden className="hidden md:block" style={{ height: barHeight }} />
    </>
  );
}
