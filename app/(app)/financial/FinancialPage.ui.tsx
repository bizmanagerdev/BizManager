import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import type { FinancialEntry, FinancialEntryStage, FinancialSourceKind } from "@/lib/financial";

// Pure label/variant helpers + presentational components extracted from
// FinancialPageClient so the page file holds state + orchestration, not badges
// and label maps. No component state here.

export function sourceKindLabel(kind: FinancialSourceKind | null) {
  if (kind === "project") return "פרויקט";
  if (kind === "property") return "נכס";
  if (kind === "order") return "הזמנה";
  return "מקור";
}

export function stageLabel(stage: FinancialEntryStage) {
  if (stage === "scheduled") return "צפוי";
  if (stage === "pending") return "ממתין";
  return "בפועל";
}

export function stageVariant(stage: FinancialEntryStage) {
  if (stage === "scheduled") return "info-outline" as const;
  if (stage === "pending") return "warning-outline" as const;
  return "success-outline" as const;
}

export function typeLabel(type: FinancialEntry["type"]) {
  return type === "inflow" ? "כניסה" : "יציאה";
}

export function typeVariant(type: FinancialEntry["type"]) {
  return type === "inflow" ? ("success-outline" as const) : ("destructive-outline" as const);
}

export function typeAmountClass(type: FinancialEntry["type"]) {
  return type === "inflow" ? "text-success" : "text-destructive";
}

export function sourceTypeTitle(kind: FinancialSourceKind) {
  if (kind === "project") return "פרויקט";
  if (kind === "property") return "נכס";
  if (kind === "order") return "הזמנה";
  return "שוטף";
}

export function SummaryCard({
  title,
  value,
  description,
  accent,
}: {
  title: string;
  value: string;
  description: string;
  accent?: "success" | "destructive" | "default";
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5 text-right">
        <div className="text-sm text-muted-foreground">{title}</div>
        <div
          dir="ltr"
          className={cn(
            "mt-2 text-2xl font-semibold tabular-nums",
            accent === "success" && "text-success",
            accent === "destructive" && "text-destructive"
          )}
        >
          {value}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
      </CardContent>
    </Card>
  );
}

export function SelectField({
  value,
  onChange,
  children,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="space-y-1.5 text-sm text-right">
      <span className="font-medium">{label}</span>
      <NativeSelect
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </NativeSelect>
    </label>
  );
}

export function FilterLoadingDots() {
  return (
    <div className="flex justify-center" aria-live="polite" aria-label="טוען נתונים פיננסיים">
      <div className="flex items-center gap-4">
        {[
          { delayMs: 0, className: "bg-primary shadow-primary/35" },
          { delayMs: 150, className: "bg-secondary shadow-secondary/35" },
          { delayMs: 300, className: "bg-primary shadow-primary/35" },
          { delayMs: 450, className: "bg-secondary shadow-secondary/35" },
        ].map(({ delayMs, className }) => (
          <span
            key={delayMs}
            className={cn("h-7 w-7 animate-pulse rounded-full shadow-xl", className)}
            style={{ animationDelay: `${delayMs}ms`, animationDuration: "1s" }}
          />
        ))}
      </div>
    </div>
  );
}
