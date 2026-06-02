"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatShortDate } from "@/lib/date";
import { checkStatusClasses, checkStatusLabel, type CheckRow } from "@/lib/checks";

type Props = { checks: CheckRow[] };

type FilterKey = "open" | "all" | "today" | "week" | "overdue" | "upcoming" | "cleared";
type SortKey = "due" | "amount" | "name";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(value);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function weekFromNowIso() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

function SummaryCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "danger" | "warning" | "success";
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
        ? "text-warning-strong"
        : tone === "success"
          ? "text-success"
          : "text-foreground";
  return (
    <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

export default function ChecksClient({ checks }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterKey>("open");
  const [sort, setSort] = useState<SortKey>("due");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const today = todayIso();
  const weekEnd = weekFromNowIso();

  const totals = useMemo(() => {
    const acc = { openCount: 0, openSum: 0, weekSum: 0, overdueSum: 0, clearedSum: 0 };
    for (const c of checks) {
      if (c.status === "cleared") {
        acc.clearedSum += c.amount;
        continue;
      }
      if (c.status === "bounced") continue;
      acc.openCount += 1;
      acc.openSum += c.amount;
      const due = c.due_date ?? null;
      if (due && due < today) acc.overdueSum += c.amount;
      else if (due && due <= weekEnd) acc.weekSum += c.amount;
    }
    return acc;
  }, [checks, today, weekEnd]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = checks.filter((c) => {
      const due = c.due_date ?? null;
      switch (filter) {
        case "open":
          if (c.status !== "pending") return false;
          break;
        case "today":
          if (!(c.status === "pending" && due === today)) return false;
          break;
        case "week":
          if (!(c.status === "pending" && due && due >= today && due <= weekEnd)) return false;
          break;
        case "overdue":
          if (!(c.status === "pending" && due && due < today)) return false;
          break;
        case "upcoming":
          if (!(c.status === "pending" && due && due > weekEnd)) return false;
          break;
        case "cleared":
          if (c.status !== "cleared") return false;
          break;
        default:
          break;
      }
      if (q) {
        const haystack = `${c.customer_name} ${c.customer_phone ?? ""} ${c.check_number ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    const sorted = [...list];
    switch (sort) {
      case "amount":
        sorted.sort((a, b) => b.amount - a.amount);
        break;
      case "name":
        sorted.sort((a, b) => a.customer_name.localeCompare(b.customer_name, "he"));
        break;
      default:
        sorted.sort((a, b) => (a.due_date ?? "9999-99-99").localeCompare(b.due_date ?? "9999-99-99"));
    }
    return sorted;
  }, [checks, filter, sort, search, today, weekEnd]);

  async function setCleared(paymentId: string, cleared: boolean) {
    setBusyId(paymentId);
    try {
      const res = await fetch("/api/payments/mark-collected", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: paymentId, collected: cleared }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  const tabs: { key: FilterKey; label: string }[] = [
    { key: "open", label: "טרם נפרעו" },
    { key: "all", label: "הכל" },
    { key: "today", label: "להפקדה היום" },
    { key: "week", label: "השבוע" },
    { key: "overdue", label: "באיחור" },
    { key: "upcoming", label: "עתידי" },
    { key: "cleared", label: "נפרעו" },
  ];

  const filteredSum = filtered.reduce((s, c) => s + c.amount, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label={`לפירעון (${totals.openCount})`} value={formatCurrency(totals.openSum)} />
        <SummaryCard label="להפקדה השבוע" value={formatCurrency(totals.weekSum)} tone="warning" />
        <SummaryCard label="באיחור להפקדה" value={formatCurrency(totals.overdueSum)} tone="danger" />
        <SummaryCard label="נפרעו" value={formatCurrency(totals.clearedSum)} tone="success" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((tab) => (
          <Button
            key={tab.key}
            type="button"
            size="sm"
            variant={filter === tab.key ? "default" : "outline"}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
          </Button>
        ))}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="due">מיון: תאריך פירעון</option>
          <option value="amount">מיון: סכום</option>
          <option value="name">מיון: שם</option>
        </select>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש לפי מספר צ׳ק / שם / טלפון..."
          className="h-9 w-full sm:w-64"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-10 text-center text-sm text-muted-foreground">
          {checks.length === 0 ? "לא נרשמו צ׳קים עדיין." : "אין צ׳קים שתואמים לסינון."}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-2xl border border-border/70 sm:block">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead className="bg-muted">
                <tr className="border-b border-border/70 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-right font-medium">לקוח</th>
                  <th className="px-3 py-2 text-right font-medium">מס׳ צ׳ק</th>
                  <th className="px-3 py-2 text-center font-medium">סכום</th>
                  <th className="px-3 py-2 text-right font-medium">תאריך פירעון</th>
                  <th className="px-3 py-2 text-right font-medium">סטטוס</th>
                  <th className="px-3 py-2 text-right font-medium">מקור</th>
                  <th className="px-3 py-2 text-center font-medium">צילום</th>
                  <th className="px-2 py-2 text-center font-medium">פעולות</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <CheckRowDesktop key={c.payment_id} c={c} today={today} busy={busyId === c.payment_id} onSetCleared={setCleared} />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border/70 bg-muted/30 text-xs font-semibold">
                  <td className="px-3 py-2 text-right" colSpan={2}>
                    סה״כ ({filtered.length} צ׳קים)
                  </td>
                  <td className="px-3 py-2 text-center">{formatCurrency(filteredSum)}</td>
                  <td className="px-3 py-2" colSpan={5} />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 sm:hidden">
            {filtered.map((c) => (
              <CheckCard key={c.payment_id} c={c} today={today} busy={busyId === c.payment_id} onSetCleared={setCleared} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SourceLink({ c }: { c: CheckRow }) {
  if (!c.source_type || !c.source_id) return <span className="text-muted-foreground/50">—</span>;
  const href = c.source_type === "order" ? `/sales/orders/${c.source_id}` : `/projects/${c.source_id}`;
  return (
    <NavLink to={href} className="text-primary hover:underline">
      {c.source_label}
    </NavLink>
  );
}

function DueCell({ c, today }: { c: CheckRow; today: string }) {
  if (!c.due_date) return <span className="text-muted-foreground/50">—</span>;
  const overdue = c.status === "pending" && c.due_date < today;
  return (
    <span className={overdue ? "font-medium text-destructive" : ""}>
      {formatShortDate(c.due_date)}
      {overdue ? " · באיחור" : ""}
    </span>
  );
}

function PhotoCell({ c }: { c: CheckRow }) {
  if (!c.photo_url) return <span className="text-muted-foreground/40">—</span>;
  return (
    <a
      href={c.photo_url}
      target="_blank"
      rel="noreferrer"
      title="צפייה בצילום הצ׳ק"
      className="inline-flex items-center gap-1 text-primary hover:underline"
    >
      <Paperclip className="h-3.5 w-3.5" />
      {c.photo_count > 1 ? c.photo_count : "צילום"}
    </a>
  );
}

function ActionCell({
  c,
  busy,
  onSetCleared,
}: {
  c: CheckRow;
  busy: boolean;
  onSetCleared: (id: string, cleared: boolean) => void;
}) {
  if (c.status === "cleared") {
    return (
      <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" disabled={busy} onClick={() => onSetCleared(c.payment_id, false)}>
        {busy ? "..." : "בטל פירעון"}
      </Button>
    );
  }
  if (c.status === "bounced") return <span className="text-xs text-destructive">חזר</span>;
  return (
    <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={() => onSetCleared(c.payment_id, true)}>
      {busy ? "מסמן..." : "סמן כנפרע"}
    </Button>
  );
}

function CheckRowDesktop({
  c,
  today,
  busy,
  onSetCleared,
}: {
  c: CheckRow;
  today: string;
  busy: boolean;
  onSetCleared: (id: string, cleared: boolean) => void;
}) {
  return (
    <tr className="border-b border-border/50 hover:bg-muted/30">
      <td className="px-3 py-2">
        {c.customer_id ? (
          <NavLink to={`/customers/${c.customer_id}`} className="font-medium hover:underline">
            {c.customer_name}
          </NavLink>
        ) : (
          <span className="font-medium">{c.customer_name}</span>
        )}
        {c.customer_phone ? (
          <a href={`tel:${c.customer_phone}`} className="block text-xs text-muted-foreground hover:underline">
            ☎ {c.customer_phone}
          </a>
        ) : null}
      </td>
      <td className="px-3 py-2 font-mono text-xs">{c.check_number ?? "—"}</td>
      <td className="px-3 py-2 text-center font-semibold">{formatCurrency(c.amount)}</td>
      <td className="px-3 py-2">
        <DueCell c={c} today={today} />
      </td>
      <td className="px-3 py-2">
        <Badge className={checkStatusClasses(c.status)}>{checkStatusLabel(c.status)}</Badge>
      </td>
      <td className="px-3 py-2 text-xs">
        <SourceLink c={c} />
      </td>
      <td className="px-3 py-2 text-center">
        <PhotoCell c={c} />
      </td>
      <td className="px-2 py-2 text-center">
        <ActionCell c={c} busy={busy} onSetCleared={onSetCleared} />
      </td>
    </tr>
  );
}

function CheckCard({
  c,
  today,
  busy,
  onSetCleared,
}: {
  c: CheckRow;
  today: string;
  busy: boolean;
  onSetCleared: (id: string, cleared: boolean) => void;
}) {
  return (
    <div className="rounded-2xl border border-border/70 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {c.customer_id ? (
            <NavLink to={`/customers/${c.customer_id}`} className="font-semibold hover:underline">
              {c.customer_name}
            </NavLink>
          ) : (
            <span className="font-semibold">{c.customer_name}</span>
          )}
          {c.customer_phone ? (
            <div className="text-xs text-muted-foreground">☎ {c.customer_phone}</div>
          ) : null}
        </div>
        <div className="shrink-0 text-lg font-semibold">{formatCurrency(c.amount)}</div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <Badge className={checkStatusClasses(c.status)}>{checkStatusLabel(c.status)}</Badge>
        {c.check_number ? <span className="font-mono text-muted-foreground">מס׳ {c.check_number}</span> : null}
        <span className="text-muted-foreground">פירעון: </span>
        <DueCell c={c} today={today} />
        <SourceLink c={c} />
        <PhotoCell c={c} />
      </div>
      <div className="mt-2 border-t border-border/50 pt-2">
        <ActionCell c={c} busy={busy} onSetCleared={onSetCleared} />
      </div>
    </div>
  );
}
