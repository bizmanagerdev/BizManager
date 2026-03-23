import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CashFlowTransaction, CashFlowTransactionsResult } from "@/lib/cashflow";

const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat("he-IL", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function typeVariant(type: CashFlowTransaction["type"]) {
  return type === "inflow" ? ("success" as const) : ("warning" as const);
}

type Props = {
  basePath: string;
  result: CashFlowTransactionsResult;
  searchParams: Record<string, string>;
};

export default function CashFlowTransactions({ basePath, result, searchParams }: Props) {
  const params = new URLSearchParams(searchParams);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg text-right">תנועות אחרונות</CardTitle>
        <CardDescription className="text-right">נמצאו {result.totalCount} תנועות.</CardDescription>
      </CardHeader>
      <CardContent>
        {result.rows.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            לא נמצאו תנועות עבור הסינון שנבחר.
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:hidden">
              {result.rows.map((row) => (
                <article key={row.id} className="rounded-2xl border p-4 text-right">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{formatDate(row.date)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {row.project_name ?? "ללא שיוך לפרויקט"}
                      </div>
                    </div>
                    <Badge variant={typeVariant(row.type)}>
                      {row.type === "inflow" ? "הכנסה" : "הוצאה"}
                    </Badge>
                  </div>
                  <div className="mt-3 space-y-2 text-sm">
                    <div>{row.description ?? "ללא תיאור"}</div>
                    <div className="text-muted-foreground">{row.reference ?? "ללא אסמכתא"}</div>
                    <div className="font-semibold">{formatCurrency(row.amount)}</div>
                  </div>
                </article>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full text-right text-sm">
                <thead className="text-right text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-3 py-2 font-medium">תאריך</th>
                    <th className="px-3 py-2 font-medium">סוג</th>
                    <th className="px-3 py-2 font-medium">פרויקט</th>
                    <th className="px-3 py-2 font-medium">תיאור</th>
                    <th className="px-3 py-2 font-medium">סכום</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.id} className="border-b last:border-b-0">
                      <td className="px-3 py-3">{formatDate(row.date)}</td>
                      <td className="px-3 py-3">
                        <Badge variant={typeVariant(row.type)}>
                          {row.type === "inflow" ? "הכנסה" : "הוצאה"}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">{row.project_name ?? "ללא שיוך לפרויקט"}</td>
                      <td className="px-3 py-3">
                        <div>{row.description ?? "ללא תיאור"}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.reference ?? "ללא אסמכתא"}
                        </div>
                      </td>
                      <td className="px-3 py-3 font-medium">{formatCurrency(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4 text-sm">
              <div className="text-muted-foreground">
                עמוד {result.page} • {result.rows.length} מתוך {result.totalCount}
              </div>
              <div className="flex gap-2">
                {result.page > 1 ? (
                  <Link
                    href={buildPageHrefWithBase(basePath, params, result.page - 1)}
                    className="rounded-md border px-3 py-2 transition-colors hover:bg-muted/40"
                  >
                    הקודם
                  </Link>
                ) : (
                  <span className="rounded-md border px-3 py-2 text-muted-foreground">הקודם</span>
                )}
                {result.hasNextPage ? (
                  <Link
                    href={buildPageHrefWithBase(basePath, params, result.page + 1)}
                    className="rounded-md border px-3 py-2 transition-colors hover:bg-muted/40"
                  >
                    הבא
                  </Link>
                ) : (
                  <span className="rounded-md border px-3 py-2 text-muted-foreground">הבא</span>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function buildPageHrefWithBase(currentBasePath: string, current: URLSearchParams, page: number) {
  const params = new URLSearchParams(current);
  if (page <= 1) params.delete("page");
  else params.set("page", String(page));
  const query = params.toString();
  return query ? `${currentBasePath}?${query}` : currentBasePath;
}
