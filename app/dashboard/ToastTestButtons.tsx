"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export default function ToastTestButtons() {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-secondary-9 bg-secondary-10/40 px-4 py-3">
      <span className="text-xs font-medium text-muted-foreground">בדיקת טוסטים:</span>
      <Button
        type="button"
        size="sm"
        className="bg-success text-white shadow-sm hover:bg-success/90"
        onClick={() => toast.success("ההוצאה נשמרה", { description: "הפעולה הסתיימה בהצלחה" })}
      >
        הצלחה
      </Button>
      <Button
        type="button"
        size="sm"
        className="bg-destructive text-white shadow-sm hover:bg-destructive/90"
        onClick={() => toast.error("השמירה נכשלה", { description: "אירעה שגיאה בעת השמירה" })}
      >
        שגיאה
      </Button>
      <Button
        type="button"
        size="sm"
        className="bg-warning text-white shadow-sm hover:bg-warning/90"
        onClick={() => toast.warning("שימו לב", { description: "הפעולה עלולה להשפיע על נתונים נוספים" })}
      >
        אזהרה
      </Button>
      <Button
        type="button"
        size="sm"
        className="bg-info text-white shadow-sm hover:bg-info/90"
        onClick={() => toast.info("לידיעתכם", { description: "הסנכרון רץ ברקע" })}
      >
        מידע
      </Button>
      <Button
        type="button"
        size="sm"
        className="bg-secondary text-white shadow-sm hover:bg-secondary/90"
        onClick={() => {
          const id = toast.loading("מעבד...", { description: "אנא המתינו" });
          setTimeout(() => toast.success("בוצע!", { id, description: "הפעולה הסתיימה בהצלחה" }), 2000);
        }}
      >
        בתהליך
      </Button>
    </div>
  );
}
