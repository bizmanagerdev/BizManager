"use client";

import { Input } from "@/components/ui/input";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { Button } from "@/components/ui/button";
import { DocumentLink } from "@/components/ui/document-tile";

type CheckDetailsFieldsProps = {
  checkNumber: string;
  onCheckNumberChange: (value: string) => void;
  photoFiles: File[];
  onPhotoFilesChange: (files: File[]) => void;
  /** The photos the check already has (signed links) — shown before the
   *  upload buttons, so editing a check shows what's on file. */
  existingPhotoUrls?: string[];
  disabled?: boolean;
  layout?: "stacked" | "grid";
};

export function CheckDetailsFields({
  checkNumber,
  onCheckNumberChange,
  photoFiles,
  onPhotoFilesChange,
  existingPhotoUrls = [],
  disabled = false,
  layout = "grid",
}: CheckDetailsFieldsProps) {
  return (
    <div className={layout === "grid" ? "grid gap-3 sm:grid-cols-2" : "space-y-3"}>
      <div className="space-y-1">
        <label className="text-sm font-medium">מספר צ&apos;ק</label>
        <Input
          value={checkNumber}
          onChange={(event) => onCheckNumberChange(event.target.value)}
          placeholder="לדוגמה 123456"
          inputMode="numeric"
          disabled={disabled}
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium">צילום צ&apos;ק</label>
        <div className="flex flex-wrap items-center gap-2">
          {/* Each opens as it did; הורדה follows it on hover (owner, 2026-10-12). */}
          {existingPhotoUrls.map((url, index) => (
            <DocumentLink
              key={url}
              name={existingPhotoUrls.length > 1 ? `צילום הצ׳ק ${index + 1}` : "צילום הצ׳ק"}
              url={url}
              title="צילום הצ׳ק"
              className="block shrink-0 overflow-hidden rounded-md border border-border/70"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a signed storage link, not a static asset */}
              <img src={url} alt={existingPhotoUrls.length > 1 ? `צילום הצ׳ק ${index + 1}` : "צילום הצ׳ק"} className="h-12 w-16 object-cover" />
            </DocumentLink>
          ))}
          <FileUploadActions
            files={photoFiles}
            onFilesSelected={onPhotoFilesChange}
            accept="image/*,application/pdf"
            chooseLabel="העלאת קובץ"
            takePhotoLabel="צילום"
            chooseVariant="outline"
            size="sm"
            disabled={disabled}
          />
          {photoFiles.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => onPhotoFilesChange([])}
            >
              ניקוי
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
