"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ProjectRow = Record<string, unknown>;

function getString(row: ProjectRow, key: string) {
  const value = row[key];
  if (typeof value === "string") return value;
  return null;
}

function getNumber(row: ProjectRow, key: string) {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatIls(amount: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(amount);
}

function projectDisplayName(row: ProjectRow) {
  return getString(row, "name") ?? "פרויקט";
}

function clientDisplayName(row: ProjectRow) {
  return getString(row, "customer_name") ?? "—";
}

function statusValue(row: ProjectRow) {
  return getString(row, "status") ?? "unknown";
}

function profitValue(row: ProjectRow) {
  const direct = getNumber(row, "gross_profit");
  if (direct !== null) return direct;

  const actualPrice = getNumber(row, "actual_price");
  const expenses = getNumber(row, "total_expenses");
  if (actualPrice !== null && expenses !== null) return actualPrice - expenses;
  return null;
}

export default function ProjectsClient({ initialProjects }: { initialProjects: ProjectRow[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [sort, setSort] = useState<"recent" | "profit_desc">("recent");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();

    let list = initialProjects;

    if (q) {
      list = list.filter((row) => {
        const name = projectDisplayName(row).toLowerCase();
        const client = clientDisplayName(row).toLowerCase();
        return name.includes(q) || client.includes(q);
      });
    }

    if (status !== "all") {
      list = list.filter((row) => statusValue(row) === status);
    }

    if (sort === "profit_desc") {
      list = [...list].sort((a, b) => (profitValue(b) ?? -Infinity) - (profitValue(a) ?? -Infinity));
    }

    return list;
  }, [initialProjects, query, sort, status]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    initialProjects.forEach((row) => set.add(statusValue(row)));
    return Array.from(set).sort();
  }, [initialProjects]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="text-sm text-muted-foreground">חיפוש</label>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש לפי לקוח או פרויקט..."
            className="h-11 mt-1"
          />
        </div>

        <div className="flex gap-3">
          <div className="min-w-[10rem]">
            <label className="text-sm text-muted-foreground">סטטוס</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">הכל</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[10rem]">
            <label className="text-sm text-muted-foreground">מיון</label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as any)}
              className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="recent">אחרונים</option>
              <option value="profit_desc">רווח (גבוה→נמוך)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        נמצאו {rows.length} פרויקטים
      </div>

      {/* Mobile: card list. Tablet: grid. Desktop: table (later). */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => {
          const id = getString(row, "id") ?? "";
          const profit = profitValue(row);
          const status = statusValue(row);
          const openTasks = getNumber(row, "open_tasks");

          return (
            <Link key={id} href={`/projects/${id}`} prefetch className="block">
              <Card className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{projectDisplayName(row)}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">לקוח</span>
                    <span className="truncate">{clientDisplayName(row)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">סטטוס</span>
                    <span className="truncate">{status}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">רווח</span>
                    <span className={profit !== null && profit < 0 ? "text-destructive" : ""}>
                      {profit === null ? "—" : formatIls(profit)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">משימות פתוחות</span>
                    <span>{openTasks === null ? "—" : openTasks}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
