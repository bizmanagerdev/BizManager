import { Fragment } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadIcon } from "@/components/ui/icons";
import { PanelTitle } from "@/components/financial/statement-ui";
import { ButtonSkeleton } from "@/app/(app)/financial/ButtonSkeleton";
import ImportNotes from "./ImportNotes";

// The import page as it opens — CardImportClient's first step, which knows nothing
// yet, so it is nearly all real: the heading and its line, the back link, the card
// with the step bar (drawn here as it looks on the first step — the real one takes
// callbacks a server placeholder can't pass) and the file panel; only the button in
// the drop area is a blank. Shown while the page streams (loading.tsx) and while the
// client's code loads (the page's dynamic() fallback). `smartExtractEnabled` picks
// the notes' PDF line, as the page does.
const STEPS = ["קובץ", "עמודות", "בדיקה ושמירה"];

export default function ImportSkeleton({
  smartExtractEnabled,
  routeLoading = false,
}: {
  smartExtractEnabled: boolean;
  routeLoading?: boolean;
}) {
  return (
    <div className="space-y-4 text-right" dir="rtl" data-route-loading={routeLoading ? "true" : undefined} aria-busy="true">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">העלאת פירוט אשראי</h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>פירוט חדש. אחרי השמירה ממשיכים בעמוד הפירוט: שיוך, חיוב בבנק וסיום.</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonSkeleton label="חזרה לרשימה" size="sm" />
        </div>
      </div>

      <Card>
        <CardContent className="space-y-4 py-4">
          {/* WizardStepper's own markup, first step current. */}
          <div className="mx-auto flex w-full min-w-0 max-w-md items-start overflow-x-auto overflow-y-hidden">
            {STEPS.map((label, i) => (
              <Fragment key={label}>
                <div className="flex shrink-0 flex-col items-center gap-1">
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full border-2 text-[0.588rem] font-semibold ${
                      i === 0 ? "border-primary text-primary" : "border-border text-muted-foreground"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <div
                    className={`w-11 text-center text-[0.588rem] font-medium leading-tight sm:w-14 ${
                      i === 0 ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {label}
                  </div>
                </div>
                {i < STEPS.length - 1 ? <div className="mx-0.5 mt-[9px] h-0.5 min-w-3 flex-1 rounded-full bg-border sm:mx-2" /> : null}
              </Fragment>
            ))}
          </div>

          <div className="space-y-3">
            <PanelTitle
              title="קובץ"
              hint="הפירוט של החודש מחברת האשראי או מהבנק. הכרטיסים, התאריכים והסכומים נקראים ממנו לבד."
            />
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/20 px-4 py-8 text-center">
              <UploadIcon className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">גררו את הקובץ לכאן, או</p>
              <Skeleton className="h-8 w-24" />
              <p className="text-xs text-muted-foreground">קובץ Excel, CSV או PDF</p>
            </div>
            <ImportNotes smartExtractEnabled={smartExtractEnabled} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
