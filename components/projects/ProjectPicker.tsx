"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

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

export function ProjectPicker({
  projects,
  value,
  onChange,
  searchPlaceholder = "חיפוש פרויקט לפי שם או לקוח",
  emptyLabel = "ללא פרויקט",
  noResultsLabel = "לא נמצאו פרויקטים לחיפוש הזה.",
  allowClear = true,
  disabled = false,
  maxHeightClassName = "max-h-56",
}: ProjectPickerProps) {
  const selected = useMemo(
    () => projects.find((p) => p.id === value) ?? null,
    [projects, value]
  );
  const [query, setQuery] = useState(selected?.label ?? "");

  // Sync the query with externally-driven changes to the selected id (e.g. parent reset).
  // Tracking the previous id ensures we only re-sync when the selection actually changes,
  // not on every render — so it doesn't clobber the user's typing.
  const lastSyncedIdRef = useRef(value);
  useEffect(() => {
    if (lastSyncedIdRef.current !== value) {
      lastSyncedIdRef.current = value;
      setQuery(selected?.label ?? "");
    }
  }, [value, selected]);

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return projects;
    return projects.filter((project) => {
      if (project.id === value) return true;
      return (
        normalize(project.label).includes(q) ||
        normalize(project.customerName).includes(q)
      );
    });
  }, [projects, query, value]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
        />
        {allowClear && value ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange("");
              setQuery("");
            }}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
          >
            ניקוי
          </button>
        ) : null}
      </div>

      <div className={`${maxHeightClassName} space-y-1 overflow-auto rounded-md border p-1`}>
        {allowClear ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange("");
              setQuery("");
            }}
            className={`w-full rounded-lg border px-3 py-2 text-right text-xs transition-all duration-200 ${
              value === ""
                ? "border-primary/20 bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                : "border-dashed border-border bg-background text-muted-foreground hover:bg-accent"
            }`}
          >
            {emptyLabel}
          </button>
        ) : null}

        {filtered.map((project) => {
          const isSelected = project.id === value;
          const date = formatStartDate(project.startDate);
          return (
            <button
              key={project.id}
              type="button"
              disabled={disabled}
              onClick={() => {
                onChange(project.id);
                setQuery(project.label);
              }}
              className={`w-full rounded-lg border px-3 py-2 text-right text-sm transition-all duration-200 ${
                isSelected
                  ? "border-primary/20 bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                  : "border-border bg-accent/40 text-accent-foreground hover:bg-accent"
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{project.label}</span>
                {project.customerName ? (
                  <span
                    className={`text-xs ${
                      isSelected ? "text-primary-foreground/70" : "text-muted-foreground"
                    }`}
                  >
                    · {project.customerName}
                  </span>
                ) : null}
                {date ? (
                  <span
                    className={`text-xs ${
                      isSelected ? "text-primary-foreground/70" : "text-muted-foreground"
                    }`}
                  >
                    · {date}
                  </span>
                ) : null}
              </div>
            </button>
          );
        })}

        {filtered.length === 0 ? (
          <div className="p-2 text-sm text-muted-foreground">{noResultsLabel}</div>
        ) : null}
      </div>
    </div>
  );
}
