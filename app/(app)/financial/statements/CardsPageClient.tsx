"use client";

import Link from "next/link";
import { CalendarIcon, DocumentIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CardCostsPanel from "./CardCostsPanel";
import StatementsListClient, { type StatementListItem } from "./StatementsListClient";
import type { CardCostsReport } from "@/lib/financial/cardCosts";

export default function CardsPageClient({
  report,
  statements,
}: {
  report: CardCostsReport;
  statements: StatementListItem[];
}) {
  // Open while a statement is still in progress, folded once everything is done — known
  // on the server, so the box never jumps open or shut after the page appears.
  const anyOpen = statements.some((s) => s.marked_done !== true);
  return (
    <Tabs defaultValue="monthly" dir="rtl" className="space-y-4">
      {/* Wraps: the two buttons beside the tabs ran off a phone's edge at a
          bigger text size ("חזרה לפיננסי" was cut off). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <TabsList variant="underline">
            <TabsTrigger value="monthly"><CalendarIcon className="h-4 w-4 shrink-0" />סיכום חודשי</TabsTrigger>
            <TabsTrigger value="statements"><DocumentIcon className="h-4 w-4 shrink-0" />פירוטים שהועלו</TabsTrigger>
          </TabsList>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <Link href="/financial/import">העלאת פירוט חדש</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/financial">חזרה לפיננסי</Link>
          </Button>
        </div>
      </div>
      <MonthlyStepsHelp defaultOpen={anyOpen} />
      <TabsContent value="monthly" className="space-y-4">
        <CardCostsPanel report={report} />
      </TabsContent>
      <TabsContent value="statements" className="space-y-4">
        <StatementsListClient statements={statements} />
      </TabsContent>
    </Tabs>
  );
}

// The monthly steps (owner, 2026-10-12: the bank-charge step was missed in August
// because nobody knew it existed). The statement page walks through the same steps.
function MonthlyStepsHelp({ defaultOpen }: { defaultOpen: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-lg border bg-muted/30 px-4 py-3 text-sm">
      <summary className="cursor-pointer select-none font-medium marker:text-muted-foreground">
        בכל חודש, לכל קובץ פירוט — 4 צעדים
      </summary>
      <ol className="mt-2 list-inside list-decimal space-y-1 text-muted-foreground">
        <li>
          <span className="font-medium text-foreground">העלאה</span> — “העלאת פירוט חדש”. כל שורה מקבלת כרטיס (עם 4 ספרות) ואת
          התאריך שבו הבנק יחייב.
        </li>
        <li>
          <span className="font-medium text-foreground">שיוך</span> — תחום לכל שורה, ואז “צור הוצאות”: רכישות הופכות להוצאות,
          זיכויים להכנסות באותו תחום. שורות “לא לתיעוד” (נקנו עבור מישהו ששילם לנו) לא נרשמות.
        </li>
        <li>
          <span className="font-medium text-foreground">חיוב בבנק</span> — לכל כרטיס: כמה הבנק לקח בפועל, מתי ומאיזה חשבון.
        </li>
        <li>
          <span className="font-medium text-foreground">סיום</span> — אחרי זה לוח התשלומים מראה שורה אחת לכל כרטיס, ולא כל
          קנייה.
        </li>
      </ol>
    </details>
  );
}
