"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { IconButton, DeleteButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { AddIcon, ArrowDownIcon, ArrowUpIcon, ToggleOffIcon, ToggleOnIcon } from "@/components/ui/icons";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { mapTemplate, type UserOption } from "@/lib/meetings/load";
import { createTemplate, deleteTemplate, updateTemplate } from "@/lib/meetings/client";
import { AUTO_SOURCE_PREVIOUS_TASKS, type MeetingItemKind, type MeetingTemplate } from "@/lib/meetings/types";
import { cn } from "@/lib/utils";

// The agenda IS data, and this is where it is edited — add, rename, reorder,
// disable. Nothing about the list is hardcoded in the page, because the user
// said plainly he will keep refining it.
//
// Everything is drafted locally and written on save, so a half-finished rename
// never reaches a meeting that is open on someone else's screen.

type Draft = MeetingTemplate & { isNew?: boolean };

function blankDraft(kind: MeetingItemKind): Draft {
  return {
    id: `new-${Math.random().toString(36).slice(2)}`,
    kind,
    position: 0,
    title: "",
    subpoints: [],
    linkHref: null,
    linkLabel: null,
    defaultAssigneeId: null,
    autoSource: null,
    isActive: true,
    isNew: true,
  };
}

function TemplateEditor({
  draft,
  users,
  isFirst,
  isLast,
  onChange,
  onMove,
  onRemove,
}: {
  draft: Draft;
  users: UserOption[];
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const isAuto = draft.autoSource === AUTO_SOURCE_PREVIOUS_TASKS;
  return (
    <div
      className={cn(
        "space-y-2 rounded-2xl border p-3",
        draft.isActive ? "border-border/70 bg-card/60" : "border-dashed border-border/60 bg-muted/30"
      )}
    >
      <div className="flex items-center gap-2">
        <Input
          value={draft.title}
          onChange={(event) => onChange({ title: event.target.value })}
          placeholder="כותרת הסעיף"
          aria-label="כותרת הסעיף"
          className="h-9 flex-1"
        />
        <IconButton
          icon={ArrowUpIcon}
          label="העלאה למעלה"
          variant="outline"
          disabled={isFirst}
          onClick={() => onMove(-1)}
        />
        <IconButton
          icon={ArrowDownIcon}
          label="הורדה למטה"
          variant="outline"
          disabled={isLast}
          onClick={() => onMove(1)}
        />
        <IconButton
          icon={draft.isActive ? ToggleOnIcon : ToggleOffIcon}
          label={draft.isActive ? "השבתת הסעיף" : "הפעלת הסעיף"}
          variant={draft.isActive ? "success-outline" : "outline"}
          onClick={() => onChange({ isActive: !draft.isActive })}
        />
        <DeleteButton label="מחיקת הסעיף" onClick={onRemove} />
      </div>

      <Textarea
        value={draft.subpoints.join("\n")}
        onChange={(event) =>
          onChange({
            subpoints: event.target.value
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean),
          })
        }
        rows={2}
        placeholder="תת-סעיף בכל שורה"
        aria-label="תת-סעיפים"
        className="text-sm"
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          value={draft.linkHref ?? ""}
          onChange={(event) => onChange({ linkHref: event.target.value.trim() || null })}
          placeholder="/collections"
          aria-label="כתובת הדף שהסעיף פותח"
          className="h-9"
          dir="ltr"
        />
        <Input
          value={draft.linkLabel ?? ""}
          onChange={(event) => onChange({ linkLabel: event.target.value.trim() || null })}
          placeholder="כיתוב הכפתור"
          aria-label="כיתוב כפתור הקישור"
          className="h-9"
        />
      </div>

      {draft.kind === "prep" ? (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">אחראי כברירת מחדל</span>
          <SearchableSelect
            options={users.map((u) => ({ value: u.id, label: u.label }))}
            value={draft.defaultAssigneeId ?? ""}
            onChange={(value) => onChange({ defaultAssigneeId: value || null })}
            emptyOptionLabel="ללא"
            placeholder="בחירת אחראי"
            ariaLabel="אחראי כברירת מחדל"
            className="h-9"
          />
        </div>
      ) : null}

      {isAuto ? (
        <p className="text-[0.6875rem] text-muted-foreground">
          סעיף זה מתמלא אוטומטית מהמשימות שנפתחו בישיבה הקודמת.
        </p>
      ) : null}
    </div>
  );
}

export function MeetingTemplatesDialog({
  open,
  onOpenChange,
  users,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  users: UserOption[];
  onSaved: () => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    setRemovedIds([]);
    void createSupabaseBrowserClient()
      .from("meeting_templates")
      .select("*")
      .order("kind", { ascending: true })
      .order("position", { ascending: true })
      .then(({ data, error: loadError }) => {
        if (!active) return;
        if (loadError) {
          setError("טעינת הסעיפים נכשלה.");
          setDrafts([]);
        } else {
          setDrafts(((data ?? []) as Record<string, unknown>[]).map((row) => mapTemplate(row)));
        }
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const byKind = useCallback((kind: MeetingItemKind) => drafts.filter((d) => d.kind === kind), [drafts]);

  const patchDraft = useCallback((id: string, patch: Partial<Draft>) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, []);

  const move = useCallback(
    (kind: MeetingItemKind, id: string, direction: -1 | 1) => {
      setDrafts((prev) => {
        const same = prev.filter((d) => d.kind === kind);
        const others = prev.filter((d) => d.kind !== kind);
        const index = same.findIndex((d) => d.id === id);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= same.length) return prev;
        const next = [...same];
        [next[index], next[target]] = [next[target], next[index]];
        // Order within a kind is what matters; the two kinds never interleave.
        return kind === "prep" ? [...next, ...others] : [...others, ...next];
      });
    },
    []
  );

  const remove = useCallback((draft: Draft) => {
    setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
    if (!draft.isNew) setRemovedIds((prev) => [...prev, draft.id]);
  }, []);

  const save = useCallback(async () => {
    const untitled = drafts.find((d) => !d.title.trim());
    if (untitled) {
      setError("לכל סעיף חייבת להיות כותרת.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await Promise.all(removedIds.map((id) => deleteTemplate(id)));

      for (const kind of ["prep", "agenda"] as MeetingItemKind[]) {
        const rows = byKind(kind);
        await Promise.all(
          rows.map((draft, index) => {
            // Sparse positions, so a row can later be slipped between two
            // others without rewriting the whole list.
            const position = index * 10;
            const payload = {
              kind: draft.kind,
              position,
              title: draft.title.trim(),
              subpoints: draft.subpoints,
              link_href: draft.linkHref,
              link_label: draft.linkLabel,
              default_assignee_id: draft.kind === "prep" ? draft.defaultAssigneeId : null,
              is_active: draft.isActive,
            };
            return draft.isNew ? createTemplate(payload) : updateTemplate(draft.id, payload);
          })
        );
      }

      toast.success("סעיפי הישיבה נשמרו");
      onSaved();
      onOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "שמירת הסעיפים נכשלה");
    } finally {
      setSaving(false);
    }
  }, [byKind, drafts, onOpenChange, onSaved, removedIds]);

  const renderGroup = (kind: MeetingItemKind, heading: string) => {
    const rows = byKind(kind);
    return (
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{heading}</h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setDrafts((prev) => [...prev, blankDraft(kind)])}
          >
            <AddIcon />
            סעיף חדש
          </Button>
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">אין סעיפים.</p>
        ) : (
          rows.map((draft, index) => (
            <TemplateEditor
              key={draft.id}
              draft={draft}
              users={users}
              isFirst={index === 0}
              isLast={index === rows.length - 1}
              onChange={(patch) => patchDraft(draft.id, patch)}
              onMove={(direction) => move(kind, draft.id, direction)}
              onRemove={() => remove(draft)}
            />
          ))
        )}
      </section>
    );
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="סעיפי הישיבה"
      size="form2xl"
      fullScreen
      onSubmit={() => void save()}
      submitLabel="שמירה"
      busyLabel="שומר..."
      busy={saving}
      submitDisabled={loading}
      error={error}
      showCancel
    >
      {loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">טוען סעיפים...</p>
      ) : (
        <div className="space-y-5">
          {renderGroup("prep", "הכנה לישיבה")}
          {renderGroup("agenda", "סדר היום")}
          <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
            שינויים כאן חלים על ישיבות שייפתחו מעכשיו. ישיבות שכבר נפתחו שומרות את הסעיפים
            כפי שהיו באותו רגע.
          </p>
        </div>
      )}
    </FormDialog>
  );
}

export default MeetingTemplatesDialog;
