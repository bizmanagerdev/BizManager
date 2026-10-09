import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarIcon, DocumentIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { UnderlineTabsSkeleton } from "@/components/layout/loading-skeletons";
import { ButtonSkeleton } from "@/app/(app)/financial/ButtonSkeleton";

// The card statements page before its data, from CardsPageClient and
// CardCostsPanel: the two tabs (סיכום חודשי open, as the page opens) with the
// upload and back links, then the monthly card — its title and note, the
// month × card table (the cards' names are data, so their heads are blanks),
// twelve months and the totals row. Shown while the page streams.

const MONTHS = 12;
const CARDS = 3;

export default function StatementsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <UnderlineTabsSkeleton
            labels={[
              <>
                <CalendarIcon className="h-4 w-4 shrink-0" />
                סיכום חודשי
              </>,
              <>
                <DocumentIcon className="h-4 w-4 shrink-0" />
                פירוטים שהועלו
              </>,
            ]}
          />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <ButtonSkeleton label="העלאת פירוט חדש" size="sm" />
          <ButtonSkeleton label="חזרה לפיננסי" size="sm" />
        </div>
      </div>

      {/* TabsContent's own mt-4 (it meets the row's gap, as on the page). */}
      <div className="mt-4 space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-right">עלות כרטיסי אשראי לפי חודש</CardTitle>
            <CardDescription className="text-right">
              כמה כל כרטיס עלה בכל חודש, לפי תאריך העסקה (הקנייה) — לא לפי מועד החיוב. לחיצה על חודש פותחת
              את כל החיובים שלו. 12 החודשים האחרונים.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-hidden">
              <table className="w-full text-right text-sm">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">חודש</th>
                    {Array.from({ length: CARDS }).map((_, i) => (
                      <th key={i} className="px-3 py-2 font-medium">
                        <Skeleton className="inline-block h-[0.75em] w-14 align-middle" />
                      </th>
                    ))}
                    <th className="px-3 py-2 font-medium">סה״כ</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: MONTHS }).map((_, row) => (
                    <tr key={row} className="border-b last:border-b-0">
                      {Array.from({ length: CARDS + 2 }).map((_, cell) => (
                        <td key={cell} className="px-3 py-2.5">
                          <Skeleton className={`inline-block h-[0.75em] align-middle ${cell === 0 ? "w-16" : "w-12"}`} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 font-semibold">
                    <td className="px-3 py-3">סה״כ</td>
                    {Array.from({ length: CARDS + 1 }).map((_, cell) => (
                      <td key={cell} className="px-3 py-3">
                        <Skeleton className="inline-block h-[0.75em] w-14 align-middle" />
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
