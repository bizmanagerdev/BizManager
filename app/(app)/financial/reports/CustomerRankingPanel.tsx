"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatShortDate } from "@/lib/date";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import type { CustomerRankingReport, CustomerRankingRow } from "@/lib/financial/customerRanking";

const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

function formatCurrency(value: number) {
  return currencyFormatter.format(Math.round(value));
}

const TOP_LIMIT = 20;
const INACTIVE_LIMIT = 50;

function CustomerRow({ row, rank }: { row: CustomerRankingRow; rank?: number }) {
  return (
    <tr className="border-b last:border-b-0">
      <td className="px-3 py-2">
        <Link href={`/customers/${row.customerId}`} className="font-medium text-primary hover:underline">
          {row.name}
        </Link>
        {row.phone ? (
          <a href={`tel:${row.phone}`} dir="ltr" className="ms-2 text-xs text-muted-foreground hover:underline">
            {row.phone}
          </a>
        ) : null}
        {row.tags.length > 0 ? (
          <span className="ms-2 inline-flex flex-wrap gap-1 align-middle">
            {row.tags.map((t) => (
              <Badge key={t.id} className={getStatusColorClasses("info")}>
                {t.name}
              </Badge>
            ))}
          </span>
        ) : null}
      </td>
      {rank !== undefined ? (
        <td dir="ltr" className="px-3 py-2 text-right tabular-nums text-muted-foreground">
          {rank}
        </td>
      ) : null}
      <td dir="ltr" className="px-3 py-2 text-right tabular-nums font-medium">
        {formatCurrency(row.totalSales)}
      </td>
      <td dir="ltr" className="px-3 py-2 text-right tabular-nums">
        {formatCurrency(row.totalPaid)}
      </td>
      <td
        dir="ltr"
        className={`px-3 py-2 text-right tabular-nums ${row.openBalance > 0.5 ? "text-destructive" : "text-muted-foreground"}`}
      >
        {formatCurrency(row.openBalance)}
      </td>
      <td dir="ltr" className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {row.lastActivityAt ? formatShortDate(row.lastActivityAt) : "—"}
      </td>
    </tr>
  );
}

/**
 * Reports → לקוחות: top customers by booked business, and customers who did
 * business but have gone quiet. Ranking + tag filtering happen here (client-side)
 * so filtering by a segment ranks WITHIN that segment. Read from
 * customer_overview_view, so the numbers match the customer directory.
 */
export default function CustomerRankingPanel({ report }: { report: CustomerRankingReport }) {
  const [tagFilter, setTagFilter] = useState<string>("");

  // Apply the segment filter first, then rank — so "top wholesale" is the top of
  // the wholesale segment, not the wholesale rows inside the overall top-N.
  const filtered = useMemo(
    () => (tagFilter ? report.rows.filter((r) => r.tags.some((t) => t.id === tagFilter)) : report.rows),
    [report.rows, tagFilter]
  );

  const top = useMemo(
    () =>
      [...filtered]
        .filter((r) => r.totalSales > 0)
        .sort((a, b) => b.totalSales - a.totalSales)
        .slice(0, TOP_LIMIT),
    [filtered]
  );

  const inactive = useMemo(
    () =>
      filtered
        .filter((r) => !r.lastActivityAt || r.lastActivityAt.slice(0, 10) < report.inactiveCutoff)
        .sort((a, b) => (a.lastActivityAt ?? "").localeCompare(b.lastActivityAt ?? ""))
        .slice(0, INACTIVE_LIMIT),
    [filtered, report.inactiveCutoff]
  );

  const segmentLabel = tagFilter
    ? report.allTags.find((t) => t.id === tagFilter)?.name ?? ""
    : "";

  return (
    <div className="space-y-4 text-right" dir="rtl">
      {report.allTags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-muted-foreground">סינון לפי תגית:</span>
          <button
            type="button"
            onClick={() => setTagFilter("")}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              tagFilter === "" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
            }`}
          >
            הכל
          </button>
          {report.allTags.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTagFilter(t.id)}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                tagFilter === t.id ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-right">
            לקוחות מובילים — לפי היקף עסקאות{segmentLabel ? ` · ${segmentLabel}` : ""}
          </CardTitle>
          <CardDescription className="text-right">
            דירוג לפי סך המכירות (הזמנות + פרויקטים, כולל מע״מ). {report.activeCustomers} לקוחות פעילים
            מתוך {report.totalCustomers}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {top.length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              אין נתוני מכירות להצגה.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">לקוח</th>
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">סך מכירות</th>
                    <th className="px-3 py-2 font-medium">שולם</th>
                    <th className="px-3 py-2 font-medium">יתרה פתוחה</th>
                    <th className="px-3 py-2 font-medium">פעילות אחרונה</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((row, i) => (
                    <CustomerRow key={row.customerId} row={row} rank={i + 1} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-right">
            לקוחות שנרדמו — ללא פעילות מעל {report.inactiveDays} ימים{segmentLabel ? ` · ${segmentLabel}` : ""}
          </CardTitle>
          <CardDescription className="text-right">
            לקוחות שכבר עשו עסקים אך לא בוצעה מולם הזמנה או תשלום מאז {formatShortDate(report.inactiveCutoff)}.
            הזדמנות טובה ליצור קשר.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {inactive.length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              אין לקוחות רדומים לתקופה שנבחרה — כל הכבוד!
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">לקוח</th>
                    <th className="px-3 py-2 font-medium">סך מכירות</th>
                    <th className="px-3 py-2 font-medium">שולם</th>
                    <th className="px-3 py-2 font-medium">יתרה פתוחה</th>
                    <th className="px-3 py-2 font-medium">פעילות אחרונה</th>
                  </tr>
                </thead>
                <tbody>
                  {inactive.map((row) => (
                    <CustomerRow key={row.customerId} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
