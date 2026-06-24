"use client";

import Link from "next/link";
import { CalendarDays, FileText } from "lucide-react";
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
  return (
    <Tabs defaultValue="monthly" dir="rtl" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <TabsList variant="underline">
            <TabsTrigger value="monthly"><CalendarDays className="h-4 w-4 shrink-0" />סיכום חודשי</TabsTrigger>
            <TabsTrigger value="statements"><FileText className="h-4 w-4 shrink-0" />פירוטים שהועלו</TabsTrigger>
          </TabsList>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <Link href="/financial/import">העלאת פירוט חדש</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/financial">חזרה לפיננסי</Link>
          </Button>
        </div>
      </div>
      <TabsContent value="monthly" className="space-y-4">
        <CardCostsPanel report={report} />
      </TabsContent>
      <TabsContent value="statements" className="space-y-4">
        <StatementsListClient statements={statements} />
      </TabsContent>
    </Tabs>
  );
}
