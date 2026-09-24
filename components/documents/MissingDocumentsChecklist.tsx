"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckIcon } from "@/components/ui/icons";
import { fetchChecklistForEntity, type ChecklistItem } from "@/lib/documents/checklist";
import type { ChecklistEntityType } from "@/lib/documents/categories";

// "מסמכים חסרים" — what this entity is expected to hold, and what it actually
// holds. Renders NOTHING when no category is marked required for this entity
// type, so mounting it on a page is free until an admin configures something.
//
// Uploading is delegated to the host page via `onUpload` rather than embedding
// an uploader: the vehicle and property pages already have their own upload
// flows with the right links and domain pre-set, and duplicating that here
// would mean two ways to attach a file to the same entity.

export default function MissingDocumentsChecklist({
  entityType,
  entityId,
  onUpload,
  refreshKey,
}: {
  entityType: ChecklistEntityType;
  entityId: string;
  /** Called with the missing category's code; omit to hide the upload buttons. */
  onUpload?: (categoryCode: string) => void;
  /** Bump to re-check after the host page uploads something. */
  refreshKey?: number;
}) {
  const [items, setItems] = useState<ChecklistItem[] | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    fetchChecklistForEntity(entityType, entityId)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => setItems([]));
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId]);

  useEffect(() => load(), [load, refreshKey]);

  // Nothing required for this entity type (the default) — render nothing at all
  // rather than an empty card.
  if (!items || items.length === 0) return null;

  const missing = items.filter((item) => !item.present);

  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
        מסמכים נדרשים
        {missing.length > 0 ? (
          <span className="text-xs font-normal text-destructive">{missing.length} חסרים</span>
        ) : (
          <span className="text-xs font-normal text-muted-foreground">הכול מעודכן</span>
        )}
      </div>

      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.code} className="flex flex-wrap items-center gap-2 text-sm">
            {item.present ? (
              <CheckIcon className="h-4 w-4 shrink-0 text-success" aria-hidden />
            ) : (
              <span
                className="inline-block h-4 w-4 shrink-0 rounded-full border border-destructive"
                aria-hidden
              />
            )}
            <span className={item.present ? "" : "text-muted-foreground"}>{item.label}</span>
            {item.present && item.validUntil ? (
              <span className="text-xs text-muted-foreground">בתוקף עד {item.validUntil}</span>
            ) : null}
            {!item.present && onUpload ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7"
                onClick={() => onUpload(item.code)}
              >
                העלאה
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
