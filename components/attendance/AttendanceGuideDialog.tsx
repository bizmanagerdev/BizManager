"use client";

import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** The ClickCall attendance line workers dial. Update here if the number ever changes. */
export const ATTENDANCE_GUIDE_PHONE = "02-3028762";

type MenuRow = { key: string; text: string };

const MAIN_MENU: MenuRow[] = [
  { key: "1", text: "כניסה — תחילת משמרת" },
  { key: "2", text: "יציאה — סיום משמרת" },
  { key: "3", text: "דיווח מאוחר — אם שכחתם" },
];

const LATE_MENU: MenuRow[] = [
  { key: "1", text: "כניסה מאוחרת בלבד" },
  { key: "2", text: "יציאה מאוחרת בלבד" },
  { key: "3", text: "משמרת שלמה — כניסה ויציאה" },
];

/** A self-contained A4 one-pager (no app chrome) for the print window. */
function buildGuideHtml() {
  const opt = (rows: MenuRow[]) =>
    rows
      .map((r) => `<div class="opt"><span class="key">${r.key}</span><span>${r.text}</span></div>`)
      .join("");
  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><title>דיווח נוכחות בטלפון</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,"Segoe UI",sans-serif;margin:0;padding:32px;color:#0A1020}
  .page{max-width:720px;margin:0 auto}
  h1{text-align:center;font-size:34px;margin:0 0 4px}
  .sub{text-align:center;color:#666;margin:0 0 24px;font-size:16px}
  .phone{text-align:center;background:#0369A1;color:#fff;border-radius:18px;padding:18px;margin-bottom:28px}
  .phone small{display:block;font-size:15px;opacity:.9;margin-bottom:4px}
  .phone b{font-size:38px;letter-spacing:2px}
  h2{font-size:20px;border-bottom:2px solid #0369A1;padding-bottom:6px;margin:22px 0 10px}
  .opt{display:flex;align-items:center;gap:14px;padding:8px 0;font-size:20px}
  .key{flex:0 0 auto;width:46px;height:46px;border-radius:12px;background:#0A1020;color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:bold}
  .note{background:#f3f4f6;border-radius:12px;padding:14px 16px;font-size:16px;margin-top:18px;line-height:1.7}
  @page{margin:16mm}
  @media print{body{padding:0}}
</style></head>
<body><div class="page">
  <h1>דיווח נוכחות בטלפון</h1>
  <p class="sub">מדריך קצר לעובדים</p>
  <div class="phone"><small>חייגו למספר</small><b>${ATTENDANCE_GUIDE_PHONE}</b></div>
  <h2>תפריט ראשי</h2>
  ${opt(MAIN_MENU)}
  <h2>דיווח מאוחר (אחרי הקשה 3)</h2>
  ${opt(LATE_MENU)}
  <div class="note">לאחר הבחירה הקישו לפי ההנחיה:<br>• <b>תאריך</b> — יום וחודש, 4 ספרות (למשל 0407 = 4 ביולי)<br>• <b>שעה</b> — שעה ודקות, 4 ספרות (למשל 0830 = 08:30)</div>
  <div class="note">בסוף כל דיווח תשמעו הודעת אישור. אם שמעתם "מספר לא מזוהה" — פנו למשרד.</div>
</div></body></html>`;
}

export function AttendanceGuideDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  function print() {
    const w = window.open("", "_blank", "width=820,height=1000");
    if (!w) {
      toast.error("חלון ההדפסה נחסם — יש לאשר חלונות קופצים.");
      return;
    }
    w.document.open();
    w.document.write(buildGuideHtml());
    w.document.close();
    // Let the new document lay out before printing.
    setTimeout(() => {
      w.focus();
      w.print();
    }, 300);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="space-y-1 text-start">
          <DialogTitle>מדריך דיווח נוכחות לעובדים</DialogTitle>
          <DialogDescription>דף אחד להדפסה ולתלייה — המספר וההנחיות לעובדים.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-xl bg-secondary px-4 py-3 text-center text-secondary-foreground">
            <div className="text-xs opacity-90">חייגו למספר</div>
            <div className="text-2xl font-bold tracking-wide">{ATTENDANCE_GUIDE_PHONE}</div>
          </div>

          <div>
            <div className="mb-1 font-semibold">תפריט ראשי</div>
            <ul className="space-y-1">
              {MAIN_MENU.map((r) => (
                <li key={r.key} className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">{r.key}</span>
                  <span>{r.text}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="mb-1 font-semibold">דיווח מאוחר (אחרי הקשה 3)</div>
            <ul className="space-y-1">
              {LATE_MENU.map((r) => (
                <li key={r.key} className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">{r.key}</span>
                  <span>{r.text}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
            לאחר הבחירה מקישים תאריך (יום+חודש, 4 ספרות) ושעה (שעה+דקות, 4 ספרות). בסוף כל דיווח נשמעת הודעת אישור.
          </p>
        </div>

        <div className="mt-2 flex justify-end">
          <Button type="button" onClick={print}>
            הדפסה
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AttendanceGuideDialog;
