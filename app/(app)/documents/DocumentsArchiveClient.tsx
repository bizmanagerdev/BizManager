"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DeleteIcon, DocumentIcon, ExternalLinkIcon, FolderIcon, ImageIcon, LayersIcon, ProductIcon, SearchIcon, TagIcon, UploadIcon } from "@/components/ui/icons";
import { toast } from "sonner";
import { AdaptiveGrid } from "@/components/layout/page-layout";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import { ViewDialog } from "@/components/ui/view-dialog";
import { toHebrewError } from "@/lib/error-messages";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CustomerPicker } from "@/components/customers/CustomerPicker";
import { ProjectPicker } from "@/components/projects/ProjectPicker";
import { formatShortDateTime } from "@/lib/date";
import { getBusinessDomainLabel } from "@/lib/expenses";
import { DomainSelect } from "@/components/financial/DomainSelect";
import { UploadDocumentDialog } from "@/components/documents/UploadDocumentDialog";
import { DOCUMENT_CATEGORIES, getDocumentCategoryLabel } from "@/lib/documents";

export type DocumentArchiveFilters = {
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  customer_page: string;
  project_id: string;
  property_id: string;
  business_domain: string;
  entity_type: string;
  type: string;
  q: string;
};

export type ArchiveRelation = {
  id: string;
  label: string;
};

export type ArchiveTargetOption = {
  id: string;
  label: string;
};

export type ArchiveLinkedEntity = {
  type: string;
  id: string;
  label: string;
  href: string | null;
};

export type DocumentArchiveItem = {
  id: string;
  title: string;
  file_name: string | null;
  document_type: string | null;
  file_kind: string;
  storage_key: string | null;
  uploaded_at: string | null;
  created_at: string | null;
  uploaded_by_name: string | null;
  url: string | null;
  entity_types: string[];
  linked_entities: ArchiveLinkedEntity[];
  customers: ArchiveRelation[];
  projects: ArchiveRelation[];
  properties: ArchiveRelation[];
  tasks: ArchiveRelation[];
  orders: ArchiveRelation[];
  business_domains: string[];
  ref_year: number | null;
  tags: ArchiveRelation[];
  search_text: string;
};

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

// Sentinel filter value that matches all system/auto-generated document types
// (delivery photos, card statements, session attachments, Morning docs, …) —
// i.e. any document_type that isn't one of the controlled DOCUMENT_CATEGORIES.
const SYSTEM_CATEGORY_FILTER = "__system__";

function isControlledCategory(value: string | null | undefined) {
  return Boolean(value) && (DOCUMENT_CATEGORIES as readonly string[]).includes(value as string);
}

function formatDate(value: string | null) {
  return formatShortDateTime(value, "—");
}

// Year used for filtering: the explicit "document year" (ref_year, set on upload)
// when present, otherwise the upload year (the date shown on the card).
function documentYear(doc: DocumentArchiveItem): string {
  if (doc.ref_year && doc.ref_year > 0) return String(doc.ref_year);
  const value = doc.uploaded_at ?? doc.created_at;
  if (!value) return "";
  const year = value.slice(0, 4);
  return /^\d{4}$/.test(year) ? year : "";
}

function entityTypeLabel(value: string) {
  switch (value) {
    case "project":
      return "פרויקט";
    case "property":
      return "נכס";
    case "task":
      return "משימה";
    case "customer":
      return "לקוח";
    case "order":
      return "הזמנה";
    case "user":
      return "עובד";
    case "unlinked":
      return "ללא שיוך";
    default:
      return value || "ללא שיוך";
  }
}

function fileKindLabel(value: string) {
  switch (value) {
    case "pdf":
      return "PDF";
    case "image":
      return "תמונה";
    case "document":
      return "מסמך";
    case "spreadsheet":
      return "גיליון";
    case "presentation":
      return "מצגת";
    case "video":
      return "וידאו";
    case "archive":
      return "ארכיון";
    default:
      return "אחר";
  }
}

function fileKindIcon(value: string) {
  switch (value) {
    case "image":
      return ImageIcon;
    case "archive":
      return ProductIcon;
    default:
      return DocumentIcon;
  }
}

function groupLabel(groupBy: string, doc: DocumentArchiveItem) {
  if (groupBy === "entity") {
    if (doc.linked_entities.length === 0) return "ללא שיוך";
    if (doc.entity_types.length === 1) return entityTypeLabel(doc.entity_types[0] ?? "");
    return "מסמכים המשויכים למספר ישויות";
  }

  if (groupBy === "type") return getDocumentCategoryLabel(doc.document_type);
  if (groupBy === "kind") return fileKindLabel(doc.file_kind);
  if (groupBy === "customer") return doc.customers[0]?.label || "ללא לקוח";
  if (groupBy === "domain") return getBusinessDomainLabel(doc.business_domains[0] ?? "general_business");
  return "כל המסמכים";
}

function SelectField({
  value,
  onChange,
  children,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  ariaLabel: string;
}) {
  return (
    <NativeSelect
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
    >
      {children}
    </NativeSelect>
  );
}

export default function DocumentsArchiveClient({
  documents,
  error,
  initialFilters,
  focusDocumentId = null,
  projectOptions,
  propertyOptions,
  vehicleTagOptions = [],
  totalDocuments,
  isTruncated,
}: {
  documents: DocumentArchiveItem[];
  error: string | null;
  initialFilters: DocumentArchiveFilters;
  /** From `?focus=<id>` — open that document's preview straight away. */
  focusDocumentId?: string | null;
  projectOptions: ArchiveTargetOption[];
  propertyOptions: ArchiveTargetOption[];
  vehicleTagOptions?: ArchiveTargetOption[];
  totalDocuments: number;
  isTruncated: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(initialFilters.q);
  const [businessDomain, setBusinessDomain] = useState(initialFilters.business_domain);
  const [documentType, setDocumentType] = useState(initialFilters.type);
  const [customerId, setCustomerId] = useState(initialFilters.customer_id);
  const customerName = initialFilters.customer_name;
  const customerPhone = initialFilters.customer_phone;
  const [projectId, setProjectId] = useState(initialFilters.project_id);
  const [propertyId, setPropertyId] = useState(initialFilters.property_id);
  const [fileKind, setFileKind] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [groupBy, setGroupBy] = useState("entity");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadProjectOptions, setUploadProjectOptions] = useState<ArchiveTargetOption[]>(projectOptions);
  const [editDialogDoc, setEditDialogDoc] = useState<DocumentArchiveItem | null>(null);
  const [editTagValue, setEditTagValue] = useState("");
  const [editDomainDoc, setEditDomainDoc] = useState<DocumentArchiveItem | null>(null);
  const [editDomainValue, setEditDomainValue] = useState("");
  const [deleteDialogDoc, setDeleteDialogDoc] = useState<DocumentArchiveItem | null>(null);
  const [previewDoc, setPreviewDoc] = useState<DocumentArchiveItem | null>(null);
  // A ?focus= deep link (from the activity feed) opens that document's preview
  // right away — landing on the file itself, not on a scrolled list. Derived, so
  // it's open on the first paint; `focusDismissed` remembers a close, since the
  // param stays in the address bar.
  const [focusDismissed, setFocusDismissed] = useState<string | null>(null);
  const focusedDoc = useMemo(() => {
    if (!focusDocumentId || focusDismissed === focusDocumentId) return null;
    return documents.find((doc) => doc.id === focusDocumentId) ?? null;
  }, [documents, focusDocumentId, focusDismissed]);
  const activePreviewDoc = previewDoc ?? focusedDoc;

  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = normalizeText(deferredQuery);

  const customerOptions = useMemo(() => {
    const map = new Map<string, string>();
    if (customerId && customerName) map.set(customerId, customerName);
    for (const doc of documents) {
      for (const customer of doc.customers) {
        if (!map.has(customer.id)) map.set(customer.id, customer.label);
      }
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "he"));
  }, [customerId, customerName, documents]);


  const documentTypeOptions = useMemo(() => {
    // Your controlled categories appear individually; every system/auto-generated
    // type is folded into a single "אוטומטי (מערכת)" bucket so the dropdown stays
    // clean. Only categories that actually have documents are shown.
    const controlledPresent = new Set<string>();
    let hasSystem = false;
    for (const doc of documents) {
      const value = doc.document_type;
      if (!value) continue;
      if (isControlledCategory(value)) controlledPresent.add(value);
      else hasSystem = true;
    }
    const options: Array<{ value: string; label: string }> = DOCUMENT_CATEGORIES.filter((category) =>
      controlledPresent.has(category)
    ).map((category) => ({ value: category, label: getDocumentCategoryLabel(category) }));
    if (hasSystem) options.push({ value: SYSTEM_CATEGORY_FILTER, label: "אוטומטי (מערכת)" });
    return options;
  }, [documents]);

  const yearOptions = useMemo(() => {
    const years = new Set<string>();
    for (const doc of documents) {
      const year = documentYear(doc);
      if (year) years.add(year);
    }
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [documents]);

  const projectFilterOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const doc of documents) {
      for (const project of doc.projects) {
        if (!map.has(project.id)) map.set(project.id, project.label);
      }
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "he"));
  }, [documents]);
  const propertyFilterOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const property of propertyOptions) {
      if (!map.has(property.id)) map.set(property.id, property.label);
    }
    for (const doc of documents) {
      for (const property of doc.properties) {
        if (!map.has(property.id)) map.set(property.id, property.label);
      }
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "he"));
  }, [documents, propertyOptions]);
  const showProjectFilter = businessDomain === "logistics_projects";
  const showPropertyFilter = businessDomain === "property_management";

  // Switching domain invalidates a project/property filter that no longer
  // applies — clear it here, at the one place the domain can change.
  function changeBusinessDomain(next: string) {
    setBusinessDomain(next);
    if (next !== "logistics_projects") setProjectId("");
    if (next !== "property_management") setPropertyId("");
  }

  useEffect(() => {
    let cancelled = false;

    async function loadProjectOptions() {
      try {
        const response = await fetch("/api/projects/options", { cache: "no-store" });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) return;

        const nextOptions = Array.isArray(json?.projects)
          ? (json.projects as Array<{ id?: string; label?: string }>)
              .filter(
                (item): item is { id: string; label: string } =>
                  typeof item?.id === "string" &&
                  item.id.length > 0 &&
                  typeof item?.label === "string" &&
                  item.label.length > 0
              )
              .sort((a, b) => a.label.localeCompare(b.label, "he"))
          : [];

        if (!cancelled && nextOptions.length > 0) {
          setUploadProjectOptions(nextOptions);
        }
      } catch {
        // Keep initial server-provided options.
      }
    }

    void loadProjectOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      if (normalizedQuery && !doc.search_text.includes(normalizedQuery)) return false;
      if (businessDomain && !doc.business_domains.includes(businessDomain)) return false;
      if (documentType) {
        if (documentType === SYSTEM_CATEGORY_FILTER) {
          // System bucket: any present type that isn't a controlled category.
          if (!doc.document_type || isControlledCategory(doc.document_type)) return false;
        } else if ((doc.document_type ?? "") !== documentType) {
          return false;
        }
      }
      if (customerId && !doc.customers.some((customer) => customer.id === customerId)) return false;
      if (showProjectFilter && projectId && !doc.projects.some((project) => project.id === projectId)) return false;
      if (showPropertyFilter && propertyId && !doc.properties.some((property) => property.id === propertyId)) return false;
      if (fileKind && doc.file_kind !== fileKind) return false;
      if (yearFilter && documentYear(doc) !== yearFilter) return false;
      if (tagFilter && !(doc.tags ?? []).some((tag) => tag.id === tagFilter)) return false;
      return true;
    });
  }, [
    businessDomain,
    customerId,
    documentType,
    documents,
    fileKind,
    normalizedQuery,
    projectId,
    propertyId,
    showProjectFilter,
    showPropertyFilter,
    tagFilter,
    yearFilter,
  ]);

  const groupedDocuments = useMemo(() => {
    const map = new Map<string, DocumentArchiveItem[]>();
    for (const doc of filteredDocuments) {
      const label = groupLabel(groupBy, doc);
      const items = map.get(label) ?? [];
      items.push(doc);
      map.set(label, items);
    }

    return Array.from(map.entries())
      .map(([label, items]) => ({ label, items }))
      .sort((a, b) => {
        if (a.label === "ללא שיוך" || a.label === "ללא קטגוריה") return 1;
        if (b.label === "ללא שיוך" || b.label === "ללא קטגוריה") return -1;
        return a.label.localeCompare(b.label, "he");
      });
  }, [filteredDocuments, groupBy]);

  const linkedCount = useMemo(
    () => documents.filter((doc) => doc.linked_entities.length > 0).length,
    [documents]
  );

  const categorizedCount = useMemo(
    () => documents.filter((doc) => Boolean(doc.document_type)).length,
    [documents]
  );

  function resetFilters() {
    setQuery("");
    setBusinessDomain("");
    setDocumentType("");
    setCustomerId("");
    setProjectId("");
    setPropertyId("");
    setFileKind("");
    setYearFilter("");
    setGroupBy("entity");
  }

  async function saveTag() {
    if (!editDialogDoc) return;
    const nextValue = editTagValue.trim();

    startTransition(async () => {
      try {
        const response = await fetch("/api/documents/tag", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            document_id: editDialogDoc.id,
            document_type: nextValue,
          }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          toast.error("שגיאה בעדכון הקטגוריה", { description: toHebrewError(json?.error, "") });
          return;
        }
        toast.success("הקטגוריה עודכנה");
        setEditDialogDoc(null);
        setEditTagValue("");
        router.refresh();
      } catch (errorValue: unknown) {
        const description = toHebrewError(errorValue);
        toast.error("שגיאה בעדכון הקטגוריה", { description });
      }
    });
  }

  async function saveDomain() {
    if (!editDomainDoc) return;
    const nextValue = editDomainValue.trim();
    if (!nextValue) {
      toast.error("יש לבחור תחום");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/documents/domain", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            document_id: editDomainDoc.id,
            business_domain: nextValue,
          }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          toast.error("שגיאה בעדכון התחום", { description: toHebrewError(json?.error, "") });
          return;
        }
        toast.success("התחום עודכן");
        setEditDomainDoc(null);
        setEditDomainValue("");
        router.refresh();
      } catch (errorValue: unknown) {
        const description = toHebrewError(errorValue);
        toast.error("שגיאה בעדכון התחום", { description });
      }
    });
  }

  async function deleteDocument() {
    if (!deleteDialogDoc) return;

    startTransition(async () => {
      try {
        const response = await fetch("/api/documents/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ document_id: deleteDialogDoc.id }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          toast.error("שגיאה במחיקת המסמך", { description: toHebrewError(json?.error, "") });
          return;
        }
        toast.success("המסמך נמחק");
        setDeleteDialogDoc(null);
        router.refresh();
      } catch (errorValue: unknown) {
        const description = toHebrewError(errorValue);
        toast.error("שגיאה במחיקת המסמך", { description });
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader className="space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              {customerName ? (
                <div className="text-lg font-medium">
                  לקוח: {customerName}
                  {customerPhone ? (
                    <a
                      href={`tel:${customerPhone}`}
                      className="mr-2 text-sm font-normal text-muted-foreground hover:underline"
                    >
                      {customerPhone}
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="default"
                onClick={() => setUploadDialogOpen(true)}
              >
                <UploadIcon className="h-4 w-4" />
                העלאת קבצים
              </Button>
              <Badge variant="outline">{filteredDocuments.length} מוצגים</Badge>
              <Badge variant="secondary">{linkedCount} משויכים</Badge>
              <Badge variant="secondary">{categorizedCount} עם קטגוריה</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <AdaptiveGrid variant="formTwoLoose">
            <div className="space-y-1">
              <div className="text-sm font-medium">חיפוש</div>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pe-10"
                  placeholder="חיפוש לפי שם קובץ, קטגוריה, לקוח, פרויקט או נכס..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">קיבוץ</div>
              <SelectField value={groupBy} onChange={setGroupBy} ariaLabel="קיבוץ מסמכים">
                <option value="entity">לפי ישות משויכת</option>
                <option value="type">לפי קטגוריית מסמך</option>
                <option value="kind">לפי סוג קובץ</option>
                <option value="customer">לפי לקוח</option>
                <option value="domain">לפי תחום</option>
              </SelectField>
            </div>
          </AdaptiveGrid>

          <AdaptiveGrid variant="customersFilters">
            <div className="space-y-1">
              <div className="text-sm font-medium">תחום</div>
              <DomainSelect value={businessDomain} onChange={changeBusinessDomain} emptyLabel="כל התחומים" ariaLabel="סינון לפי תחום" />
            </div>

            {vehicleTagOptions.length > 0 ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">רכב</div>
                <SelectField value={tagFilter} onChange={setTagFilter} ariaLabel="סינון לפי רכב">
                  <option value="">כל הרכבים</option>
                  {vehicleTagOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </SelectField>
              </div>
            ) : null}

            <div className="space-y-1">
              <div className="text-sm font-medium">קטגוריה</div>
              <SelectField
                value={documentType}
                onChange={setDocumentType}
                ariaLabel="סינון לפי קטגוריה"
              >
                <option value="">כל הקטגוריות</option>
                {documentTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">לקוח</div>
              <CustomerPicker
                showCreate={false}
                placeholder="כל הלקוחות"
                value={
                  customerId
                    ? {
                        id: customerId,
                        name: customerOptions.find((o) => o.id === customerId)?.label ?? customerName ?? "",
                        phone: null,
                      }
                    : null
                }
                onChange={(customer) => setCustomerId(customer?.id ?? "")}
              />
            </div>

            {showProjectFilter ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">פרויקט</div>
                <ProjectPicker
                  value={projectId}
                  onChange={setProjectId}
                  emptyLabel="כל הפרויקטים"
                  searchPlaceholder="חיפוש פרויקט..."
                  projects={projectFilterOptions.map((option) => ({ id: option.id, label: option.label }))}
                />
              </div>
            ) : null}

            {showPropertyFilter ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">נכס</div>
                <SearchableSelect
                  value={propertyId}
                  onChange={setPropertyId}
                  ariaLabel="סינון לפי נכס"
                  emptyOptionLabel="כל הנכסים"
                  searchPlaceholder="חיפוש נכס..."
                  options={propertyFilterOptions.map((option) => ({ value: option.id, label: option.label }))}
                />
              </div>
            ) : null}
          </AdaptiveGrid>

          <AdaptiveGrid variant="formTwoLoose">
            <div className="space-y-1">
              <div className="text-sm font-medium">סוג קובץ</div>
              <SelectField value={fileKind} onChange={setFileKind} ariaLabel="סינון לפי סוג קובץ">
                <option value="">כל הסוגים</option>
                <option value="pdf">PDF</option>
                <option value="image">תמונות</option>
                <option value="document">מסמכים</option>
                <option value="spreadsheet">גיליונות</option>
                <option value="presentation">מצגות</option>
                <option value="video">וידאו</option>
                <option value="archive">ארכיונים</option>
                <option value="other">אחר</option>
              </SelectField>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">שנה</div>
              <SelectField value={yearFilter} onChange={setYearFilter} ariaLabel="סינון לפי שנה">
                <option value="">כל השנים</option>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </SelectField>
            </div>
          </AdaptiveGrid>

          <AdaptiveGrid variant="formTwoLoose">
            <div className="flex items-end justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                {isTruncated
                  ? `מוצגים ${documents.length} מתוך ${totalDocuments} מסמכים. כדאי להוסיף בהמשך עימוד אם הארכיון ממשיך לגדול.`
                  : `נטענו ${totalDocuments} מסמכים לארכיון.`}
              </div>
              <Button variant="outline" onClick={resetFilters}>
                איפוס סינון
              </Button>
            </div>
          </AdaptiveGrid>
        </CardContent>
      </Card>

      {error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">
            שגיאה בטעינת ארכיון המסמכים: {error}
          </CardContent>
        </Card>
      ) : null}

      {groupedDocuments.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-40 flex-col items-center justify-center gap-3 pt-6 text-center">
            <FolderIcon className="h-8 w-8 text-muted-foreground" />
            <div className="space-y-1">
              <div className="font-medium">לא נמצאו מסמכים לסינון שבחרת</div>
              <div className="text-sm text-muted-foreground">
                נסה להרחיב את החיפוש או לאפס את הסינונים.
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        groupedDocuments.map((group) => (
          <Card key={group.label}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-lg">{group.label}</CardTitle>
                  <CardDescription>{group.items.length} מסמכים</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {group.items.map((doc) => {
                const KindIcon = fileKindIcon(doc.file_kind);
                return (
                  <div
                    key={doc.id}
                    // Lets /documents?focus=<id> (e.g. from the activity feed)
                    // land on this exact file — see FocusHighlighter.
                    data-focus-id={doc.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setPreviewDoc(doc)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setPreviewDoc(doc);
                      }
                    }}
                    className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border/70 bg-background/70 px-3 py-2 transition-colors hover:bg-secondary/10"
                  >
                    {doc.file_kind === "image" && doc.url ? (
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0"
                        title="פתיחת התמונה"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={doc.url}
                          alt={doc.title}
                          loading="lazy"
                          className="h-12 w-12 rounded-lg border border-border/60 object-cover"
                        />
                      </a>
                    ) : (
                      <div className="shrink-0 rounded-lg bg-muted p-2 text-muted-foreground">
                        <KindIcon className="h-4 w-4" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-medium">{doc.title}</span>
                        <Badge variant="outline">{fileKindLabel(doc.file_kind)}</Badge>
                        {doc.business_domains.map((domain) => (
                          <Badge key={`${doc.id}-${domain}`} variant="outline">
                            {getBusinessDomainLabel(domain)}
                          </Badge>
                        ))}
                        <Badge variant="secondary">{getDocumentCategoryLabel(doc.document_type)}</Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span>{formatDate(doc.uploaded_at)}</span>
                        {doc.uploaded_by_name ? <span>· {doc.uploaded_by_name}</span> : null}
                        {doc.linked_entities.length > 0 ? (
                          doc.linked_entities.map((entity) =>
                            entity.href ? (
                              <Link
                                key={`${entity.type}:${entity.id}`}
                                href={entity.href}
                                onClick={(event) => event.stopPropagation()}
                                className="text-foreground hover:underline"
                              >
                                · {entityTypeLabel(entity.type)}: {entity.label}
                              </Link>
                            ) : (
                              <span key={`${entity.type}:${entity.id}`}>
                                · {entityTypeLabel(entity.type)}: {entity.label}
                              </span>
                            )
                          )
                        ) : (
                          <span>· ללא שיוך</span>
                        )}
                        {doc.customers.length > 0 &&
                        !doc.linked_entities.some((entity) => entity.type === "customer") ? (
                          <span>· לקוח: {doc.customers.map((item) => item.label).join(", ")}</span>
                        ) : null}
                      </div>
                    </div>
                    {/* Actions act on the row, not on it — don't let them open
                        the preview too. */}
                    <div
                      className="flex shrink-0 items-center gap-1"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {doc.url ? (
                        <Button asChild variant="outline" size="icon" aria-label="פתיחה" title="פתיחה">
                          <a href={doc.url} target="_blank" rel="noreferrer">
                            <ExternalLinkIcon className="h-4 w-4" />
                          </a>
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="קטגוריה"
                        title="קטגוריה"
                        onClick={() => {
                          setEditDialogDoc(doc);
                          setEditTagValue(doc.document_type ?? "");
                        }}
                      >
                        <TagIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="שינוי תחום"
                        title="שינוי תחום"
                        onClick={() => {
                          setEditDomainDoc(doc);
                          setEditDomainValue(doc.business_domains[0] ?? "general_business");
                        }}
                      >
                        <LayersIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="מחיקה"
                        title="מחיקה"
                        onClick={() => setDeleteDialogDoc(doc)}
                      >
                        <DeleteIcon className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))
      )}

      {/* The document itself: the file rendered inline (image / PDF) plus every
          detail we hold about it. This is what an activity row for a document
          opens — the record, not the list it sits in. */}
      <ViewDialog
        open={Boolean(activePreviewDoc)}
        onOpenChange={(open) => {
          if (open) return;
          setPreviewDoc(null);
          if (focusDocumentId) setFocusDismissed(focusDocumentId);
        }}
        title={activePreviewDoc?.title ?? "מסמך"}
        description={
          activePreviewDoc
            ? `${getDocumentCategoryLabel(activePreviewDoc.document_type)} · ${fileKindLabel(activePreviewDoc.file_kind)}`
            : undefined
        }
        footer={
          activePreviewDoc?.url ? (
            <div className="flex justify-end">
              <Button asChild>
                <a href={activePreviewDoc.url} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon className="h-4 w-4" />
                  פתיחה בכרטיסייה חדשה
                </a>
              </Button>
            </div>
          ) : null
        }
      >

          {activePreviewDoc ? (
            <div className="mt-4 space-y-4">
              <div className="overflow-hidden rounded-xl border border-border/70 bg-muted/30">
                {activePreviewDoc.url && activePreviewDoc.file_kind === "image" ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={activePreviewDoc.url}
                    alt={activePreviewDoc.title}
                    className="max-h-[50vh] w-full object-contain"
                  />
                ) : activePreviewDoc.url && activePreviewDoc.file_kind === "pdf" ? (
                  <iframe
                    src={activePreviewDoc.url}
                    title={activePreviewDoc.title}
                    className="h-[50vh] w-full"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
                    <DocumentIcon className="h-8 w-8" />
                    <span>אין תצוגה מקדימה לסוג הקובץ הזה — אפשר לפתוח אותו בכרטיסייה חדשה.</span>
                  </div>
                )}
              </div>

              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">שם הקובץ</dt>
                  <dd className="break-words font-medium">{activePreviewDoc.file_name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">תאריך העלאה</dt>
                  <dd className="font-medium">{formatDate(activePreviewDoc.uploaded_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">הועלה על ידי</dt>
                  <dd className="font-medium">{activePreviewDoc.uploaded_by_name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">תחום</dt>
                  <dd className="font-medium">
                    {activePreviewDoc.business_domains.map(getBusinessDomainLabel).join(" · ") || "—"}
                  </dd>
                </div>
                {activePreviewDoc.ref_year ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">שנת המסמך</dt>
                    <dd className="font-medium tabular-nums">{activePreviewDoc.ref_year}</dd>
                  </div>
                ) : null}
                {activePreviewDoc.tags.length > 0 ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">רכב / תגיות</dt>
                    <dd className="font-medium">
                      {activePreviewDoc.tags.map((tag) => tag.label).join(", ")}
                    </dd>
                  </div>
                ) : null}
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">שיוכים</dt>
                  <dd className="flex flex-wrap gap-x-3 gap-y-1 font-medium">
                    {activePreviewDoc.linked_entities.length > 0
                      ? activePreviewDoc.linked_entities.map((entity) =>
                          entity.href ? (
                            <Link
                              key={`${entity.type}:${entity.id}`}
                              href={entity.href}
                              className="text-secondary hover:underline"
                            >
                              {`${entityTypeLabel(entity.type)}: ${entity.label}`}
                            </Link>
                          ) : (
                            <span key={`${entity.type}:${entity.id}`}>
                              {`${entityTypeLabel(entity.type)}: ${entity.label}`}
                            </span>
                          )
                        )
                      : "ללא שיוך"}
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}

      </ViewDialog>

      <UploadDocumentDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        projects={uploadProjectOptions.map((option) => ({ id: option.id, label: option.label }))}
        properties={propertyFilterOptions.map((option) => ({ id: option.id, label: option.label }))}
        defaultDomain={businessDomain}
        defaultProjectId={initialFilters.project_id}
        defaultPropertyId={initialFilters.property_id}
        onUploaded={() => router.refresh()}
      />

      <FormDialog
        open={Boolean(editDialogDoc)}
        onOpenChange={(open) => {
          if (!open) {
            setEditDialogDoc(null);
            setEditTagValue("");
          }
        }}
        title="עדכון קטגוריית מסמך"
        description="שינוי הקטגוריה של המסמך הנבחר."
        size="formMd"
        onSubmit={() => void saveTag()}
        submitLabel="שמירה"
        busyLabel="שומר..."
        busy={isPending}
      >
          <div className="mt-4 space-y-3">
            <div className="text-sm font-medium">{editDialogDoc?.title ?? "מסמך"}</div>
            <SelectField value={editTagValue} onChange={setEditTagValue} ariaLabel="קטגוריית מסמך">
              <option value="">ללא קטגוריה</option>
              {editTagValue && !(DOCUMENT_CATEGORIES as readonly string[]).includes(editTagValue) ? (
                <option value={editTagValue}>{getDocumentCategoryLabel(editTagValue)} (נוכחי)</option>
              ) : null}
              {DOCUMENT_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </SelectField>
          </div>
      </FormDialog>

      <FormDialog
        open={Boolean(editDomainDoc)}
        onOpenChange={(open) => {
          if (!open) {
            setEditDomainDoc(null);
            setEditDomainValue("");
          }
        }}
        title="שינוי תחום"
        description="בחירת התחום העסקי שאליו ישויך המסמך."
        size="formMd"
        onSubmit={() => void saveDomain()}
        submitLabel="שמירה"
        busyLabel="שומר..."
        busy={isPending}
      >
          <div className="space-y-3">
            <div className="text-sm font-medium">{editDomainDoc?.title ?? "מסמך"}</div>
            <DomainSelect value={editDomainValue} onChange={setEditDomainValue} ariaLabel="תחום המסמך" />
          </div>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(deleteDialogDoc)}
        onOpenChange={(open) => {
          if (!open) setDeleteDialogDoc(null);
        }}
        destructive
        title="מחיקת מסמך"
        description="הפעולה תמחק את קובץ האחסון ואת כל הקישורים של המסמך."
        confirmLabel="מחיקה"
        loading={isPending}
        onConfirm={() => void deleteDocument()}
      >
        <p className="text-sm">
          האם למחוק את <span className="font-medium">{deleteDialogDoc?.title ?? "המסמך"}</span>?
        </p>
      </ConfirmDialog>
    </div>
  );
}
