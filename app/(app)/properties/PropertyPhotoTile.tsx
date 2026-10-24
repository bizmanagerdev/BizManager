"use client";

/* eslint-disable @next/next/no-img-element */

// A property's photo. On the list's card, just the picture (or the building
// in a dashed tile, the same size either way, so a photo arriving never moves
// anything). On the property's own page, a wide one at the foot of its card
// with the way to put one there (owner, 2026-10-22: "I want the photo upload
// available in the apartment not the outside … the camera blocks half the
// pic"): a small camera in its corner, or — none yet — the whole space is the
// button. It's filed on the property as a צילום, so it's in its page's photos
// too; only a צילום is ever its photo, never a receipt or a contract that
// happens to be an image. On the page it's a small picture BESIDE the card's
// details, not under them (owner, 2026-10-22: "toooo tall" — a wide one under
// them made the whole head row taller), as tall as the details beside it, the
// same size with a photo or without; one there can be taken off ("I need to be
// able to delete the image") — through the page's own delete, with its undo.

import { useRef, useState } from "react";
import { toast } from "sonner";
import { BuildingIcon, CameraIcon, CloseIcon, SpinnerIcon } from "@/components/ui/icons";
import { armNativeSurfaceGuard } from "@/components/ui/native-surface";
import { offlineUpload } from "@/lib/offline-upload";
import { sendChange } from "@/lib/offline-send";
import { registerReversibleAction } from "@/lib/undo-engine";
import { cn } from "@/lib/utils";
import { forgetPropertyPhotos } from "./propertyPhotos";

/** The list card's photo: read only. */
export function PropertyPhotoThumb({ url, name }: { url: string | null; name: string }) {
  return url ? (
    <img src={url} alt={name} className="h-14 w-14 shrink-0 rounded-xl border border-border/70 object-cover" />
  ) : (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/30 text-muted-foreground">
      <BuildingIcon className="h-5 w-5" />
    </div>
  );
}

/** The page's photo box: beside the details, as tall as they are, the same size with or without a photo. */
const PAGE_PHOTO = "min-h-20 w-24 shrink-0 self-stretch rounded-xl";

/** The property page's photo, with its add / replace. `ready` false: its files aren't in yet — a quiet block. */
export function PropertyPhotoBanner({
  propertyId,
  name,
  url,
  ready = true,
  onChanged,
  onDelete,
}: {
  propertyId: string;
  name: string;
  url: string | null;
  ready?: boolean;
  /** Added, or its adding undone: the page reads its photos again. */
  onChanged: () => void;
  /** Its ×: the page asks, then deletes the photo (with its undo). */
  onDelete?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // The one just added, shown from the file itself until the page has it.
  const [local, setLocal] = useState<string | null>(null);
  const [seen, setSeen] = useState(url);
  if (url !== seen) {
    // The page has its photos again: its own link from now on.
    setSeen(url);
    setLocal(null);
  }
  const shown = local ?? url;

  async function upload(file: File) {
    setBusy(true);
    try {
      const result = await offlineUpload("/api/documents/upload", {
        fields: { business_domain: "property_management", property_id: propertyId, category: "צילום" },
        file,
        label: `תמונת ${name}`,
      });
      if (result.queued) {
        toast.info("התמונה תועלה כשהחיבור יחזור.");
        return;
      }
      if (!result.ok) {
        toast.error(result.error || "העלאת התמונה נכשלה.");
        return;
      }
      setLocal(URL.createObjectURL(file));
      forgetPropertyPhotos();
      onChanged();
      const documentId = (result.data as { document?: { id?: string } } | null)?.document?.id;
      if (!documentId) return;
      registerReversibleAction({
        key: `property-photo:add:${documentId}`,
        message: "התמונה נשמרה",
        onUndo: async () => {
          const sent = await sendChange("/api/documents/delete", { document_id: documentId }, "מחיקת תמונה", "ביטול ההעלאה נכשל.");
          if (!sent.ok) return { ok: false, error: sent.error };
          setLocal(null);
          forgetPropertyPhotos();
          onChanged();
          return { ok: true };
        },
      });
    } finally {
      setBusy(false);
    }
  }

  function pick() {
    // The file chooser is an OS surface over the page — see components/ui/native-surface.ts.
    armNativeSurfaceGuard();
    inputRef.current?.click();
  }

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) void upload(file);
      }}
    />
  );

  if (!ready && !shown) return <div className={cn(PAGE_PHOTO, "bg-muted/30")} aria-hidden />;
  if (!shown) {
    return (
      <>
        {input}
        <button
          type="button"
          disabled={busy}
          onClick={pick}
          aria-label="הוספת תמונה של הנכס"
          className={cn(
            PAGE_PHOTO,
            "flex flex-col items-center justify-center gap-1 border border-dashed border-secondary/40 bg-secondary/5 text-xs font-medium text-secondary transition-colors hover:bg-secondary/10 disabled:cursor-default"
          )}
        >
          {busy ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : <CameraIcon className="h-4 w-4" />}
          תמונה
        </button>
      </>
    );
  }
  return (
    <div className={cn(PAGE_PHOTO, "relative")}>
      {input}
      <img src={shown} alt={name} className="h-full w-full rounded-xl border border-border/70 object-cover" />
      <button
        type="button"
        aria-label="החלפת תמונה"
        title="החלפת תמונה"
        disabled={busy}
        onClick={pick}
        className={cn(
          "absolute bottom-1.5 end-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white shadow-sm transition-colors hover:bg-black/75",
          "disabled:cursor-default"
        )}
      >
        {busy ? <SpinnerIcon className="h-3.5 w-3.5 animate-spin" /> : <CameraIcon className="h-3.5 w-3.5" />}
      </button>
      {onDelete && !local ? (
        <button
          type="button"
          aria-label="מחיקת התמונה"
          title="מחיקת התמונה"
          disabled={busy}
          onClick={() => {
            forgetPropertyPhotos();
            onDelete();
          }}
          className="absolute end-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white shadow-sm transition-colors hover:bg-destructive disabled:cursor-default"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
