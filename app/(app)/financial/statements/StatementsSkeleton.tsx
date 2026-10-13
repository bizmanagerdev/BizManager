import { Card } from "@/components/ui/card";
import { CalendarIcon, DocumentIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { UnderlineTabsSkeleton } from "@/components/layout/loading-skeletons";
import { ButtonSkeleton } from "@/app/(app)/financial/ButtonSkeleton";

// The card statements page before its data, from CardsPageClient and
// StatementsListClient: the two tabs (פירוטים שהועלו open, as the page opens) with
// the upload and back links, the help box with its four steps (open while a
// statement is in progress, which is most of the month), then the statements
// table — its eight heads and ten rows. Shown while the page streams.

const ROWS = 10;
const HEADS = ["תאריך העלאה", "קובץ", "סטטוס", "הוצאות שנוצרו", "סה״כ הוצאות", "סה״כ הכנסות", "סה״כ שורות", "חיוב בבנק"];

export default function StatementsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <UnderlineTabsSkeleton
            labels={[
              <>
                <DocumentIcon className="h-4 w-4 shrink-0" />
                פירוטים שהועלו
              </>,
              <>
                <CalendarIcon className="h-4 w-4 shrink-0" />
                סיכום חודשי
              </>,
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ButtonSkeleton label="העלאת פירוט חדש" size="sm" />
          <ButtonSkeleton label="חזרה לפיננסי" size="sm" />
        </div>
      </div>

      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
        <div className="font-medium">בכל חודש, לכל קובץ פירוט — 4 צעדים</div>
        <div className="mt-2 space-y-1">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className={`h-[0.85em] ${i === 1 ? "w-11/12" : "w-3/4"}`} />
          ))}
        </div>
      </div>

      {/* TabsContent's own mt-4 (it meets the row's gap, as on the page). */}
      <div className="mt-4 space-y-4">
        <Card className="overflow-hidden">
          <div className="overflow-x-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr className="text-right">
                  {HEADS.map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {Array.from({ length: ROWS }).map((_, row) => (
                  <tr key={row}>
                    {HEADS.map((h, cell) => (
                      <td key={h} className="px-3 py-2">
                        <Skeleton className={`inline-block h-[0.75em] align-middle ${cell === 1 ? "w-24" : "w-14"}`} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
