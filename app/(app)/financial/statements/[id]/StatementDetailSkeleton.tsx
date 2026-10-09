import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PlainTableSkeleton, TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { ButtonSkeleton } from "@/app/(app)/financial/ButtonSkeleton";

// A statement's page before its data, from StatementDetailClient's own
// classes: the file's name and line with the statement's buttons, the progress
// chips, the create / card-charge buttons, then the rows' table with its
// column names (the two optional columns — original assignment, duplicates —
// left out). Shown while the page streams (loading.tsx) and while the client's
// code loads (the page's dynamic() fallback).

const COLUMNS = ["סטטוס", "תאריך", "בית עסק", "סכום", "קטגוריה", "תחום עסקי", "שיוך (פרויקט/נכס)", "הכנסה", ""];

export default function StatementDetailSkeleton({ routeLoading = false }: { routeLoading?: boolean }) {
  return (
    <div className="space-y-4 text-right" dir="rtl" data-route-loading={routeLoading ? "true" : undefined} aria-busy="true">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <TextLineSkeleton className="text-lg font-semibold" barClassName="w-48" />
          <TextLineSkeleton className="text-sm" barClassName="w-72 max-w-full" />
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonSkeleton label="סמן כבוצע" size="sm" />
          <ButtonSkeleton label="הורדת הקובץ" size="sm" />
          <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
          <ButtonSkeleton label="חזרה לרשימה" size="sm" />
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <Skeleton className="h-[2.125rem] w-24 rounded-md" />
        <Skeleton className="h-[2.125rem] w-36 rounded-md" />
      </div>

      <div className="flex flex-wrap gap-2">
        <ButtonSkeleton label="יצירת הוצאות (00)" size="sm" />
        <ButtonSkeleton label="חיוב כרטיס בחשבון (0)" size="sm" />
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <PlainTableSkeleton headers={COLUMNS} rows={10} rowClassName="h-[3.25rem]" className="overflow-hidden" />
        </CardContent>
      </Card>
    </div>
  );
}
