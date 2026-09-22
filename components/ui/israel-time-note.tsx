"use client";

import { useEffect, useState } from "react";
import { GlobeIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { isDeviceClockOnIsraelTime, israelParts } from "@/lib/timezone";
import type { Locale } from "@/lib/i18n/types";

/**
 * "זמנים נשמרים לפי שעון ישראל (כעת 15:30)" — shown ONLY when the device's clock
 * disagrees with Israel's.
 *
 * Every time field in the app is an Israel wall clock, because that is the clock
 * payroll and the office keep. A worker abroad would otherwise have no way to
 * know why the form opened on 15:30 when his own phone says 08:30, and would
 * "correct" it back to the wrong hour — which is the bug this note exists to
 * stop happening twice.
 *
 * Nothing renders on the server or on the first paint: the server runs UTC and
 * the device runs wherever it is, so deciding this during render would
 * hydrate-mismatch. It appears after mount or not at all, and a device already
 * on Israel time never sees it.
 */

const TEXT: Record<Locale, (time: string) => string> = {
  he: (time) => `זמנים נשמרים לפי שעון ישראל (כעת ${time})`,
  ar: (time) => `تُحفظ الأوقات بتوقيت إسرائيل (الآن ${time})`,
};

export function IsraelTimeNote({ locale = "he", className }: { locale?: Locale; className?: string }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (isDeviceClockOnIsraelTime()) return;
    const render = () => {
      const now = israelParts(new Date());
      const time = `${String(now.hour).padStart(2, "0")}:${String(now.minute).padStart(2, "0")}`;
      setLabel((TEXT[locale] ?? TEXT.he)(time));
    };
    render();
    // The hour on the note has to stay true while a form sits open, or it
    // becomes one more wrong time on the screen.
    const id = setInterval(render, 60_000);
    return () => clearInterval(id);
  }, [locale]);

  if (!label) return null;

  return (
    <p className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <GlobeIcon className="h-3.5 w-3.5 shrink-0" />
      <span>{label}</span>
    </p>
  );
}

export default IsraelTimeNote;
