import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AdaptiveGrid } from "@/components/layout/page-layout";
import { TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { EXPENSE_TAX_CATEGORY } from "@/lib/expenses";
import { ButtonSkeleton } from "@/app/(app)/financial/ButtonSkeleton";

// The VAT page before its figures, from TaxesClient's own classes: the
// heading with the pay button, the headline card, the four boxes (one column,
// two from md, four from xl), the note and the payments card — every word
// real, blanks only where the amounts and payments go. Shown while the page
// streams (loading.tsx).

const STAT_LABELS = ["מע״מ על מכירות (עם חשבונית)", "מע״מ על פרויקטים רשמיים", "סך מע״מ על הכנסה רשמית", "שולם עד כה"];

export default function TaxesSkeleton() {
  return (
    <div className="space-y-4 text-right" dir="rtl" data-route-loading="true" aria-busy="true">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">מע״מ ומסים</h1>
          <p className="text-xs text-muted-foreground">
            מס שנגבה וטרם הועבר — לפי שיעור <Skeleton className="inline-block h-[0.75em] w-6 align-middle" />%.
          </p>
        </div>
        <ButtonSkeleton label="רישום תשלום מס" />
      </div>

      <Card>
        <CardContent className="py-6 text-center">
          <div className="text-xs text-muted-foreground">לתשלום עכשיו (מע״מ על הכנסה רשמית פחות ששולם)</div>
          <TextLineSkeleton className="mt-1 text-4xl font-bold" barClassName="w-40" />
        </CardContent>
      </Card>

      <AdaptiveGrid variant="customerStats">
        {STAT_LABELS.map((label) => (
          <div key={label} className="rounded-md border bg-background p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <TextLineSkeleton className="mt-0.5 text-xl font-semibold" barClassName="w-24" />
          </div>
        ))}
      </AdaptiveGrid>

      <p className="text-xs text-muted-foreground">
        המע״מ מחושב על כל ההכנסה הרשמית שהוצאת לה חשבונית — גם אם הכסף עדיין לא התקבל (בסיס חשבונית,
        לא בסיס מזומן). ההכנסה עצמה נספרת במלואה ואינה מנוכה. תשלום מס נרשם כהוצאה בקטגוריית
        ״{EXPENSE_TAX_CATEGORY}״ ומקטין את הסכום לתשלום.
      </p>

      <Card>
        <CardContent className="p-0">
          <div className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">תשלומי מס שנרשמו</div>
          <div className="divide-y divide-border/60">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <TextLineSkeleton barClassName="w-28" />
                  <TextLineSkeleton className="text-xs" barClassName="w-16" />
                </div>
                <TextLineSkeleton barClassName="w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
