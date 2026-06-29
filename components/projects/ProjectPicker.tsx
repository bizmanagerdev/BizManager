"use client";

import { useMemo } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";

// Captured once at module load (not during render) so the closest-project
// ordering stays a pure computation and satisfies the React purity rules.
const NOW_MS = Date.now();

export type ProjectPickerOption = {
  id: string;
  label: string;
  customerName?: string | null;
  startDate?: string | null;
};

export interface ProjectPickerProps {
  projects: ProjectPickerOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  noResultsLabel?: string;
  allowClear?: boolean;
  disabled?: boolean;
  maxHeightClassName?: string;
  className?: string;
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function formatStartDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Accept "YYYY-MM-DD" or ISO timestamps; show just the date.
  const datePart = raw.length >= 10 ? raw.slice(0, 10) : raw;
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : raw;
}

/**
 * The single shared "pick a project" search, used in every project dropdown.
 * It is a thin wrapper over {@link SearchableSelect} (the shared dropdown UI)
 * that orders projects closest-first (start date nearest to today, undated
 * sink to the bottom) and surfaces the customer name + date as a search hint.
 */
export function ProjectPicker({
  projects,
  value,
  onChange,
  placeholder = "בחירת פרויקט...",
  searchPlaceholder = "חיפוש פרויקט לפי שם או לקוח",
  emptyLabel = "ללא פרויקט",
  noResultsLabel = "לא נמצאו פרויקטים לחיפוש הזה.",
  allowClear = true,
  disabled = false,
  maxHeightClassName = "max-h-56",
  className,
}: ProjectPickerProps) {
  // Order so the project whose start date is closest to today comes first,
  // then alphabetically; expose customer + date as a searchable hint line.
  const options = useMemo(() => {
    const distanceToToday = (raw: string | null | undefined) => {
      if (!raw) return Number.POSITIVE_INFINITY;
      const parsed = Date.parse(raw.length >= 10 ? raw.slice(0, 10) : raw);
      return Number.isFinite(parsed) ? Math.abs(parsed - NOW_MS) : Number.POSITIVE_INFINITY;
    };
    return [...projects]
      .sort((a, b) => {
        const da = distanceToToday(a.startDate);
        const db = distanceToToday(b.startDate);
        if (da !== db) return da - db;
        return normalize(a.label).localeCompare(normalize(b.label), "he");
      })
      .map((project) => {
        const hint = [project.customerName, formatStartDate(project.startDate)]
          .filter(Boolean)
          .join(" · ");
        return { value: project.id, label: project.label, hint: hint || null };
      });
  }, [projects]);

  return (
    <SearchableSelect
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptyOptionLabel={allowClear ? emptyLabel : undefined}
      noResultsLabel={noResultsLabel}
      disabled={disabled}
      maxHeightClassName={maxHeightClassName}
      className={className}
      searchThreshold={0}
    />
  );
}
