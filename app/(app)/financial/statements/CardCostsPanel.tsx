"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDownIcon, ChevronLeftIcon } from "@/components/ui/icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getBusinessDomainLabel } from "@/lib/expenses";
import type { CardCostsReport, CardMonthCell } from "@/lib/financial/cardCosts";

const ils = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatCurrency = (value: number) => ils.format(value);

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${month}/${year.slice(-2)}`;
}

function formatDay(iso: string) {
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${Number(m[2])}/${Number(m[1])}` : "";
}

function monthName(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

const sumCells = (cells: CardMonthCell[] | undefined) => (cells ?? []).reduce((s, c) => s + Math.round(c.amount * 100), 0) / 100;

/**
 * Each card's statement per month: the amount the bank took for it (or the lines'
 * sum until the charge is recorded), in the statement's own month — like its file
 * name. Tapping a month opens each card's statement: what it was spent on, refunds,
 * and the lines left out. See lib/financial/cardCosts.ts.
 */
export default function CardCostsPanel({ report }: { report: CardCostsReport }) {
  const { months, fullFrom, unlisted } = report;
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  const [showEarlier, setShowEarlier] = useState(false);

  const shown = showEarlier ? months : months.filter((m) => m.month >= fullFrom);
  const hiddenCount = months.length - months.filter((m) => m.month >= fullFrom).length;
  // Only the cards that appear in the months on screen.
  const cards = report.cards.filter((card) => shown.some((m) => m.cells[card]?.length));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-right">עלות כרטיסי אשראי לפי חודש</CardTitle>
          <CardDescription className="text-right">
            הפירוט של כל כרטיס בכל חודש — הסכום שהבנק גבה עליו, או סכום השורות עד שנרשם החיוב. החודש הוא חודש הפירוט, כמו
            בשם הקובץ: פירוט ספטמבר שנגבה ב־2/10 מופיע בספטמבר. לחיצה על חודש פותחת את הפירוטים שלו.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {shown.length === 0 || cards.length === 0 ? (
            <EmptyState>אין פירוטים להצגה מ{monthName(fullFrom)}. נתונים יופיעו אחרי העלאת פירוט.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">חודש</th>
                    {cards.map((card) => (
                      <th key={card} className="px-3 py-2 font-medium">
                        {card}
                      </th>
                    ))}
                    <th className="px-3 py-2 font-medium">סה״כ</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => {
                    const isOpen = openMonth === row.month;
                    return (
                      <Fragment key={row.month}>
                        <tr
                          className="cursor-pointer border-b align-top last:border-b-0 hover:bg-muted/30"
                          onClick={() => setOpenMonth(isOpen ? null : row.month)}
                        >
                          <td dir="ltr" className="px-3 py-2.5 text-right font-medium tabular-nums">
                            <span className="inline-flex items-center gap-1">
                              {isOpen ? (
                                <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronLeftIcon className="h-4 w-4 text-muted-foreground" />
                              )}
                              {formatMonthLabel(row.month)}
                            </span>
                          </td>
                          {cards.map((card) => {
                            const cells = row.cells[card];
                            if (!cells?.length) {
                              return (
                                <td key={card} className="px-3 py-2.5 text-muted-foreground">
                                  —
                                </td>
                              );
                            }
                            const pending = cells.some((c) => !c.charged);
                            return (
                              <td key={card} className="px-3 py-2.5">
                                <div className="font-medium tabular-nums">{formatCurrency(sumCells(cells))}</div>
                                <div className={`text-[0.7rem] ${pending ? "text-warning-soft-foreground" : "text-muted-foreground"}`}>
                                  {pending ? "לפי השורות — חיוב בנק טרם נרשם" : `נגבה ${cells.map((c) => formatDay(c.bankDate)).join(", ")}`}
                                </div>
                              </td>
                            );
                          })}
                          <td className="px-3 py-2.5 font-semibold tabular-nums">{formatCurrency(row.total)}</td>
                        </tr>
                        {isOpen ? (
                          <tr className="border-b bg-muted/20">
                            <td colSpan={cards.length + 2} className="px-3 py-3">
                              <MonthDetail cells={cards.flatMap((card) => (row.cells[card] ?? []).map((cell) => ({ card, cell })))} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 font-semibold">
                    <td className="px-3 py-3">סה״כ</td>
                    {cards.map((card) => (
                      <td key={card} className="px-3 py-3 tabular-nums">
                        {formatCurrency(shown.reduce((s, m) => s + Math.round(sumCells(m.cells[card]) * 100), 0) / 100)}
                      </td>
                    ))}
                    <td className="px-3 py-3 tabular-nums">
                      {formatCurrency(shown.reduce((s, m) => s + Math.round(m.total * 100), 0) / 100)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {hiddenCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowEarlier((v) => !v)}
              className="text-xs font-medium text-secondary hover:underline"
            >
              {showEarlier ? `הסתרת החודשים שלפני ${monthName(fullFrom)}` : `הצגת ${hiddenCount} חודשים קודמים (לפני ${monthName(fullFrom)})`}
            </button>
          ) : null}
        </CardContent>
      </Card>

      {unlisted.length > 0 ? <UnlistedCard items={unlisted} /> : null}
    </div>
  );
}

function MonthDetail({ cells }: { cells: Array<{ card: string; cell: CardMonthCell }> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {cells.map(({ card, cell }) => (
        <div key={`${card}-${cell.statementId}`} className="space-y-2 rounded-md border bg-background p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-semibold">{card}</span>
            <span className="font-semibold tabular-nums">{formatCurrency(cell.amount)}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            <Link href={`/financial/statements/${cell.statementId}`} className="text-secondary hover:underline">
              {cell.statementName || "פירוט"}
            </Link>
            {" · "}
            {cell.charged ? `נגבה ב־${formatDay(cell.bankDate)}` : "חיוב בנק טרם נרשם — הסכום לפי השורות"}
            {" · "}
            {cell.lineCount} שורות
          </div>
          {cell.byDomain.length > 0 ? (
            <div className="divide-y divide-border/60 rounded-md border">
              {cell.byDomain.map((d) => (
                <div key={d.domain} className="flex justify-between gap-3 px-2.5 py-1 text-sm">
                  <span>{getBusinessDomainLabel(d.domain)}</span>
                  <span className="tabular-nums">{formatCurrency(d.amount)}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>רכישות {formatCurrency(cell.purchases)}</span>
            {cell.refunds > 0 ? <span>זיכויים {formatCurrency(-cell.refunds)}</span> : null}
            {cell.leftOut > 0 ? <span>לא לתיעוד {formatCurrency(cell.leftOut)}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

// Card purchases typed by hand that no uploaded statement has yet — a card whose
// statements aren't uploaded (Chase), or a purchase entered before its statement came.
function UnlistedCard({ items }: { items: CardCostsReport["unlisted"] }) {
  const total = items.reduce((s, i) => s + Math.round(i.amount * 100), 0) / 100;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-right">קניות באשראי שעוד לא בפירוט</CardTitle>
        <CardDescription className="text-right">
          הוזנו ידנית כקניות באשראי ועוד לא הופיעו באף פירוט שהועלה — למשל כרטיס שהפירוטים שלו עוד לא הועלו. הן לא בטבלה
          למעלה.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border/60 rounded-md border">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
              <div className="min-w-0">
                <span>{item.description}</span>
                <span className="text-xs text-muted-foreground">
                  {" · "}
                  {formatDay(item.date)}
                  {item.domain ? ` · ${getBusinessDomainLabel(item.domain)}` : ""}
                  {item.accountName ? ` · ${item.accountName}` : ""}
                </span>
              </div>
              <span className="shrink-0 tabular-nums">{formatCurrency(item.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between gap-3 px-3 py-1.5 text-sm font-semibold">
            <span>סה״כ</span>
            <span className="tabular-nums">{formatCurrency(total)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
