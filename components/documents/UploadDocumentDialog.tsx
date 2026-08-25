"use client";

// "העלאת קבצים" — the ONE upload form. Lifted out of DocumentsArchiveClient so the
// archive page and the top-bar + menu share it: same domains, same categories,
// same project/property linking, same offline-queued upload. Changing the form
// once changes it in both places.
//
// Owns its own state; the caller supplies the target lists and (optionally) the
// defaults its own context implies — the archive page seeds them from its active
// filters so uploading from a filtered view lands the file where you're looking.
//
// Rebuilt 2026-08-25 onto the same atomic step-wizard architecture as
// IncomeDialog/CollectPaymentDialog/ExpenseDialog (one question per screen,
// tap-a-card-to-advance) instead of a single-page FormDialog — part of
// converging every quick-action dialog onto one shared shape.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { StepWizardDialog, useStepFlow } from "@/components/ui/step-wizard";
import { OptionRow, StepHeading } from "@/components/ui/option-row";
import { SummaryRow, SummarySection } from "@/components/ui/summary";
import { Input } from "@/components/ui/input";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { TagPicker } from "@/components/tags/TagPicker";
import { getBusinessDomainIcon } from "@/components/financial/DomainSelect";
import { DOCUMENT_CATEGORIES, inferDefaultDocumentCategory } from "@/lib/documents";
import { EXPENSE_BUSINESS_DOMAINS, getBusinessDomainLabel } from "@/lib/expenses";
import { offlineUpload } from "@/lib/offline-upload";
import { toHebrewError } from "@/lib/error-messages";

export type UploadTargetOption = { id: string; label: string };

type UploadStepId = "domain" | "project" | "property" | "category" | "tags" | "refYear" | "files" | "summary";

const STEP_LABEL: Record<UploadStepId, string> = {
  domain: "תחום",
  project: "פרויקט",
  property: "נכס",
  category: "קטגוריה",
  tags: "תגיות",
  refYear: "שנה",
  files: "קבצים",
  summary: "סיכום",
};

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
  const [stepId, setStepId] = useState<UploadStepId>("domain");
  const [businessDomain, setBusinessDomain] = useState(() => normalizeDomain(defaultDomain));
  const [category, setCategory] = useState("");
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [projectQuery, setProjectQuery] = useState("");
  const [propertyId, setPropertyId] = useState(defaultPropertyId);
  const [propertyQuery, setPropertyQuery] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [refYear, setRefYear] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsProject = businessDomain === "logistics_projects";
  const needsProperty = businessDomain === "property_management";

  // Re-seed from the caller's context each time the dialog opens (the archive's
  // filters may have changed since the last upload).
  useEffect(() => {
    if (!open) return;
    setStepId("domain");
    setBusinessDomain(normalizeDomain(defaultDomain));
    setProjectId(defaultProjectId);
    setPropertyId(defaultPropertyId);
    setError(null);
  }, [open, defaultDomain, defaultProjectId, defaultPropertyId]);

  // A target that doesn't apply to the chosen domain must not ride along on the upload.
  useEffect(() => {
    if (!needsProject && projectId) setProjectId("");
    if (!needsProperty && propertyId) setPropertyId("");
  }, [needsProject, needsProperty, projectId, propertyId]);

  const stepIds = useMemo<UploadStepId[]>(() => {
    const ids: UploadStepId[] = ["domain"];
    if (needsProject) ids.push("project");
    if (needsProperty) ids.push("property");
    ids.push("category");
    if (businessDomain === "general_business") {
      ids.push("tags");
      if (tagIds.length > 0) ids.push("refYear");
    }
    ids.push("files", "summary");
    return ids;
  }, [needsProject, needsProperty, businessDomain, tagIds.length]);
  const wizardSteps = useMemo(() => stepIds.map((id) => ({ n: id, label: STEP_LABEL[id] })), [stepIds]);

  const filteredProjects = useMemo(() => {
    const q = projectQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.label.toLowerCase().includes(q));
  }, [projectQuery, projects]);
  const filteredProperties = useMemo(() => {
    const q = propertyQuery.trim().toLowerCase();
    if (!q) return properties;
    return properties.filter((p) => p.label.toLowerCase().includes(q));
  }, [propertyQuery, properties]);

  function isSatisfied(id: UploadStepId): boolean {
    switch (id) {
      case "project":
        return Boolean(projectId.trim());
      case "property":
        return Boolean(propertyId.trim());
      case "files":
        return files.length > 0;
      case "domain":
      case "category":
      case "tags":
      case "refYear":
      case "summary":
        return true;
    }
  }

  const { stepIndex, isLastStep, canClickStep, goToStep, goBack, goNext, advanceTo } = useStepFlow<UploadStepId>({
    stepId,
    setStepId,
    steps: stepIds,
    isSatisfied,
  });

  function pickDomain(domain: string) {
    setBusinessDomain(domain);
    if (domain !== "logistics_projects") setProjectId("");
    if (domain !== "property_management") setPropertyId("");
    if (domain !== "general_business") {
      setTagIds([]);
      setRefYear("");
    }
    advanceTo(
      domain === "logistics_projects" ? "project" : domain === "property_management" ? "property" : "category"
    );
  }

  function pickCategory(next: string) {
    setCategory(next);
    advanceTo(businessDomain === "general_business" ? "tags" : "files");
  }

  function reset() {
    setStepId("domain");
    setBusinessDomain(normalizeDomain(defaultDomain));
    setCategory("");
    setProjectId(defaultProjectId);
    setProjectQuery("");
    setPropertyId(defaultPropertyId);
    setPropertyQuery("");
    setFiles([]);
    setTagIds([]);
    setRefYear("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next && uploading) return;
    onOpenChange(next);
    if (!next) reset();
  }

  async function startUpload() {
    if (uploading || files.length === 0) return;
    setError(null);
    if (needsProject && !projectId.trim()) {
      setError("יש לבחור פרויקט");
      return;
    }
    if (needsProperty && !propertyId.trim()) {
      setError("יש לבחור נכס");
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
      handleOpenChange(false);
      onUploaded?.();
    } catch (err: unknown) {
      toast.error("שגיאה בהעלאת קובץ", { id: toastId, description: toHebrewError(err) });
    } finally {
      setUploading(false);
    }
  }

  const projectName = projects.find((p) => p.id === projectId)?.label;
  const propertyName = properties.find((p) => p.id === propertyId)?.label;

  return (
    <StepWizardDialog
      open={open}
      onOpenChange={handleOpenChange}
      dialogTitle="העלאת קבצים"
      dialogDescription="העלאת מסמך לארכיון"
      size="formMd"
      fullScreen
      progressVariant="bar"
      steps={wizardSteps}
      current={stepId}
      canClickStep={canClickStep}
      onStepClick={goToStep}
      closeDisabled={uploading}
      onBack={stepIndex(stepId) > 0 ? goBack : undefined}
      backDisabled={uploading}
      onNext={() => (isLastStep ? void startUpload() : goNext())}
      nextLabel={isLastStep ? (uploading ? "מעלה..." : "העלאה") : undefined}
      nextDisabled={isLastStep ? uploading : !isSatisfied(stepId)}
      isLastStep={isLastStep}
      submitOnEnter
      error={error || undefined}
    >
      {stepId === "domain" ? (
        <>
          <StepHeading title="לאיזה תחום שייך המסמך?" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {EXPENSE_BUSINESS_DOMAINS.map((domain) => (
              <OptionRow
                key={domain}
                icon={getBusinessDomainIcon(domain) ?? undefined}
                label={getBusinessDomainLabel(domain)}
                selected={businessDomain === domain}
                onClick={() => pickDomain(domain)}
              />
            ))}
          </div>
        </>
      ) : stepId === "project" ? (
        <>
          <StepHeading title="לאיזה פרויקט לשייך?" />
          <div className="grid gap-3">
            <Input value={projectQuery} onChange={(e) => setProjectQuery(e.target.value)} placeholder="חיפוש פרויקט..." />
            <div className="space-y-1">
              {filteredProjects.map((project) => (
                <OptionRow
                  key={project.id}
                  label={project.label}
                  selected={projectId === project.id}
                  onClick={() => {
                    setProjectId(project.id);
                    advanceTo("category");
                  }}
                />
              ))}
            </div>
          </div>
        </>
      ) : stepId === "property" ? (
        <>
          <StepHeading title="לאיזה נכס לשייך?" />
          <div className="grid gap-3">
            <Input value={propertyQuery} onChange={(e) => setPropertyQuery(e.target.value)} placeholder="חיפוש נכס..." />
            <div className="space-y-1">
              {filteredProperties.map((property) => (
                <OptionRow
                  key={property.id}
                  label={property.label}
                  selected={propertyId === property.id}
                  onClick={() => {
                    setPropertyId(property.id);
                    advanceTo("category");
                  }}
                />
              ))}
            </div>
          </div>
        </>
      ) : stepId === "category" ? (
        <>
          <StepHeading title="איזו קטגוריה?" sub="לא חובה" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <OptionRow label="ללא קטגוריה" selected={category === ""} onClick={() => pickCategory("")} />
            {DOCUMENT_CATEGORIES.map((option) => (
              <OptionRow
                key={option}
                label={option}
                selected={category === option}
                onClick={() => pickCategory(option)}
              />
            ))}
          </div>
        </>
      ) : stepId === "tags" ? (
        <>
          <StepHeading title="לשייך תגיות?" sub="לא חובה" />
          <TagPicker value={tagIds} onChange={setTagIds} />
        </>
      ) : stepId === "refYear" ? (
        <>
          <StepHeading title="שנת המסמך?" sub="לחיפוש לפי שנה — לא חובה" />
          <label className="space-y-2 text-sm">
            <Input inputMode="numeric" autoFocus value={refYear} onChange={(e) => setRefYear(e.target.value)} />
          </label>
        </>
      ) : stepId === "files" ? (
        <>
          <StepHeading title="אילו קבצים להעלות?" />
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <FileUploadActions
                files={files}
                multiple
                onFilesSelected={(next) => {
                  setFiles(next);
                  if (next.length > 0 && !category) setCategory(inferDefaultDocumentCategory(next[0]?.name));
                }}
                chooseLabel="בחר קבצים"
              />
              <div className="text-xs text-muted-foreground">{files.length} קבצים</div>
            </div>
            {files.length > 0 ? (
              <div className="break-words text-xs text-muted-foreground">
                {files.map((file) => file.name).join(", ")}
              </div>
            ) : (
              <div className="text-xs text-destructive">בחר לפחות קובץ אחד</div>
            )}
          </div>
        </>
      ) : (
        <>
          <StepHeading title="לאשר ולהעלות?" />
          <SummarySection title="פרטי ההעלאה">
            <SummaryRow label="תחום" value={getBusinessDomainLabel(businessDomain)} />
            {needsProject ? <SummaryRow label="פרויקט" value={projectName ?? "—"} /> : null}
            {needsProperty ? <SummaryRow label="נכס" value={propertyName ?? "—"} /> : null}
            <SummaryRow label="קטגוריה" value={category || "ללא קטגוריה"} />
            {refYear.trim() ? <SummaryRow label="שנה" value={refYear} /> : null}
            {tagIds.length > 0 ? <SummaryRow label="תגיות" value={tagIds.length} /> : null}
            <SummaryRow label="קבצים" value={files.length} />
          </SummarySection>
        </>
      )}
    </StepWizardDialog>
  );
}

export default UploadDocumentDialog;
