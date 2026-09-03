"use client";

/* eslint-disable @next/next/no-img-element */

// The "אספקה" card's own photo management — add / replace / delete, right on
// the order details page, independent of the אישור אספקה confirm flow (which
// still lets a driver attach proof AT confirmation time; this is for managing
// photos any time before or after that). Owns the whole SectionCard (icon,
// title, "X תמונות" badge + add trigger in the header, body) the way
// OrderRemindersSection owns תזכורות, so the live image count/grid can update
// without a full page reload.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AddIcon, DeliveryIcon } from "@/components/ui/icons";
import { DeleteButton, EditButton, IconButton } from "@/components/ui/icon-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { SectionCard } from "@/components/ui/section-card";
import OrderConfirmDialog from "@/app/(app)/sales/orders/OrderConfirmDialog";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { registerReversibleAction, scheduleDeferredDelete } from "@/lib/undo-engine";
import { offlineUpload } from "@/lib/offline-upload";
import { toHebrewError } from "@/lib/error-messages";
import { formatShortDate } from "@/lib/date";
import { getOrderStatusLabel } from "@/lib/ui/status-colors";

const FULL_SECONDARY_TRIGGER_CLASSES =
  "border-transparent bg-secondary text-secondary-foreground shadow-md shadow-secondary/20 hover:bg-secondary/90 hover:text-secondary-foreground w-full";

export type DeliveryImage = {
  id: string;
  file_name: string | null;
  uploaded_at: string | null;
  url: string | null;
};

const UNDO_SCOPE = "order-delivery-image";

async function deleteDocument(documentId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch("/api/documents/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ document_id: documentId }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: toHebrewError((json as { error?: string })?.error, "מחיקת התמונה נכשלה.") };
  return { ok: true };
}

export default function DeliveryImagesCard({
  orderId,
  images,
  deliveryConfirmedAt,
  needsDeliveryAction,
  orderStatus,
  authorName,
}: {
  orderId: string;
  images: DeliveryImage[];
  deliveryConfirmedAt: string | null;
  needsDeliveryAction: boolean;
  orderStatus: string;
  authorName: string | null;
}) {
  const router = useRouter();
  const visibleImages = useUndoOverlay(images, (image) => image.id, UNDO_SCOPE);

  // ── Add ──────────────────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [addFiles, setAddFiles] = useState<File[]>([]);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState("");

  function openAdd() {
    setAddFiles([]);
    setAddError("");
    setAddOpen(true);
  }

  async function submitAdd() {
    if (addBusy) return;
    if (addFiles.length === 0) {
      setAddError("יש לבחור תמונה להעלאה.");
      return;
    }
    setAddBusy(true);
    setAddError("");
    try {
      let uploaded = 0;
      let done = 0;
      const uploadedIds: string[] = [];
      for (const file of addFiles) {
        const result = await offlineUpload(`/api/orders/${orderId}/delivery-images`, {
          file,
          label: "תמונת אספקה",
        });
        if (result.queued) {
          done += 1;
        } else if (result.ok) {
          uploaded += 1;
          done += 1;
          const data = result.data as { image?: { id?: string } } | null;
          if (data?.image?.id) uploadedIds.push(data.image.id);
        } else {
          setAddError(result.error || `העלאת ${file.name} נכשלה.`);
          break;
        }
      }
      if (uploaded > 0) {
        router.refresh();
        const message = uploaded === 1 ? "התמונה נוספה" : `${uploaded} תמונות נוספו`;
        if (uploadedIds.length > 0) {
          registerReversibleAction({
            key: `${UNDO_SCOPE}:add:${orderId}:${uploadedIds.join(",")}`,
            message,
            onUndo: async () => {
              for (const id of uploadedIds) {
                const result = await deleteDocument(id);
                if (!result.ok) return result;
              }
              router.refresh();
              return { ok: true };
            },
          });
        } else {
          toast.success(message);
        }
      }
      if (done === addFiles.length) {
        setAddOpen(false);
      } else {
        setAddFiles(addFiles.slice(done));
      }
    } finally {
      setAddBusy(false);
    }
  }

  // ── Replace (edit) ──────────────────────────────────────────────────────
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<string | null>(null);

  function openReplace(imageId: string) {
    replaceTargetRef.current = imageId;
    replaceInputRef.current?.click();
  }

  async function handleReplaceFile(file: File) {
    const oldImageId = replaceTargetRef.current;
    if (!oldImageId) return;
    setReplacingId(oldImageId);
    try {
      const result = await offlineUpload(`/api/orders/${orderId}/delivery-images`, {
        file,
        label: "תמונת אספקה",
      });
      if (result.queued) {
        toast.info("התמונה החדשה תועלה כשהחיבור יחזור — אפשר יהיה למחוק את הישנה אז.");
        return;
      }
      if (!result.ok) {
        toast.error(result.error || "העלאת התמונה נכשלה.");
        return;
      }
      router.refresh();
      scheduleDeferredDelete({
        scope: UNDO_SCOPE,
        id: oldImageId,
        message: "התמונה הוחלפה",
        onCommit: () => deleteDocument(oldImageId),
      });
    } finally {
      setReplacingId(null);
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────
  const [deleteImageId, setDeleteImageId] = useState<string | null>(null);
  const [deleteImageName, setDeleteImageName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  function openDelete(image: DeliveryImage) {
    setDeleteImageId(image.id);
    setDeleteImageName(image.file_name ?? "תמונה");
    setDeleteOpen(true);
  }

  function confirmDelete() {
    if (!deleteImageId) return;
    const imageId = deleteImageId;
    setDeleteOpen(false);
    setDeleteImageId(null);
    setDeleteImageName("");
    scheduleDeferredDelete({
      scope: UNDO_SCOPE,
      id: imageId,
      message: "התמונה נמחקה",
      onCommit: () => deleteDocument(imageId),
    });
  }

  return (
    <SectionCard
      icon={<DeliveryIcon className="h-4 w-4" />}
      title="אספקה"
      aside={
        <div className="flex items-center gap-1.5">
          {visibleImages.length > 0 ? (
            <span className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-xs text-muted-foreground">
              {visibleImages.length} תמונות
            </span>
          ) : null}
          <IconButton icon={AddIcon} label="הוספת תמונת אספקה" onClick={openAdd} />
        </div>
      }
    >
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleReplaceFile(file);
        }}
      />

      {/* Never contradict the status card: an order marked סופק WAS delivered —
          it just has no confirmation date, because the status was set directly
          instead of through אישור אספקה. */}
      <div className="text-xs text-muted-foreground">
        {deliveryConfirmedAt
          ? `אספקה אושרה בתאריך ${formatShortDate(deliveryConfirmedAt)}`
          : needsDeliveryAction
            ? "האספקה טרם אושרה."
            : `ההזמנה מסומנת כ"${getOrderStatusLabel(orderStatus)}" — לא נרשם תאריך אספקה.`}
      </div>

      {visibleImages.length === 0 ? (
        <p className="text-xs text-muted-foreground">לא צורפו תמונות אספקה.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {visibleImages.map((image) => (
            <div key={image.id} className="overflow-hidden rounded-xl border border-border/70 bg-background/70">
              {image.url ? (
                <a href={image.url} target="_blank" rel="noreferrer" className="block">
                  <img
                    src={image.url}
                    alt={image.file_name ?? "Delivery image"}
                    className="h-28 w-full object-cover"
                  />
                </a>
              ) : null}
              <div className="flex items-center justify-between gap-1 px-2 py-1">
                <span className="text-[10px] text-muted-foreground">{formatShortDate(image.uploaded_at)}</span>
                <div className="flex shrink-0 gap-1">
                  <EditButton
                    label="החלפת תמונה"
                    size="sm"
                    loading={replacingId === image.id}
                    onClick={() => openReplace(image.id)}
                  />
                  <DeleteButton label="מחיקת תמונה" size="sm" onClick={() => openDelete(image)} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!needsDeliveryAction ? (
        <OrderConfirmDialog
          orderId={orderId}
          buttonLabel="אספקת הזמנה"
          buttonClassName={FULL_SECONDARY_TRIGGER_CLASSES}
          authorName={authorName}
        />
      ) : null}

      <FormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="הוספת תמונת אספקה"
        onSubmit={() => void submitAdd()}
        submitLabel="העלאה"
        busyLabel="מעלה..."
        busy={addBusy}
        error={addError || undefined}
      >
        <FileUploadActions
          files={addFiles}
          accept="image/*"
          multiple
          disabled={addBusy}
          onFilesSelected={setAddFiles}
          chooseLabel="בחר תמונות"
        />
      </FormDialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(nextOpen) => {
          setDeleteOpen(nextOpen);
          if (!nextOpen) {
            setDeleteImageId(null);
            setDeleteImageName("");
          }
        }}
        destructive
        title="מחיקת תמונה"
        description="פעולה זו תמחק את התמונה מהזמנה זו."
        confirmLabel="מחיקה"
        onConfirm={confirmDelete}
      >
        <p className="text-sm">
          למחוק את: <span className="font-medium">{deleteImageName || "תמונה"}</span> ?
        </p>
      </ConfirmDialog>
    </SectionCard>
  );
}
