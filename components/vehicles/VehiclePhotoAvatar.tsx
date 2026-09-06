"use client";

/* eslint-disable @next/next/no-img-element */

// One photo per car — not a gallery. Shown as a small read-only avatar on the
// /vehicles list cards (so a fleet is recognizable at a glance) and as a
// bigger, EDITABLE avatar on the car's own detail page header (add / replace /
// remove), the same "single slot with a camera badge" pattern used for
// profile pictures everywhere else, not the multi-image DeliveryImagesCard
// pattern — this car has exactly one photo, or none.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CameraIcon, CloseIcon, SpinnerIcon, VehicleIcon } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { offlineUpload } from "@/lib/offline-upload";
import { toHebrewError } from "@/lib/error-messages";
import { registerReversibleAction, scheduleDeferredEdit } from "@/lib/undo-engine";
import { cn } from "@/lib/utils";

const SIZE_CLASSES = {
  sm: "h-14 w-14",
  lg: "h-16 w-16 sm:h-24 sm:w-24",
} as const;

type Props = {
  tagId: string;
  name: string;
  photoUrl: string | null;
  size?: "sm" | "lg";
  /** Add/replace/remove controls. Only the detail page's header passes true. */
  editable?: boolean;
  className?: string;
};

export default function VehiclePhotoAvatar({ tagId, name, photoUrl, size = "sm", editable = false, className }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const result = await offlineUpload(`/api/vehicles/${tagId}/photo`, { file, label: `תמונת ${name}` });
      if (result.queued) {
        toast.info("התמונה תועלה כשהחיבור יחזור.");
        return;
      }
      if (!result.ok) {
        toast.error(result.error || "העלאת התמונה נכשלה.");
        return;
      }
      router.refresh();
      registerReversibleAction({
        key: `vehicle-photo:add:${tagId}`,
        message: "התמונה נשמרה",
        onUndo: async () => {
          const res = await fetch(`/api/vehicles/${tagId}/photo`, { method: "DELETE" });
          if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            return { ok: false, error: toHebrewError((json as { error?: string })?.error, "ביטול ההעלאה נכשל.") };
          }
          router.refresh();
          return { ok: true };
        },
      });
    } finally {
      setBusy(false);
    }
  }

  function confirmRemovePhoto() {
    setConfirmRemove(false);
    scheduleDeferredEdit({
      scope: "vehicle",
      id: tagId,
      message: "התמונה הוסרה",
      patch: { photoUrl: null, photoDocumentId: null },
      onCommit: async () => {
        const res = await fetch(`/api/vehicles/${tagId}/photo`, { method: "DELETE" });
        if (res.ok) {
          router.refresh();
          return { ok: true };
        }
        const json = await res.json().catch(() => ({}));
        return { ok: false, error: toHebrewError((json as { error?: string })?.error, "הסרת התמונה נכשלה.") };
      },
    });
  }

  return (
    <div className={cn("relative shrink-0", SIZE_CLASSES[size], className)}>
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={name}
          className="h-full w-full rounded-xl border border-border/70 object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/30 text-muted-foreground">
          <VehicleIcon className={size === "sm" ? "h-5 w-5" : "h-7 w-7"} />
        </div>
      )}

      {editable ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleFile(file);
            }}
          />
          {/* The whole tile is the target, not a small badge bolted onto its
              corner — bigger to tap, and the camera glyph sits inset as an
              overlay instead of overflowing past the tile's own edge. */}
          <button
            type="button"
            aria-label={photoUrl ? "החלפת תמונה" : "הוספת תמונה"}
            title={photoUrl ? "החלפת תמונה" : "הוספת תמונה"}
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="absolute inset-0 flex items-end justify-center overflow-hidden rounded-xl disabled:cursor-default"
          >
            <span className="mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white">
              {busy ? <SpinnerIcon className="h-3.5 w-3.5 animate-spin" /> : <CameraIcon className="h-3.5 w-3.5" />}
            </span>
          </button>
          {photoUrl ? (
            <button
              type="button"
              aria-label="הסרת תמונה"
              title="הסרת תמונה"
              disabled={busy}
              onClick={() => setConfirmRemove(true)}
              className="absolute -top-1.5 -start-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-destructive text-destructive-foreground shadow-md disabled:opacity-60"
            >
              <CloseIcon className="h-3 w-3" />
            </button>
          ) : null}
        </>
      ) : null}

      {editable ? (
        <ConfirmDialog
          open={confirmRemove}
          onOpenChange={setConfirmRemove}
          title="הסרת תמונה"
          description="התמונה תוסר מהרכב."
          confirmLabel="הסרה"
          destructive
          onConfirm={confirmRemovePhoto}
        />
      ) : null}
    </div>
  );
}
