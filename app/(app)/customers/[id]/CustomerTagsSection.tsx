"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { CloseIcon } from "@/components/ui/icons";
import { offlineFetch } from "@/lib/offline-queue";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { isUndoHidden, scheduleDeferredDelete } from "@/lib/undo-engine";

type CustomerTag = { id: string; name: string; color?: string | null };

/** Customer segment tags (הערות tags block) with an inline erase-tag option. */
export default function CustomerTagsSection({
  customerId,
  tags: tagsProp,
}: {
  customerId: string;
  tags: CustomerTag[];
}) {
  const router = useRouter();
  const scope = `customer-tag:${customerId}`;
  const tags = useUndoOverlay(tagsProp, (t) => t.id, scope);

  if (tags.length === 0) return null;

  function removeTag(tagId: string) {
    scheduleDeferredDelete({
      scope,
      id: tagId,
      message: "התגית הוסרה",
      onCommit: async () => {
        // Recomputed at commit time (not captured when scheduled) so two tags
        // removed within the same undo window don't race and resurrect each
        // other — isUndoHidden reflects every removal still pending or already
        // committed, not just this one.
        const remaining = tagsProp.filter((t) => !isUndoHidden(scope, t.id)).map((t) => t.id);
        const result = await offlineFetch(
          "/api/customers/update",
          { id: customerId, tag_ids: remaining },
          "הסרת תגית"
        );
        if (!result.queued && !result.ok) {
          return { ok: false, error: toHebrewError(result.error, "הסרת התגית נכשלה.") };
        }
        router.refresh();
        return { ok: true };
      },
    });
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <Badge key={tag.id} className={`gap-1 ps-2.5 pe-1 ${getStatusColorClasses("info")}`}>
          {tag.name}
          <button
            type="button"
            onClick={() => removeTag(tag.id)}
            className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
            aria-label={`הסרת תגית ${tag.name}`}
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
}
