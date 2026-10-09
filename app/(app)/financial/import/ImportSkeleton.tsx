import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ButtonSkeleton } from "@/app/(app)/financial/ButtonSkeleton";

// The import page as it opens — CardImportClient's upload step, which knows
// nothing yet, so it is nearly all real: the heading and its line, the two
// links, the upload card with its label and note; only the file picker is a
// blank. Shown while the page streams (loading.tsx) and while the client's
// code loads (the page's dynamic() fallback). `smartExtractEnabled` picks the
// note's ending, as the page does.
export default function ImportSkeleton({
  smartExtractEnabled,
  routeLoading = false,
}: {
  smartExtractEnabled: boolean;
  routeLoading?: boolean;
}) {
  return (
    <div className="space-y-4 text-right" dir="rtl" data-route-loading={routeLoading ? "true" : undefined} aria-busy="true">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">העלאת פירוט אשראי</h1>
          <p className="text-sm text-muted-foreground">
            העלאת Excel/CSV/PDF ושמירת הפירוט. שיוך התחומים העסקיים ויצירת ההוצאות נעשים אחר כך בעמוד הפירוט.
          </p>
        </div>
        <div className="flex gap-2">
          <ButtonSkeleton label="פירוטים שנשמרו" size="sm" />
          <ButtonSkeleton label="חזרה לפיננסי" size="sm" />
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 py-6">
          {/* Inline, like the page's <label> — so no gap under it either. */}
          <span className="text-sm font-medium">בחר/י קובץ Excel, CSV או PDF</span>
          <div className="flex items-center gap-4">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-3 w-24" />
          </div>
          <p className="text-xs text-muted-foreground">
            Excel/CSV: קובץ עם כמה כרטיסים נתמך — כל כרטיס מזוהה לפי שורת הכותרת שלו, וכל שורה מקבלת את שם הכרטיס
            כקטגוריה. אם קיימת עמודת &quot;שיוך&quot;, היא תישמר כעמודת ייחוס וגם תמלא מראש את הבחירה.
            {" "}PDF: ננסה לקרוא את הדף ישירות
            {smartExtractEnabled ? ", ובמקרה הצורך נציע חילוץ חכם (הקובץ יישלח לשירות AI חיצוני)." : " (חילוץ חכם אינו מוגדר בשרת)."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
