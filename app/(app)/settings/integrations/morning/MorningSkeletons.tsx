import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// The Morning screens before their data, from their own classes and words:
// the auto-issue form (MorningAutoIssueForm — its two cards, every label
// written, only the boxes' ticks unknown), the Morning settings page around it
// and the customers-matching page with its rows blank. Used by their routes'
// loading screens and by the settings page's Morning tab (SettingsSkeleton).

/** A checkbox / radio whose state isn't known yet. */
function Tick({ round = false }: { round?: boolean }) {
  return <Skeleton className={round ? "h-3.5 w-3.5 shrink-0 rounded-full" : "h-3.5 w-3.5 shrink-0 rounded-sm"} />;
}

function IssueCardSkeleton({
  title,
  description,
  toggle,
  options,
  note,
}: {
  title: string;
  description: string;
  toggle: string;
  options: [string, string];
  note: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center gap-2 rounded-xl border px-3 py-3">
          <Tick />
          <span>{toggle}</span>
        </div>
        <div className="space-y-1 rounded-xl border px-3 py-3">
          <div className="font-medium">סוג מסמך להנפקה</div>
          <div className="flex flex-wrap gap-2 pt-1">
            {options.map((option) => (
              <div key={option} className="flex items-center gap-2 text-sm">
                <Tick round />
                <span>{option}</span>
              </div>
            ))}
          </div>
          <p className="pt-1 text-xs text-muted-foreground">{note}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/** MorningAutoIssueForm: the invoice card, the receipt card, the save button. */
export function MorningAutoIssueFormSkeleton() {
  return (
    <div className="space-y-4">
      <IssueCardSkeleton
        title="חשבונית אוטומטית להזמנה"
        description="כאשר נוצרת הזמנה חדשה — או כאשר סטטוס הזמנה משתנה ל-״סופקה״ / ״הושלמה״ / ״סגורה״ — תיווצר ב-Morning חשבונית עבור הלקוח. אם ההזמנה עודכנה לאחר הוצאת חשבונית והסכום גדל, תונפק חשבונית נוספת על ההפרש בלבד (חשבוניות מס לא ניתנות לעריכה לפי חוק מע״מ)."
        toggle="הפעל הנפקת חשבונית אוטומטית להזמנה"
        options={["חשבונית מס (305)", "חשבונית מס-קבלה (320)"]}
        note="חשבונית מס-קבלה מתאימה כשההזמנה משולמת במלואה. חשבונית מס רגילה מתאימה כשעדיין יש יתרה לתשלום."
      />
      <IssueCardSkeleton
        title="קבלה אוטומטית בעת רישום תשלום"
        description="עם כל תשלום חיובי שנרשם ל-BizH (בהזמנה או פרויקט עם לקוח), תיווצר ב-Morning קבלה. תשלומים ללא לקוח מקושר ידולגו."
        toggle="הפעל הנפקת קבלה אוטומטית בעת רישום תשלום"
        options={["קבלה (400)", "חשבונית מס-קבלה (320)"]}
        note="אם בוחרים חשבונית מס-קבלה גם להזמנה וגם לתשלום — שימו לב שתונפק רק פעם אחת לכל מקור (הזמנה/תשלום)."
      />
      <div className="flex justify-end">
        <Skeleton className="h-11 w-28 rounded-xl" />
      </div>
    </div>
  );
}

/** A card of two outline link buttons (the Morning pages' "more" card). */
export function MorningLinksCardSkeleton({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Skeleton className="h-11 w-44 rounded-xl" />
        <Skeleton className="h-11 w-44 rounded-xl" />
      </CardContent>
    </Card>
  );
}

/** /settings/integrations/morning: its heading, the form, the links card. */
export function MorningSettingsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Morning: הגדרות אוטומציה</h1>
        <p className="text-sm text-muted-foreground">
          שליטה ביצירה אוטומטית של חשבוניות וקבלות ב-Morning בעת סגירת הזמנות ורישום תשלומים.
        </p>
      </div>
      <MorningAutoIssueFormSkeleton />
      <MorningLinksCardSkeleton title="קישורים נוספים" description="ניהול לקוחות Morning ובדיקת חיבור." />
    </div>
  );
}

/** /settings/integrations/morning/customers: its heading and the customers card, rows blank. */
export function MorningCustomersSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Morning: התאמת לקוחות</h1>
        <p className="text-sm text-muted-foreground">מסך בקרה לקישור בטוח בין לקוחות BizH ללקוחות Morning.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>לקוחות מקומיים</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl border p-3">
              {/* The name and phone share a line; the Morning status under them. */}
              <div>
                <Skeleton className="inline-block h-3.5 w-32 align-middle" />
                <Skeleton className="ms-2 inline-block h-2.5 w-20 align-middle" />
              </div>
              <div>
                <Skeleton className="inline-block h-3 w-44 align-middle" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
