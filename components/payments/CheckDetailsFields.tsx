"use client";

import { Input } from "@/components/ui/input";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { Button } from "@/components/ui/button";

type CheckDetailsFieldsProps = {
  checkNumber: string;
  onCheckNumberChange: (value: string) => void;
  photoFiles: File[];
  onPhotoFilesChange: (files: File[]) => void;
  disabled?: boolean;
  layout?: "stacked" | "grid";
};

export function CheckDetailsFields({
  checkNumber,
  onCheckNumberChange,
  photoFiles,
  onPhotoFilesChange,
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
          <FileUploadActions
            files={photoFiles}
            onFilesSelected={onPhotoFilesChange}
            accept="image/*"
            chooseLabel="העלאת צילום"
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
        {photoFiles.length > 0 ? (
          <div className="text-xs text-muted-foreground">
            {photoFiles.map((file) => file.name).join(", ")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
