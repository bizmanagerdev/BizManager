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
import { offerVehicleDateSync } from "@/lib/documents/vehicleDateSync";
import { StepWizardDialog, useStepFlow } from "@/components/ui/step-wizard";
import { OptionRow, StepHeading } from "@/components/ui/option-row";
import { SummaryRow, SummarySection } from "@/components/ui/summary";
import { Input } from "@/components/ui/input";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { TagPicker } from "@/components/tags/TagPicker";
import { getBusinessDomainIcon } from "@/components/financial/DomainSelect";
import { inferDefaultDocumentCategory } from "@/lib/documents";
import {
  fetchDocumentCategories,
  selectableCategories,
  type DocumentCategoryRow,
} from "@/lib/documents/categories";
import { DateInput } from "@/components/ui/date-input";
import { EXPENSE_BUSINESS_DOMAINS, getBusinessDomainLabel } from "@/lib/expenses";
import { offlineUpload } from "@/lib/offline-upload";
import { toHebrewError } from "@/lib/error-messages";

export type UploadTargetOption = { id: string; label: string };

type UploadStepId =
  | "domain"
  | "project"
  | "property"
  | "customer"
  | "category"
  | "expiry"
  | "tags"
  | "refYear"
  | "files"
  | "summary";

const STEP_LABEL: Record<UploadStepId, string> = {
  domain: "תחום",
  project: "פרויקט",
  property: "נכס",
  customer: "לקוח",
  category: "קטגוריה",
  expiry: "תוקף",
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
  customers = [],
  defaultDomain,
  defaultProjectId = "",
  defaultPropertyId = "",
  defaultCustomerId = "",
  defaultCategory = "",
  initialFiles,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: UploadTargetOption[];
  properties: UploadTargetOption[];
  /** Offered as the target for domains that have no project/property of their own. */
  customers?: UploadTargetOption[];
  /** Seeds the domain when the caller has one in context (e.g. the archive filter). */
  defaultDomain?: string;
  defaultProjectId?: string;
  defaultPropertyId?: string;
  /** Seeded when the caller already knows who the files belong to — dropping a
   *  photo onto a customer's tray in the archive answers that question before
   *  the dialog asks it. */
  defaultCustomerId?: string;
  defaultCategory?: string;
  /** Files already chosen by the caller — dropping onto the page opens this
   *  dialog with them loaded, so the drop still gets a domain and a category
   *  instead of silently filing everything under שוטף. */
  initialFiles?: File[];
  onUploaded?: () => void;
}) {
  const [stepId, setStepId] = useState<UploadStepId>("domain");
  const [businessDomain, setBusinessDomain] = useState(() => normalizeDomain(defaultDomain));
  const [category, setCategory] = useState(defaultCategory);
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [projectQuery, setProjectQuery] = useState("");
  const [propertyId, setPropertyId] = useState(defaultPropertyId);
  const [propertyQuery, setPropertyQuery] = useState("");
  const [customerId, setCustomerId] = useState(defaultCustomerId);
  const [customerQuery, setCustomerQuery] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [validUntil, setValidUntil] = useState("");
  // Only offered for a single file — naming ten at once is a rename screen, not
  // an upload. Everything else keeps the filename, which the archive already
  // renders as "<category> · <entity>" rather than raw.
  const [title, setTitle] = useState("");
  // The registry decides what is offered AND which categories need an expiry
  // date, so an admin turning "מעקב תוקף" on immediately changes this form.
  const [categoryRows, setCategoryRows] = useState<DocumentCategoryRow[]>([]);
  const [refYear, setRefYear] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchDocumentCategories()
      .then((rows) => {
        if (!cancelled) setCategoryRows(rows);
      })
      .catch(() => setCategoryRows([]));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const categoryOptions = useMemo(() => selectableCategories(categoryRows), [categoryRows]);
  const tracksExpiry = useMemo(
    () => categoryOptions.some((c) => c.code === category && c.tracks_expiry),
    [categoryOptions, category]
  );

  const needsProject = businessDomain === "logistics_projects";
  const needsProperty = businessDomain === "property_management";
  // Only פרויקטים and ניהול נכסים ever asked for a target, so anything filed
  // under מכירות / שוטף / בית / צדקה arrived with no link AT ALL — that is
  // where most of the "ללא שיוך" pile comes from. Offer a customer instead of
  // silently producing an orphan. Optional: some files genuinely belong to
  // nobody.
  const offersCustomer = !needsProject && !needsProperty && customers.length > 0;

  const suggestedTitle = useMemo(() => {
    const categoryLabel = categoryOptions.find((c) => c.code === category)?.label ?? "";
    const target =
      (needsProject ? projects.find((p) => p.id === projectId)?.label : null) ??
      (needsProperty ? properties.find((p) => p.id === propertyId)?.label : null) ??
      "";
    if (categoryLabel && target) return `${categoryLabel} · ${target}`;
    return categoryLabel || target || "";
  }, [categoryOptions, category, needsProject, needsProperty, projects, projectId, properties, propertyId]);

  // Re-seed from the caller's context each time the dialog opens (the archive's
  // filters may have changed since the last upload).
  useEffect(() => {
    if (!open) return;
    setStepId("domain");
    setBusinessDomain(normalizeDomain(defaultDomain));
    setProjectId(defaultProjectId);
    setPropertyId(defaultPropertyId);
    setCustomerId(defaultCustomerId);
    setCategory(defaultCategory);
    setError(null);
    if (initialFiles && initialFiles.length > 0) setFiles(initialFiles);
  }, [
    open,
    defaultDomain,
    defaultProjectId,
    defaultPropertyId,
    defaultCustomerId,
    defaultCategory,
    initialFiles,
  ]);

  // A target that doesn't apply to the chosen domain must not ride along on the upload.
  useEffect(() => {
    if (!needsProject && projectId) setProjectId("");
    if (!needsProperty && propertyId) setPropertyId("");
  }, [needsProject, needsProperty, projectId, propertyId]);

  const stepIds = useMemo<UploadStepId[]>(() => {
    const ids: UploadStepId[] = ["domain"];
    if (needsProject) ids.push("project");
    if (needsProperty) ids.push("property");
    if (offersCustomer) ids.push("customer");
    ids.push("category");
    if (tracksExpiry) ids.push("expiry");
    if (businessDomain === "general_business") {
      ids.push("tags");
      if (tagIds.length > 0) ids.push("refYear");
    }
    ids.push("files", "summary");
    return ids;
  }, [needsProject, needsProperty, offersCustomer, businessDomain, tagIds.length, tracksExpiry]);
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
      case "customer":
      case "expiry":
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
    const expires = categoryOptions.some((c) => c.code === next && c.tracks_expiry);
    if (!expires) setValidUntil("");
    advanceTo(expires ? "expiry" : businessDomain === "general_business" ? "tags" : "files");
  }

  function reset() {
    setStepId("domain");
    setBusinessDomain(normalizeDomain(defaultDomain));
    setCategory("");
    setProjectId(defaultProjectId);
    setProjectQuery("");
    setPropertyId(defaultPropertyId);
    setPropertyQuery("");
    setCustomerId("");
    setCustomerQuery("");
    setFiles([]);
    setTagIds([]);
    setRefYear("");
    setValidUntil("");
    setTitle("");
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
        if (offersCustomer && customerId.trim()) fields.customer_id = customerId.trim();
        if (category.trim()) fields.category = category.trim();
        if (tagIds.length > 0) fields.tag_ids = JSON.stringify(tagIds);
        if (refYear.trim()) fields.ref_year = refYear.trim();
        if (validUntil.trim()) fields.valid_until = validUntil.trim();
        if (files.length === 1 && title.trim()) fields.title = title.trim();

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

      // A policy filed against a car carries the car's own renewal date. Ask
      // once, here, rather than letting the two drift apart — the same offer
      // the archive makes when the date is edited later.
      if (uploaded > 0 && validUntil.trim() && tagIds.length > 0) {
        for (const tagId of tagIds) {
          void offerVehicleDateSync({
            category: category.trim() || null,
            vehicleTagId: tagId,
            date: validUntil.trim(),
            onUpdated: onUploaded,
          });
        }
      }
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
      ) : stepId === "customer" ? (
        <>
          <StepHeading title="לאיזה לקוח?" sub="לא חובה — אפשר לדלג" />
          <Input
            value={customerQuery}
            onChange={(event) => setCustomerQuery(event.target.value)}
            placeholder="חיפוש לקוח"
            className="mb-2"
          />
          <div className="grid grid-cols-1 gap-2">
            <OptionRow
              label="ללא לקוח"
              selected={customerId === ""}
              onClick={() => {
                setCustomerId("");
                advanceTo("category");
              }}
            />
            {customers
              .filter((customer) =>
                customerQuery.trim()
                  ? customer.label.toLowerCase().includes(customerQuery.trim().toLowerCase())
                  : true
              )
              .slice(0, 30)
              .map((customer) => (
                <OptionRow
                  key={customer.id}
                  label={customer.label}
                  selected={customerId === customer.id}
                  onClick={() => {
                    setCustomerId(customer.id);
                    advanceTo("category");
                  }}
                />
              ))}
          </div>
        </>
      ) : stepId === "category" ? (
        <>
          <StepHeading title="איזו קטגוריה?" sub="לא חובה" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <OptionRow label="ללא קטגוריה" selected={category === ""} onClick={() => pickCategory("")} />
            {categoryOptions.map((option) => (
              <OptionRow
                key={option.code}
                label={option.label}
                selected={category === option.code}
                onClick={() => pickCategory(option.code)}
              />
            ))}
          </div>
        </>
      ) : stepId === "expiry" ? (
        <>
          <StepHeading title="עד מתי המסמך בתוקף?" sub="נקבל התראה לפני שהתוקף פג — לא חובה" />
          <label className="space-y-2 text-sm">
            <DateInput autoFocus value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </label>
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
            {tracksExpiry ? <SummaryRow label="בתוקף עד" value={validUntil || "—"} /> : null}
            {files.length === 1 ? (
              <label className="block space-y-1 py-2 text-sm">
                <span className="font-medium">שם המסמך</span>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={suggestedTitle || files[0]?.name || "שם המסמך"}
                />
                <span className="block text-xs text-muted-foreground">
                  לא חובה — בלי שם נשתמש בשם הקובץ.
                </span>
              </label>
            ) : null}
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
