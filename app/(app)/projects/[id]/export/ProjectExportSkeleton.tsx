import { TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ShareIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";

// The team's work sheet (/projects/[id]/export) before its data, from the
// page's own pieces: the share / print bar, then the A4 sheet — its badges,
// the project's name and customer, the three detail boxes and the address,
// then the team and tasks beside the items to move and the notes, every
// section under its own title. For the route's loading screen — and for the
// projects' outer loading screens to show on the way here.

function Box({ label, lines }: { label: string; lines: string[] }) {
  return (
    <section className="rounded-xl border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      {lines.map((prefix, i) => (
        <div key={i} className="mt-1">
          {prefix ? <span>{prefix} </span> : null}
          <Skeleton className="inline-block h-[0.75em] w-24 align-middle" />
        </div>
      ))}
    </section>
  );
}

export default function ProjectExportSkeleton() {
  return (
    <div className="min-h-screen bg-muted/20 text-right" dir="rtl" aria-busy="true">
      <div className="border-b bg-background/95 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className={buttonVariants({ variant: "secondary", size: "sm" })}>
            <ShareIcon className="h-4 w-4" />
            <span>שיתוף PDF</span>
          </span>
          <span className={buttonVariants({ size: "sm" })}>הדפסה / שמירה ל־PDF</span>
        </div>
      </div>
      <div className="mx-auto w-full max-w-[210mm] bg-background px-4 py-6 text-sm sm:px-8">
        <div className="space-y-6 rounded-2xl border bg-background p-5 shadow-sm">
          <header className="space-y-4 border-b pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">דף עבודה לצוות</Badge>
                  <Skeleton className="h-[1.625rem] w-14 rounded-full" />
                </div>
                <TextLineSkeleton className="text-2xl font-semibold" barClassName="w-56" />
                <TextLineSkeleton barClassName="w-32" />
              </div>
              <div className="text-xs text-muted-foreground">
                הופק בתאריך <Skeleton className="inline-block h-[0.75em] w-20 align-middle" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Box label="לקוח" lines={["", "", ""]} />
              <Box label="פרטי פרויקט" lines={["סוג:", "התחלה:", "סיום:"]} />
              <Box label="מנהל פרויקט" lines={[""]} />
            </div>

            <Box label="כתובת / כתובות" lines={[""]} />
          </header>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6">
              <section className="space-y-2">
                <h2 className="text-lg font-semibold">צוות עובדים</h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[0, 1].map((i) => (
                    <div key={i} className="rounded-xl border p-3">
                      <TextLineSkeleton barClassName="w-24" />
                      <TextLineSkeleton className="mt-1" barClassName="w-20" />
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <h2 className="text-lg font-semibold">משימות / צ׳קליסט</h2>
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-start gap-3 rounded-xl border p-3">
                      <div className="mt-0.5 h-5 w-5 rounded border" />
                      <div className="min-w-0 flex-1">
                        <TextLineSkeleton barClassName="w-40" />
                        <TextLineSkeleton className="mt-1 text-xs" barClassName="w-32" />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="space-y-6">
              <section className="space-y-2">
                <h2 className="text-lg font-semibold">פריטים להעברה</h2>
                <div className="space-y-2 rounded-xl border p-3">
                  {[0, 1, 2].map((i) => (
                    <TextLineSkeleton key={i} barClassName="w-32" />
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <h2 className="text-lg font-semibold">הערות חשובות</h2>
                <div className="min-h-28 rounded-xl border p-3">
                  <TextLineSkeleton barClassName="w-40" />
                </div>
              </section>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
