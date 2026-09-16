"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { monthChoices, monthLabel } from "@/lib/dashboard/domain-chart";
import { toHebrewError } from "@/lib/error-messages";
import { scheduleDeferredAction } from "@/lib/undo-engine";

// How far back the month list reaches. A saved start older than this is still
// listed, so the select always shows what's stored.
const MONTHS_BACK = 48;

/** Picks the month the business started using the system for real — reports
 *  count only from its 1st on (lib/settings/booksStartDate.ts). A month picker,
 *  not a date field, so the start is always the 1st and never in the future. */
export default function BooksStartDateCard({
  initialStartDate,
  todayIso,
}: {
  /** "YYYY-MM-01", or null when every date counts. */
  initialStartDate: string | null;
  /** The server's date, so the month list is identical on both sides. */
  todayIso: string;
}) {
  const initialMonth = initialStartDate ? initialStartDate.slice(0, 7) : "";
  const [month, setMonth] = useState(initialMonth);
  const [savedMonth, setSavedMonth] = useState(initialMonth);

  const choices = useMemo(() => {
    const list = monthChoices(todayIso, MONTHS_BACK);
    if (savedMonth && !list.some((choice) => choice.value === savedMonth)) {
      list.push({ value: savedMonth, label: monthLabel(savedMonth) });
    }
    return list;
  }, [todayIso, savedMonth]);

  const dirty = month !== savedMonth;

  function save() {
    if (!dirty) return;
    const previousMonth = savedMonth;
    const nextMonth = month;
    scheduleDeferredAction({
      key: "settings:books-start-date",
      message: nextMonth ? `הספירה מתחילה מ${monthLabel(nextMonth)}` : "הספירה כוללת את כל התקופה",
      onApplyOptimistic: () => setSavedMonth(nextMonth),
      onRevert: () => {
        setSavedMonth(previousMonth);
        setMonth(previousMonth);
      },
      onCommit: async () => {
        const res = await fetch("/api/settings/books-start-date", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ books_start_date: nextMonth ? `${nextMonth}-01` : null }),
        });
        const json = (await res.json().catch(() => null)) as { books_start_date?: string | null; error?: string } | null;
        if (!res.ok) return { ok: false, error: toHebrewError(json?.error, "שמירת תחילת הספירה נכשלה.") };
        const stored = json?.books_start_date ? json.books_start_date.slice(0, 7) : "";
        setMonth(stored);
        setSavedMonth(stored);
        return { ok: true };
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>תחילת ספירת הכספים</CardTitle>
        <CardDescription>
          החודש שממנו התחלתם להשתמש במערכת באמת. הדוחות ותרשים ההכנסות וההוצאות בדשבורד סופרים רק
          מה-1 בחודש הזה והלאה. שום נתון לא נמחק — היומן, דפי הלקוחות, ההזמנות והפרויקטים ויתרות
          החשבונות ממשיכים להציג הכול.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <NativeSelect
            aria-label="חודש תחילת הספירה"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-56"
          >
            <option value="">כל התקופה</option>
            {choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" disabled={!dirty}>
            שמירה
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
