"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AddIcon, CheckIcon, CloseIcon, VehicleIcon } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type TagOption = { id: string; kind: string; name: string; color?: string | null };

// Module-level cache used ONLY for instant first paint — every mount still
// refetches in the background (stale-while-revalidate), so a car added after a
// picker first loaded shows up the next time any picker opens. A plain "cache it
// forever" approach left the list permanently empty after an early empty load.
let cache: TagOption[] | null = null;

// Reads straight from Supabase (no /api/tags/list round trip) — RLS on `tags`
// enforces the same active/system_access/role check the route used to do via
// requireRouteAccess (see the tighten_tags_entity_tags_rls migration).
async function loadTags(): Promise<TagOption[]> {
  try {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("tags")
      .select("id,kind,name,color")
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (error) throw error;
    cache = (data ?? []) as TagOption[];
    return cache;
  } catch {
    return cache ?? [];
  }
}

/** Reserved for callers that want to drop the first-paint cache. */
export function invalidateTagCache() {
  cache = null;
}

// A fixed allow-list of tag kinds creatable inline from a picker — mirrors the
// old /api/tags/create route exactly ('vehicle' stays owned by the vehicles
// flow, which also creates a detail row). RLS ("Staff manage tags",
// admin/office) already matches the route's own allowedRoles gate.
const CREATABLE_KINDS = new Set(["general", "campaign", "vendor"]);

async function createTagDirect(name: string, requestedKind: string): Promise<TagOption | null> {
  const kind = CREATABLE_KINDS.has(requestedKind) ? requestedKind : "general";
  const supabase = createSupabaseBrowserClient();

  // Reuse an existing active tag of the same kind+name so the same label
  // isn't duplicated every time it's typed.
  const { data: existing } = await supabase
    .from("tags")
    .select("id,kind,name,color")
    .eq("kind", kind)
    .eq("name", name)
    .eq("is_active", true)
    .maybeSingle();
  if (existing) return existing as TagOption;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("tags")
    .insert({ kind, name, created_by: user?.id ?? null })
    .select("id,kind,name,color")
    .maybeSingle();
  if (error || !data) return null;
  return data as TagOption;
}

/** Existing tag ids attached to an entity — for pre-filling an edit dialog.
 *  Reads straight from Supabase — same RLS gate as loadTags() above. */
export async function fetchExistingTagIds(entityType: string, entityId: string): Promise<string[]> {
  if (!entityId) return [];
  try {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("entity_tags")
      .select("tag_id")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId);
    if (error) return [];
    return ((data ?? []) as Array<{ tag_id?: string }>)
      .map((r) => r.tag_id)
      .filter((id): id is string => Boolean(id));
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
  /** Icon shown next to the label. Defaults to the vehicle (Car) glyph. */
  icon?: ReactNode;
  /** Empty-state hint when no tags of this kind exist yet. */
  emptyText?: string;
  /** Label on the expander that opens the pick list. */
  addLabel?: string;
  /** Allow creating a new tag inline (of `createKind`, defaults to `kind`). */
  allowCreate?: boolean;
  createKind?: string;
};

export function TagPicker({
  value,
  onChange,
  kind = "vehicle",
  label = "רכבים מקושרים",
  icon = <VehicleIcon className="h-3.5 w-3.5" />,
  emptyText = 'אין רכבים עדיין — הוסיפו רכב במסך "רכבים" כדי לקשר אליו.',
  addLabel = "קישור לרכב",
  allowCreate = false,
  createKind,
}: Props) {
  const [options, setOptions] = useState<TagOption[]>(cache ?? []);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

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

  async function createTag() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const tag = await createTagDirect(name, createKind ?? kind);
      if (tag) {
        invalidateTagCache();
        setOptions((prev) => (prev.some((o) => o.id === tag.id) ? prev : [...prev, tag]));
        if (!value.includes(tag.id)) onChange([...value, tag.id]);
        setNewName("");
      }
    } catch {
      // additive — never block the surrounding form
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-sm font-medium">
        {icon}
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
                <CloseIcon className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {available.length === 0 && !allowCreate ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <details className="rounded-md border bg-background">
          <summary className="cursor-pointer list-none px-3 py-2 text-sm text-muted-foreground">
            <AddIcon className="ms-0 me-1 inline h-3.5 w-3.5" />
            {addLabel}
          </summary>
          <div className="max-h-40 overflow-auto border-t p-1">
            {available.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">אין תגיות עדיין.</p>
            ) : (
              available.map((tag) => {
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
                      {checked ? <CheckIcon className="h-3 w-3" /> : null}
                    </span>
                    {tag.name}
                    {kind ? null : <Badge variant="neutral">{tag.kind}</Badge>}
                  </button>
                );
              })
            )}
          </div>
          {allowCreate ? (
            <div className="flex items-center gap-1.5 border-t p-1.5">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void createTag();
                  }
                }}
                className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                aria-label="תגית חדשה"
              />
              <button
                type="button"
                onClick={() => void createTag()}
                disabled={creating || !newName.trim()}
                className="inline-flex h-8 items-center gap-1 rounded-md bg-secondary px-2 text-xs font-medium text-secondary-foreground disabled:opacity-50"
              >
                <AddIcon className="h-3.5 w-3.5" />
                {creating ? "מוסיף..." : "הוספה"}
              </button>
            </div>
          ) : null}
        </details>
      )}
    </div>
  );
}
