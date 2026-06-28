"use client";

import { useEffect, useState } from "react";
import { Car, Check, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type TagOption = { id: string; kind: string; name: string; color?: string | null };

// Module-level cache used ONLY for instant first paint — every mount still
// refetches in the background (stale-while-revalidate), so a car added after a
// picker first loaded shows up the next time any picker opens. A plain "cache it
// forever" approach left the list permanently empty after an early empty load.
let cache: TagOption[] | null = null;

async function loadTags(): Promise<TagOption[]> {
  try {
    const r = await fetch("/api/tags/list", { cache: "no-store" });
    const j = r.ok ? await r.json() : { tags: [] };
    cache = (j?.tags ?? []) as TagOption[];
    return cache;
  } catch {
    return cache ?? [];
  }
}

/** Reserved for callers that want to drop the first-paint cache. */
export function invalidateTagCache() {
  cache = null;
}

/** Existing tag ids attached to an entity — for pre-filling an edit dialog. */
export async function fetchExistingTagIds(entityType: string, entityId: string): Promise<string[]> {
  if (!entityId) return [];
  try {
    const res = await fetch(
      `/api/entity-tags/list?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { tag_ids?: string[] };
    return Array.isArray(json?.tag_ids) ? json.tag_ids : [];
  } catch {
    return [];
  }
}

type Props = {
  value: string[];
  onChange: (ids: string[]) => void;
  /** Restrict to a single tag kind (e.g. "vehicle"). Omit for all kinds. */
  kind?: string;
  label?: string;
};

export function TagPicker({ value, onChange, kind = "vehicle", label = "רכבים מקושרים" }: Props) {
  const [options, setOptions] = useState<TagOption[]>(cache ?? []);

  useEffect(() => {
    let active = true;
    void loadTags().then((tags) => {
      if (active) setOptions(tags);
    });
    return () => {
      active = false;
    };
  }, []);

  const available = kind ? options.filter((o) => o.kind === kind) : options;
  const byId = new Map(options.map((o) => [o.id, o] as const));
  const selected = value.map((id) => byId.get(id)).filter((o): o is TagOption => Boolean(o));

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-sm font-medium">
        <Car className="h-3.5 w-3.5" />
        {label}
      </div>

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 rounded-full border bg-secondary/40 py-0.5 ps-2 pe-1 text-xs"
            >
              {tag.name}
              <button
                type="button"
                onClick={() => toggle(tag.id)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="הסרה"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {available.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          אין רכבים עדיין — הוסיפו רכב במסך &quot;רכבים&quot; כדי לקשר אליו.
        </p>
      ) : (
        <details className="rounded-md border bg-background">
          <summary className="cursor-pointer list-none px-3 py-2 text-sm text-muted-foreground">
            <Plus className="ms-0 me-1 inline h-3.5 w-3.5" />
            קישור לרכב
          </summary>
          <div className="max-h-40 overflow-auto border-t p-1">
            {available.map((tag) => {
              const checked = value.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggle(tag.id)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm hover:bg-muted/40"
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded border ${
                      checked ? "border-primary bg-primary text-primary-foreground" : "border-input"
                    }`}
                  >
                    {checked ? <Check className="h-3 w-3" /> : null}
                  </span>
                  {tag.name}
                  {kind ? null : <Badge variant="neutral">{tag.kind}</Badge>}
                </button>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
