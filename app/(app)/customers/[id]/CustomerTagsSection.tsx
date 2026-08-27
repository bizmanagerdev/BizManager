"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { CloseIcon } from "@/components/ui/icons";
import { offlineFetch } from "@/lib/offline-queue";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";

type CustomerTag = { id: string; name: string; color?: string | null };

/** Customer segment tags (הערות tags block) with an inline erase-tag option. */
export default function CustomerTagsSection({
  customerId,
  tags,
}: {
  customerId: string;
  tags: CustomerTag[];
}) {
  const router = useRouter();
  const [removingId, setRemovingId] = useState<string | null>(null);

  if (tags.length === 0) return null;

  async function removeTag(tagId: string) {
    if (removingId) return;
    setRemovingId(tagId);
    try {
      const remaining = tags.filter((t) => t.id !== tagId).map((t) => t.id);
      const result = await offlineFetch(
        "/api/customers/update",
        { id: customerId, tag_ids: remaining },
        "הסרת תגית"
      );
      if (!result.queued && !result.ok) {
        toast.error("הסרת התגית נכשלה", { description: toHebrewError(result.error, "") });
        return;
      }
      if (!result.queued) toast.success("התגית הוסרה");
      router.refresh();
    } catch {
      toast.error("הסרת התגית נכשלה");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <Badge key={tag.id} className={`gap-1 ps-2.5 pe-1 ${getStatusColorClasses("info")}`}>
          {tag.name}
          <button
            type="button"
            onClick={() => void removeTag(tag.id)}
            disabled={removingId === tag.id}
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
