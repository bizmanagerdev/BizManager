// One "bar" for a car's טסט / ביטוח / רישוי — label + a kind-specific icon
// anchored at one end, the due date + status pill at the other, each row its
// own soft rounded pill (not one bordered box with thin dividers). Shared by
// the /vehicles list card and the car detail header so the two never drift.

import { ApprovedDocumentIcon, IdCardIcon, ShieldIcon, type IconComponent } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { expiryStatus } from "@/lib/vehicles";
import { cn } from "@/lib/utils";

export type VehicleExpiryKind = "test" | "insurance" | "license";

const KIND_ICONS: Record<VehicleExpiryKind, IconComponent> = {
  test: ApprovedDocumentIcon,
  insurance: ShieldIcon,
  license: IdCardIcon,
};

/** "2027-02-16" (or a full ISO timestamp) → "16.02.2027", the Hebrew day-first convention. */
function formatExpiryDate(value: string): string {
  const [y, m, d] = value.slice(0, 10).split("-");
  if (!y || !m || !d) return value;
  return `${d}.${m}.${y}`;
}

export function VehicleExpiryRow({ kind, label, date }: { kind: VehicleExpiryKind; label: string; date: string | null }) {
  const status = expiryStatus(date);
  const Icon = KIND_ICONS[kind];
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2.5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span>{label}</span>
        <Icon className={cn("h-4 w-4 shrink-0", date ? "text-muted-foreground" : "text-muted-foreground/40")} />
      </div>
      <div className="flex items-center gap-2">
        {date ? (
          <>
            <span className="text-sm font-medium">{formatExpiryDate(date)}</span>
            {status ? <Badge variant={status.tone}>{status.label}</Badge> : null}
          </>
        ) : (
          <span className="text-sm text-muted-foreground">לא הוגדר</span>
        )}
      </div>
    </div>
  );
}
