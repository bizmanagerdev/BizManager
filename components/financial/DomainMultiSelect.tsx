"use client";

import { cn } from "@/lib/utils";

export type DomainOption = { key: string; label: string };

/**
 * Chip-style multi-select for business domains, used by the report panels so the
 * user can view several domains together (combined totals) while still seeing
 * each one broken out. An empty selection means "all domains".
 */
export default function DomainMultiSelect({
  domains,
  selected,
  onChange,
}: {
  domains: DomainOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  if (domains.length <= 1) return null;

  const selectedSet = new Set(selected);
  const allActive = selected.length === 0;

  const toggle = (key: string) => {
    const next = new Set(selectedSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(Array.from(next));
  };

  const chip = (active: boolean, label: string, onClick: () => void, key: string) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background text-foreground hover:bg-muted"
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <span className="text-sm font-medium text-muted-foreground">תחומים:</span>
      {chip(allActive, "הכול", () => onChange([]), "__all__")}
      {domains.map((domain) => chip(selectedSet.has(domain.key), domain.label, () => toggle(domain.key), domain.key))}
    </div>
  );
}
