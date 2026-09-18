"use client";

import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DeleteButton } from "@/components/ui/icon-button";
import { AddIcon } from "@/components/ui/icons";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ProjectPicker } from "@/components/projects/ProjectPicker";
import { DomainSelect } from "@/components/financial/DomainSelect";
import { MAX_SPLIT_PARTS, resolveSplit, type SplitPartDraft } from "@/lib/financial/statementSplit";

// "פיצול לכמה תחומים" inside a statement line's edit dialog: one line per
// domain with its amount; the last line takes whatever the others leave
// ("והשאר לשוטף"), so the parts always add up to the line.

export function emptySplitPart(domain = ""): SplitPartDraft {
  return { domain, amount: "", projectId: "", propertyId: "" };
}

const ils = (n: number) =>
  new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export function StatementRowSplit({
  total,
  parts,
  onChange,
  onCancel,
  projects,
  properties,
}: {
  total: number;
  parts: SplitPartDraft[];
  onChange: (parts: SplitPartDraft[]) => void;
  onCancel: () => void;
  projects: Array<{ id: string; name: string }>;
  properties: Array<{ id: string; name: string }>;
}) {
  const { remainder } = resolveSplit(total, parts);
  const patch = (index: number, change: Partial<SplitPartDraft>) =>
    onChange(parts.map((p, i) => (i === index ? { ...p, ...change } : p)));

  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">פיצול {ils(total)} לתחומים</span>
        <button type="button" onClick={onCancel} className="text-xs text-secondary hover:underline">
          ביטול פיצול
        </button>
      </div>

      {parts.map((part, index) => {
        const isLast = index === parts.length - 1;
        return (
          <div key={index} className="space-y-1.5 rounded-md border bg-background p-2">
            <div className="flex items-center gap-2">
              <DomainSelect
                value={part.domain}
                onChange={(domain) => patch(index, { domain, projectId: "", propertyId: "" })}
                placeholder="— תחום —"
                ariaLabel={`תחום — חלק ${index + 1}`}
                className="h-9 min-w-0 flex-1"
              />
              {isLast ? (
                // The rest: never typed, so the parts can't miss the total.
                <div className="w-32 shrink-0 text-left" aria-label={`סכום — חלק ${index + 1}`}>
                  <div className={`text-sm font-semibold tabular-nums ${remainder > 0 ? "" : "text-destructive"}`}>
                    {ils(remainder)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">השאר</div>
                </div>
              ) : (
                <CurrencyInput
                  value={part.amount}
                  onChange={(e) => patch(index, { amount: e.target.value })}
                  aria-label={`סכום — חלק ${index + 1}`}
                  className="h-9 w-32 shrink-0"
                />
              )}
              {parts.length > 2 ? (
                <DeleteButton
                  label={`הסרת חלק ${index + 1}`}
                  onClick={() => onChange(parts.filter((_, i) => i !== index))}
                />
              ) : null}
            </div>
            {part.domain === "logistics_projects" ? (
              <ProjectPicker
                value={part.projectId}
                onChange={(projectId) => patch(index, { projectId })}
                emptyLabel="— ללא פרויקט —"
                searchPlaceholder="חיפוש פרויקט..."
                className="h-9 rounded-md px-2"
                projects={projects.map((p) => ({ id: p.id, label: p.name }))}
              />
            ) : part.domain === "property_management" ? (
              <SearchableSelect
                value={part.propertyId}
                onChange={(propertyId) => patch(index, { propertyId })}
                ariaLabel={`נכס — חלק ${index + 1}`}
                emptyOptionLabel="— ללא נכס —"
                searchPlaceholder="חיפוש נכס..."
                className="h-9 rounded-md px-2"
                options={properties.map((p) => ({ value: p.id, label: p.name }))}
              />
            ) : null}
          </div>
        );
      })}

      {parts.length < MAX_SPLIT_PARTS ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          // A new part goes before the last one, which keeps taking the rest.
          onClick={() => onChange([...parts.slice(0, -1), emptySplitPart(), parts[parts.length - 1]])}
        >
          <AddIcon className="h-4 w-4" />
          עוד תחום
        </Button>
      ) : null}
    </div>
  );
}
