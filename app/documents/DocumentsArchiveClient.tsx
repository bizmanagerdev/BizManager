"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ExternalLink,
  FileText,
  FolderOpen,
  ImageIcon,
  Package,
  Upload,
  Search,
  Tag,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { Input } from "@/components/ui/input";
import { formatShortDateTime } from "@/lib/date";
import { EXPENSE_BUSINESS_DOMAINS, getBusinessDomainLabel } from "@/lib/expenses";

export type DocumentArchiveFilters = {
  customer_id: string;
  customer_name: string;
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
  search_text: string;
};

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function formatDate(value: string | null) {
  return formatShortDateTime(value, "—");
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
      return Package;
    default:
      return FileText;
  }
}

function groupLabel(groupBy: string, doc: DocumentArchiveItem) {
  if (groupBy === "entity") {
    if (doc.linked_entities.length === 0) return "ללא שיוך";
    if (doc.entity_types.length === 1) return entityTypeLabel(doc.entity_types[0] ?? "");
    return "מסמכים המשויכים למספר ישויות";
  }

  if (groupBy === "type") return doc.document_type || "ללא קטגוריה";
  if (groupBy === "kind") return fileKindLabel(doc.file_kind);
  if (groupBy === "customer") return doc.customers[0]?.label || "ללא לקוח";
  if (groupBy === "project") return doc.projects[0]?.label || "ללא פרויקט";
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
    <select
      className="flex h-11 w-full rounded-xl border border-input bg-background/80 px-4 py-2 text-sm shadow-sm transition-all duration-200 focus-visible:border-destructive/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
    >
      {children}
    </select>
  );
}

export default function DocumentsArchiveClient({
  documents,
  error,
  initialFilters,
  projectOptions,
  propertyOptions,
  totalDocuments,
  isTruncated,
}: {
  documents: DocumentArchiveItem[];
  error: string | null;
  initialFilters: DocumentArchiveFilters;
  projectOptions: ArchiveTargetOption[];
  propertyOptions: ArchiveTargetOption[];
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
  const [projectId, setProjectId] = useState(initialFilters.project_id);
  const [propertyId, setPropertyId] = useState(initialFilters.property_id);
  const [fileKind, setFileKind] = useState("");
  const [groupBy, setGroupBy] = useState("entity");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadBusinessDomain, setUploadBusinessDomain] = useState(
    initialFilters.business_domain === "property_management" ? "property_management" : "logistics_projects"
  );
  const [uploadCategoryMode, setUploadCategoryMode] = useState<"existing" | "new">("existing");
  const [uploadCategory, setUploadCategory] = useState("");
  const [uploadNewCategory, setUploadNewCategory] = useState("");
  const [uploadProjectId, setUploadProjectId] = useState(initialFilters.project_id);
  const [uploadPropertyId, setUploadPropertyId] = useState(initialFilters.property_id);
  const [uploadProjectOptions, setUploadProjectOptions] = useState<ArchiveTargetOption[]>(projectOptions);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [editDialogDoc, setEditDialogDoc] = useState<DocumentArchiveItem | null>(null);
  const [editTagValue, setEditTagValue] = useState("");
  const [deleteDialogDoc, setDeleteDialogDoc] = useState<DocumentArchiveItem | null>(null);

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
    return Array.from(
      new Set(documents.map((doc) => doc.document_type).filter((value): value is string => Boolean(value)))
    ).sort((a, b) => a.localeCompare(b, "he"));
  }, [documents]);

  const uploadCategoryOptions = useMemo(() => documentTypeOptions, [documentTypeOptions]);
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
  const showUploadProjectField = uploadBusinessDomain === "logistics_projects";
  const showUploadPropertyField = uploadBusinessDomain === "property_management";

  function resetUploadForm() {
    setUploadCategory("");
    setUploadNewCategory("");
    setUploadCategoryMode("existing");
    setUploadBusinessDomain(businessDomain === "property_management" ? "property_management" : "logistics_projects");
    setUploadProjectId(initialFilters.project_id);
    setUploadPropertyId(initialFilters.property_id);
    setUploadFiles([]);
  }

  useEffect(() => {
    if (!showProjectFilter && projectId) {
      setProjectId("");
    }
    if (!showPropertyFilter && propertyId) {
      setPropertyId("");
    }
  }, [projectId, propertyId, showProjectFilter, showPropertyFilter]);

  useEffect(() => {
    if (!showUploadProjectField && uploadProjectId) {
      setUploadProjectId("");
    }
    if (!showUploadPropertyField && uploadPropertyId) {
      setUploadPropertyId("");
    }
  }, [showUploadProjectField, showUploadPropertyField, uploadProjectId, uploadPropertyId]);

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
      if (documentType && (doc.document_type ?? "") !== documentType) return false;
      if (customerId && !doc.customers.some((customer) => customer.id === customerId)) return false;
      if (showProjectFilter && projectId && !doc.projects.some((project) => project.id === projectId)) return false;
      if (showPropertyFilter && propertyId && !doc.properties.some((property) => property.id === propertyId)) return false;
      if (fileKind && doc.file_kind !== fileKind) return false;
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
    setGroupBy("entity");
  }

  async function startUpload() {
    if (uploading || uploadFiles.length === 0) return;

    const category =
      uploadCategoryMode === "new" ? uploadNewCategory.trim() : uploadCategory.trim();
    const projectId = uploadProjectId.trim();
    const propertyId = uploadPropertyId.trim();

    if (uploadCategoryMode === "new" && !category) {
      toast.error("יש להזין קטגוריה חדשה");
      return;
    }
    if (showUploadProjectField && !projectId) {
      toast.error("יש לבחור פרויקט");
      return;
    }

    if (showUploadPropertyField && !propertyId) {
      toast.error("יש לבחור נכס");
      return;
    }

    setUploading(true);
    const files = uploadFiles;
    const toastId = toast.loading("מעלה קבצים...");

    try {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i]!;
        const form = new FormData();
        form.set("file", file);
        form.set("business_domain", uploadBusinessDomain);
        if (showUploadProjectField) form.set("project_id", projectId);
        if (showUploadPropertyField) form.set("property_id", propertyId);
        if (category) form.set("category", category);

        toast.loading(`מעלה קבצים... (${i + 1}/${files.length})`, { id: toastId });

        const response = await fetch("/api/documents/upload", {
          method: "POST",
          body: form,
        });
        const json = await response.json().catch(() => ({}));

        if (!response.ok) {
          toast.error("שגיאה בהעלאת קובץ", {
            id: toastId,
            description: json?.error ?? "",
          });
          return;
        }
      }

      toast.success("הקבצים הועלו", { id: toastId });
      setUploadDialogOpen(false);
      resetUploadForm();
      router.refresh();
    } catch (errorValue: unknown) {
      const description = errorValue instanceof Error ? errorValue.message : "Unknown error";
      toast.error("שגיאה בהעלאת קובץ", { id: toastId, description });
    } finally {
      setUploading(false);
    }
  }

  async function saveTag() {
    if (!editDialogDoc) return;
    const nextValue = editTagValue.trim();
    if (!nextValue) {
      toast.error("יש להזין קטגוריה");
      return;
    }

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
          toast.error("שגיאה בעדכון הקטגוריה", { description: json?.error ?? "" });
          return;
        }
        toast.success("הקטגוריה עודכנה");
        setEditDialogDoc(null);
        setEditTagValue("");
        router.refresh();
      } catch (errorValue: unknown) {
        const description = errorValue instanceof Error ? errorValue.message : "Unknown error";
        toast.error("שגיאה בעדכון הקטגוריה", { description });
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
          toast.error("שגיאה במחיקת המסמך", { description: json?.error ?? "" });
          return;
        }
        toast.success("המסמך נמחק");
        setDeleteDialogDoc(null);
        router.refresh();
      } catch (errorValue: unknown) {
        const description = errorValue instanceof Error ? errorValue.message : "Unknown error";
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
              {customerName ? <div className="text-lg font-medium">לקוח: {customerName}</div> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="default"
                onClick={() => {
                  resetUploadForm();
                  setUploadDialogOpen(true);
                }}
              >
                <Upload className="h-4 w-4" />
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
                <Search className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
                <option value="project">לפי פרויקט</option>
              </SelectField>
            </div>
          </AdaptiveGrid>

          <AdaptiveGrid variant="customersFilters">
            <div className="space-y-1">
              <div className="text-sm font-medium">תחום</div>
              <SelectField value={businessDomain} onChange={setBusinessDomain} ariaLabel="סינון לפי תחום">
                <option value="">כל התחומים</option>
                {EXPENSE_BUSINESS_DOMAINS.map((domain) => (
                  <option key={domain} value={domain}>
                    {getBusinessDomainLabel(domain)}
                  </option>
                ))}
              </SelectField>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">קטגוריה</div>
              <SelectField
                value={documentType}
                onChange={setDocumentType}
                ariaLabel="סינון לפי קטגוריה"
              >
                <option value="">כל הקטגוריות</option>
                {documentTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </SelectField>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">לקוח</div>
              <SelectField value={customerId} onChange={setCustomerId} ariaLabel="סינון לפי לקוח">
                <option value="">כל הלקוחות</option>
                {customerOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
            </div>

            {showProjectFilter ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">פרויקט</div>
                <SelectField value={projectId} onChange={setProjectId} ariaLabel="סינון לפי פרויקט">
                  <option value="">כל הפרויקטים</option>
                  {projectFilterOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </SelectField>
              </div>
            ) : null}

            {showPropertyFilter ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">נכס</div>
                <SelectField value={propertyId} onChange={setPropertyId} ariaLabel="סינון לפי נכס">
                  <option value="">כל הנכסים</option>
                  {propertyFilterOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </SelectField>
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
            <FolderOpen className="h-8 w-8 text-muted-foreground" />
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
                    className="rounded-2xl border border-border/70 bg-background/70 p-4"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-3">
                        <div className="flex items-start gap-3">
                          <div className="rounded-2xl bg-muted p-3 text-muted-foreground">
                            <KindIcon className="h-5 w-5" />
                          </div>
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="font-medium">{doc.title}</div>
                              <Badge variant="outline">{fileKindLabel(doc.file_kind)}</Badge>
                              {doc.business_domains.map((domain) => (
                                <Badge key={`${doc.id}-${domain}`} variant="outline">
                                  {getBusinessDomainLabel(domain)}
                                </Badge>
                              ))}
                              {doc.document_type ? (
                                <Badge variant="secondary">{doc.document_type}</Badge>
                              ) : (
                                <Badge variant="outline">ללא קטגוריה</Badge>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <span>הועלה: {formatDate(doc.uploaded_at)}</span>
                              {doc.uploaded_by_name ? <span>הוזן ע״י: {doc.uploaded_by_name}</span> : null}
                              {doc.file_name ? <span>קובץ: {doc.file_name}</span> : null}
                              {doc.storage_key ? <span>נתיב: {doc.storage_key}</span> : null}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 text-xs">
                          {doc.linked_entities.length > 0 ? (
                            doc.linked_entities.map((entity) =>
                              entity.href ? (
                                <Link
                                  key={`${entity.type}:${entity.id}`}
                                  href={entity.href}
                                  className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-3 py-1 text-foreground hover:bg-accent"
                                >
                                  <span>{entityTypeLabel(entity.type)}:</span>
                                  <span>{entity.label}</span>
                                </Link>
                              ) : (
                                <span
                                  key={`${entity.type}:${entity.id}`}
                                  className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-3 py-1"
                                >
                                  <span>{entityTypeLabel(entity.type)}:</span>
                                  <span>{entity.label}</span>
                                </span>
                              )
                            )
                          ) : (
                            <span className="inline-flex items-center rounded-full border border-dashed px-3 py-1 text-muted-foreground">
                              ללא שיוך
                            </span>
                          )}
                        </div>

                        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-5">
                          <div>
                            <span className="font-medium text-foreground">לקוחות:</span>{" "}
                            {doc.customers.length > 0
                              ? doc.customers.map((item) => item.label).join(", ")
                              : "—"}
                          </div>
                          <div>
                            <span className="font-medium text-foreground">פרויקטים:</span>{" "}
                            {doc.projects.length > 0
                              ? doc.projects.map((item) => item.label).join(", ")
                              : "—"}
                          </div>
                          <div>
                            <span className="font-medium text-foreground">נכסים:</span>{" "}
                            {doc.properties.length > 0
                              ? doc.properties.map((item) => item.label).join(", ")
                              : "—"}
                          </div>
                          <div>
                            <span className="font-medium text-foreground">משימות:</span>{" "}
                            {doc.tasks.length > 0 ? doc.tasks.map((item) => item.label).join(", ") : "—"}
                          </div>
                          <div>
                            <span className="font-medium text-foreground">הזמנות:</span>{" "}
                            {doc.orders.length > 0
                              ? doc.orders.map((item) => item.label).join(", ")
                              : "—"}
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-2">
                        {doc.url ? (
                          <Button asChild variant="outline" size="sm">
                            <a href={doc.url} target="_blank" rel="noreferrer">
                              <ExternalLink className="h-4 w-4" />
                              פתיחה
                            </a>
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditDialogDoc(doc);
                            setEditTagValue(doc.document_type ?? "");
                          }}
                        >
                          <Tag className="h-4 w-4" />
                          קטגוריה
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDeleteDialogDoc(doc)}
                        >
                          <Trash2 className="h-4 w-4" />
                          מחיקה
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))
      )}

      <Dialog
        open={uploadDialogOpen}
        onOpenChange={(open) => {
          if (!open && uploading) return;
          setUploadDialogOpen(open);
          if (!open) {
            resetUploadForm();
          }
        }}
      >
        <AdaptiveDialog size="formMd">
          <DialogHeader>
            <DialogTitle>העלאת קבצים</DialogTitle>
            <DialogDescription>בחירת קבצים להוספה לארכיון המסמכים המרכזי.</DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-1">
              <div className="text-sm font-medium">תחום</div>
              <SelectField value={uploadBusinessDomain} onChange={setUploadBusinessDomain} ariaLabel="תחום למסמך חדש">
                <option value="logistics_projects">{getBusinessDomainLabel("logistics_projects")}</option>
                <option value="property_management">{getBusinessDomainLabel("property_management")}</option>
              </SelectField>
            </div>

            {showUploadProjectField ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">פרויקט</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={uploadProjectId}
                  onChange={(event) => setUploadProjectId(event.target.value)}
                >
                  <option value="">בחר פרויקט</option>
                  {uploadProjectOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {!uploadProjectId.trim() ? (
                  <div className="text-xs text-destructive">יש לבחור פרויקט לקישור הקבצים</div>
                ) : null}
              </div>
            ) : null}

            {showUploadPropertyField ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">נכס</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={uploadPropertyId}
                  onChange={(event) => setUploadPropertyId(event.target.value)}
                >
                  <option value="">בחר נכס</option>
                  {propertyFilterOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {!uploadPropertyId.trim() ? (
                  <div className="text-xs text-destructive">יש לבחור נכס לקישור הקבצים</div>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-1">
              <div className="text-sm font-medium">קטגוריה (אופציונלי)</div>
              <AdaptiveGrid variant="formTwo" className="gap-2">
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={uploadCategoryMode === "new" ? "__new__" : uploadCategory}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === "__new__") {
                      setUploadCategoryMode("new");
                      setUploadCategory("");
                    } else {
                      setUploadCategoryMode("existing");
                      setUploadCategory(value);
                      setUploadNewCategory("");
                    }
                  }}
                >
                  <option value="">ללא קטגוריה</option>
                  {uploadCategoryOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                  <option value="__new__">קטגוריה חדשה...</option>
                </select>
                {uploadCategoryMode === "new" ? (
                  <Input
                    value={uploadNewCategory}
                    onChange={(event) => setUploadNewCategory(event.target.value)}
                    placeholder="שם קטגוריה חדשה"
                    aria-invalid={!uploadNewCategory.trim()}
                    className={!uploadNewCategory.trim() ? "border-destructive focus-visible:ring-destructive" : ""}
                  />
                ) : null}
              </AdaptiveGrid>
              {uploadCategoryMode === "new" && !uploadNewCategory.trim() ? (
                <div className="text-xs text-destructive">יש להזין שם קטגוריה</div>
              ) : null}
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">קבצים</div>
              <div className="flex items-center justify-between gap-2">
                <FileUploadActions
                  files={uploadFiles}
                  multiple
                  onFilesSelected={setUploadFiles}
                  chooseLabel="בחר קבצים"
                />
                <div className="text-xs text-muted-foreground">{uploadFiles.length} קבצים</div>
              </div>
              {uploadFiles.length > 0 ? (
                <div className="text-xs text-muted-foreground truncate">
                  {uploadFiles.slice(0, 3).map((file) => file.name).join(", ")}
                  {uploadFiles.length > 3 ? ` +${uploadFiles.length - 3}` : ""}
                </div>
              ) : (
                <div className="text-xs text-destructive">בחר לפחות קובץ אחד</div>
              )}
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button type="button" variant="secondary" disabled={uploading} onClick={() => setUploadDialogOpen(false)}>
              ביטול
            </Button>
            <Button
              type="button"
              disabled={
                uploading ||
                uploadFiles.length === 0 ||
                (showUploadProjectField && !uploadProjectId.trim()) ||
                (showUploadPropertyField && !uploadPropertyId.trim()) ||
                (uploadCategoryMode === "new" && !uploadNewCategory.trim())
              }
              onClick={() => void startUpload()}
            >
              {uploading ? "מעלה..." : "העלאה"}
            </Button>
          </DialogFooter>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={Boolean(editDialogDoc)}
        onOpenChange={(open) => {
          if (!open && isPending) return;
          if (!open) {
            setEditDialogDoc(null);
            setEditTagValue("");
          }
        }}
      >
        <AdaptiveDialog size="formMd">
          <DialogHeader>
            <DialogTitle>עדכון קטגוריית מסמך</DialogTitle>
            <DialogDescription>
              שינוי הערך של `documents.document_type` עבור המסמך הנבחר.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-3">
            <div className="text-sm font-medium">{editDialogDoc?.title ?? "מסמך"}</div>
            <Input
              value={editTagValue}
              onChange={(event) => setEditTagValue(event.target.value)}
              placeholder="לדוגמה: חשבונית, חוזה, תעודת משלוח"
              aria-label="קטגוריית מסמך"
            />
          </div>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEditDialogDoc(null);
                setEditTagValue("");
              }}
              disabled={isPending}
            >
              ביטול
            </Button>
            <Button type="button" onClick={() => void saveTag()} disabled={isPending}>
              {isPending ? "שומר..." : "שמירה"}
            </Button>
          </DialogFooter>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={Boolean(deleteDialogDoc)}
        onOpenChange={(open) => {
          if (!open && isPending) return;
          if (!open) setDeleteDialogDoc(null);
        }}
      >
        <AdaptiveDialog size="formMd">
          <DialogHeader>
            <DialogTitle>מחיקת מסמך</DialogTitle>
            <DialogDescription>
              הפעולה תמחק את קובץ האחסון ואת כל הקישורים של המסמך.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 text-sm">
            האם למחוק את <span className="font-medium">{deleteDialogDoc?.title ?? "המסמך"}</span>?
          </div>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeleteDialogDoc(null)}
              disabled={isPending}
            >
              ביטול
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void deleteDocument()}
              disabled={isPending}
            >
              {isPending ? "מוחק..." : "מחיקה"}
            </Button>
          </DialogFooter>
        </AdaptiveDialog>
      </Dialog>
    </div>
  );
}
