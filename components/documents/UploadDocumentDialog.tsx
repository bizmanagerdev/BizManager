"use client";

// "העלאת מסמך" — the ONE upload form. Lifted out of DocumentsArchiveClient so the
// archive page and the top-bar + menu share it: same domains, same categories,
// same project/property linking, same offline-queued upload. Changing the form
// once changes it in both places.
//
// Owns its own state; the caller supplies the target lists and (optionally) the
// defaults its own context implies — the archive page seeds them from its active
// filters so uploading from a filtered view lands the file where you're looking.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AdaptiveDialog } from "@/components/layout/page-layout";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { ProjectPicker } from "@/components/projects/ProjectPicker";
import { TagPicker } from "@/components/tags/TagPicker";
import { DomainSelect } from "@/components/financial/DomainSelect";
import { DOCUMENT_CATEGORIES, inferDefaultDocumentCategory } from "@/lib/documents";
import { EXPENSE_BUSINESS_DOMAINS } from "@/lib/expenses";
import { offlineUpload } from "@/lib/offline-upload";
import { toHebrewError } from "@/lib/error-messages";

export type UploadTargetOption = { id: string; label: string };

const fieldClass =
  "h-11 w-full rounded-xl border border-input bg-background/80 px-4 py-2 text-sm shadow-sm outline-none transition-all focus:border-destructive/40 focus:ring-2 focus:ring-ring";

function normalizeDomain(value: string | undefined) {
  return value && (EXPENSE_BUSINESS_DOMAINS as readonly string[]).includes(value)
    ? value
    : "logistics_projects";
}

export function UploadDocumentDialog({
  open,
  onOpenChange,
  projects,
  properties,
  defaultDomain,
  defaultProjectId = "",
  defaultPropertyId = "",
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: UploadTargetOption[];
  properties: UploadTargetOption[];
  /** Seeds the domain when the caller has one in context (e.g. the archive filter). */
  defaultDomain?: string;
  defaultProjectId?: string;
  defaultPropertyId?: string;
  onUploaded?: () => void;
}) {
  const [businessDomain, setBusinessDomain] = useState(() => normalizeDomain(defaultDomain));
  const [category, setCategory] = useState("");
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [propertyId, setPropertyId] = useState(defaultPropertyId);
  const [files, setFiles] = useState<File[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [refYear, setRefYear] = useState("");
  const [uploading, setUploading] = useState(false);

  const needsProject = businessDomain === "logistics_projects";
  const needsProperty = businessDomain === "property_management";

  // Re-seed from the caller's context each time the dialog opens (the archive's
  // filters may have changed since the last upload).
  useEffect(() => {
    if (!open) return;
    setBusinessDomain(normalizeDomain(defaultDomain));
    setProjectId(defaultProjectId);
    setPropertyId(defaultPropertyId);
  }, [open, defaultDomain, defaultProjectId, defaultPropertyId]);

  // A target that doesn't apply to the chosen domain must not ride along on the upload.
  useEffect(() => {
    if (!needsProject && projectId) setProjectId("");
    if (!needsProperty && propertyId) setPropertyId("");
  }, [needsProject, needsProperty, projectId, propertyId]);

  function reset() {
    setBusinessDomain(normalizeDomain(defaultDomain));
    setCategory("");
    setProjectId(defaultProjectId);
    setPropertyId(defaultPropertyId);
    setFiles([]);
    setTagIds([]);
    setRefYear("");
  }

  async function startUpload() {
    if (uploading || files.length === 0) return;
    if (needsProject && !projectId.trim()) {
      toast.error("יש לבחור פרויקט");
      return;
    }
    if (needsProperty && !propertyId.trim()) {
      toast.error("יש לבחור נכס");
      return;
    }

    setUploading(true);
    const toastId = toast.loading("מעלה קבצים...");
    try {
      // uploaded = genuinely sent this session; queued = saved on the device for
      // replay when the connection returns (ConnectionToasts announces it).
      let uploaded = 0;
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i]!;
        const fields: Record<string, string> = { business_domain: businessDomain };
        if (needsProject) fields.project_id = projectId.trim();
        if (needsProperty) fields.property_id = propertyId.trim();
        if (category.trim()) fields.category = category.trim();
        if (tagIds.length > 0) fields.tag_ids = JSON.stringify(tagIds);
        if (refYear.trim()) fields.ref_year = refYear.trim();

        toast.loading(`מעלה קבצים... (${i + 1}/${files.length})`, { id: toastId });

        const result = await offlineUpload("/api/documents/upload", { fields, file, label: file.name });
        if (result.queued) {
          // Saved on device — treat as done, don't count as an upload.
        } else if (result.ok) {
          uploaded += 1;
        } else {
          toast.error("שגיאה בהעלאת קובץ", { id: toastId, description: result.error });
          return;
        }
      }

      if (uploaded > 0) {
        toast.success("הקבצים הועלו", { id: toastId });
      } else {
        // Everything was queued — the global connection toast covers it.
        toast.dismiss(toastId);
      }
      onOpenChange(false);
      reset();
      onUploaded?.();
    } catch (error: unknown) {
      toast.error("שגיאה בהעלאת קובץ", { id: toastId, description: toHebrewError(error) });
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && uploading) return;
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <AdaptiveDialog size="formMd">
        <DialogHeader>
          <DialogTitle>העלאת קבצים</DialogTitle>
          <DialogDescription>בחירת קבצים להוספה לארכיון המסמכים המרכזי.</DialogDescription>
        </DialogHeader>

        <fieldset disabled={uploading} className="contents">
          <div className="mt-4 space-y-4">
            <div className="space-y-1">
              <div className="text-sm font-medium">תחום</div>
              <DomainSelect
                value={businessDomain}
                onChange={(value) => {
                  setBusinessDomain(value);
                  if (value !== "general_business") {
                    setTagIds([]);
                    setRefYear("");
                  }
                }}
                ariaLabel="תחום למסמך חדש"
              />
            </div>

            {needsProject ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">פרויקט</div>
                <ProjectPicker
                  value={projectId}
                  onChange={setProjectId}
                  allowClear={false}
                  placeholder="בחר פרויקט"
                  searchPlaceholder="חיפוש פרויקט..."
                  projects={projects}
                />
                {!projectId.trim() ? (
                  <div className="text-xs text-destructive">יש לבחור פרויקט לקישור הקבצים</div>
                ) : null}
              </div>
            ) : null}

            {needsProperty ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">נכס</div>
                <SearchableSelect
                  value={propertyId}
                  onChange={setPropertyId}
                  ariaLabel="בחירת נכס"
                  placeholder="בחר נכס"
                  searchPlaceholder="חיפוש נכס..."
                  options={properties.map((option) => ({ value: option.id, label: option.label }))}
                />
                {!propertyId.trim() ? (
                  <div className="text-xs text-destructive">יש לבחור נכס לקישור הקבצים</div>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-1">
              <div className="text-sm font-medium">קטגוריה</div>
              <select
                className={fieldClass}
                aria-label="קטגוריית מסמך"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">ללא קטגוריה</option>
                {DOCUMENT_CATEGORIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            {businessDomain === "general_business" ? <TagPicker value={tagIds} onChange={setTagIds} /> : null}

            {businessDomain === "general_business" && tagIds.length > 0 ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">שנת המסמך (לחיפוש לפי שנה)</div>
                <Input inputMode="numeric" value={refYear} onChange={(event) => setRefYear(event.target.value)} />
              </div>
            ) : null}

            <div className="space-y-1">
              <div className="text-sm font-medium">קבצים</div>
              <div className="flex items-center justify-between gap-2">
                <FileUploadActions
                  files={files}
                  multiple
                  onFilesSelected={(next) => {
                    setFiles(next);
                    if (next.length > 0 && !category) {
                      setCategory(inferDefaultDocumentCategory(next[0]?.name));
                    }
                  }}
                  chooseLabel="בחר קבצים"
                />
                <div className="text-xs text-muted-foreground">{files.length} קבצים</div>
              </div>
              {files.length > 0 ? (
                <div className="truncate text-xs text-muted-foreground">
                  {files.slice(0, 3).map((file) => file.name).join(", ")}
                  {files.length > 3 ? ` +${files.length - 3}` : ""}
                </div>
              ) : (
                <div className="text-xs text-destructive">בחר לפחות קובץ אחד</div>
              )}
            </div>
          </div>
        </fieldset>

        <DialogFooter className="mt-6">
          <Button type="button" variant="secondary" disabled={uploading} onClick={() => onOpenChange(false)}>
            ביטול
          </Button>
          <Button
            type="button"
            disabled={
              uploading ||
              files.length === 0 ||
              (needsProject && !projectId.trim()) ||
              (needsProperty && !propertyId.trim())
            }
            onClick={() => void startUpload()}
          >
            {uploading ? "מעלה..." : "העלאה"}
          </Button>
        </DialogFooter>
      </AdaptiveDialog>
    </Dialog>
  );
}

export default UploadDocumentDialog;
