"use client";

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
      <TabsList className="grid w-full grid-cols-2 sm:inline-flex sm:w-auto">
        <TabsTrigger value="monthly">סיכום חודשי</TabsTrigger>
        <TabsTrigger value="statements">פירוטים שהועלו</TabsTrigger>
      </TabsList>
      <TabsContent value="monthly" className="space-y-4">
        <CardCostsPanel report={report} />
      </TabsContent>
      <TabsContent value="statements" className="space-y-4">
        <StatementsListClient statements={statements} />
      </TabsContent>
    </Tabs>
  );
}
