"use client";
import { toHebrewError } from "@/lib/error-messages";
import { resyncAlerts } from "@/lib/ui/alerts-refresh";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Pencil, Trash2 } from "lucide-react";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import { offlineFetch } from "@/lib/offline-queue";
import { offlineUpload } from "@/lib/offline-upload";
import { Button } from "@/components/ui/button";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { CustomerPicker } from "@/components/customers/CustomerPicker";
import { Textarea } from "@/components/ui/textarea";
import {
  MovingEndpointFields,
  elevatorToBool,
  boolToElevator,
  type MovingEndpointValue,
} from "@/components/projects/MovingAddressFields";
import DeleteProjectButton from "@/app/(app)/projects/DeleteProjectButton";
import LogCommunicationButton from "@/components/communications/LogCommunicationButton";

type Option = {
  id: string;
  label: string;
};

type ProjectDetails = {
  id: string;
  name: string;
  customer_id: string;
  status: string;
  project_type: string;
  agreed_base_price: number | string | null;
  actual_price: number | string | null;
  price_includes_vat: boolean | null;
  no_charge: boolean | null;
  expenses_billed_separately: boolean | null;
  project_manager_id: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  items_to_move: string[] | null;
  origin_address?: string | null;
  origin_floor?: string | null;
  origin_has_elevator?: boolean | null;
  destination_address?: string | null;
  destination_floor?: string | null;
  destination_has_elevator?: boolean | null;
};

type ProjectDocument = {
  document_id: string;
  title: string | null;
  file_name: string | null;
  document_type: string | null;
  uploaded_at: string | null;
  uploaded_by_name: string | null;
  url: string | null;
};

const defaultStatusOptions = ["quote", "planned", "active", "on_hold", "completed", "cancelled"];
const defaultProjectTypeOptions = ["logistics", "moving", "construction"];

function isMovingProjectType(value: string) {
  return value === "moving";
}

function itemsToMoveToText(items: string[] | null | undefined) {
  return (items ?? []).join("\n");
}

function textToItemsToMove(value: string) {
  const items = value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatDateTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

async function uploadProjectDocument(projectId: string, file: File) {
  const result = await offlineUpload("/api/projects/documents/upload", {
    fields: {
      project_id: projectId,
      category: file.type.startsWith("image/") ? "project_photo" : "project_document",
    },
    file,
    label: file.name,
  });
  // A queued upload was saved on the device and replays on reconnect — treat it
  // as success; only a real server rejection should throw.
  if (!result.queued && !result.ok) {
    throw new Error(result.error || "העלאת הקובץ נכשלה.");
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "quote":
      return "הצעת מחיר";
    case "planned":
      return "מתוכנן";
    case "active":
      return "פעיל";
    case "on_hold":
      return "בהמתנה";
    case "completed":
      return "הושלם";
    case "cancelled":
      return "בוטל";
    default:
      return status;
  }
}

function projectTypeLabel(value: string) {
  switch (value) {
    case "logistics":
      return "לוגיסטיקה";
    case "construction":
      return "שיפוצים";
    case "moving":
      return "הובלה";
    case "other":
      return "אחר";
    case "home":
      return "בית";
    default:
      return value;
  }
}

export default function ProjectDetailsActions({
  project,
  customerOptions,
  managerOptions,
  projectDocuments,
  projectDocumentsError,
}: {
  project: ProjectDetails;
  customerOptions: Option[];
  managerOptions: Option[];
  projectDocuments: ProjectDocument[];
  projectDocumentsError: string | null;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editName, setEditName] = useState(project.name);
  const [editCustomerId, setEditCustomerId] = useState(project.customer_id);
  const [editProjectType, setEditProjectType] = useState(project.project_type);
  const [editStatus, setEditStatus] = useState(project.status);
  const [editAgreedBasePrice, setEditAgreedBasePrice] = useState(String(toNumber(project.agreed_base_price) ?? 0));
  const [editPriceIncludesVat, setEditPriceIncludesVat] = useState(project.price_includes_vat === true);
  const [editNoCharge, setEditNoCharge] = useState(project.no_charge === true);
  const [editExpensesSeparately, setEditExpensesSeparately] = useState(project.expenses_billed_separately === true);
  const [editProjectManagerId, setEditProjectManagerId] = useState(project.project_manager_id ?? "");
  const [editStartDate, setEditStartDate] = useState(project.start_date ?? "");
  const [editEndDate, setEditEndDate] = useState(project.end_date ?? "");
  const [editNotes, setEditNotes] = useState(project.notes ?? "");
  const [editItemsToMove, setEditItemsToMove] = useState(itemsToMoveToText(project.items_to_move));
  const [editOrigin, setEditOrigin] = useState<MovingEndpointValue>({
    address: project.origin_address ?? "",
    floor: project.origin_floor ?? "",
    hasElevator: boolToElevator(project.origin_has_elevator),
  });
  const [editDestination, setEditDestination] = useState<MovingEndpointValue>({
    address: project.destination_address ?? "",
    floor: project.destination_floor ?? "",
    hasElevator: boolToElevator(project.destination_has_elevator),
  });
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [existingDocuments, setExistingDocuments] = useState<ProjectDocument[]>(projectDocuments);
  const [documentActionError, setDocumentActionError] = useState<string | null>(projectDocumentsError);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);

  useEffect(() => {
    setExistingDocuments(projectDocuments);
  }, [projectDocuments]);

  useEffect(() => {
    setDocumentActionError(projectDocumentsError);
  }, [projectDocumentsError]);

  const mergedCustomerOptions = useMemo(() => {
    const sorted = [...customerOptions].sort((a, b) => a.label.localeCompare(b.label, "he"));
    const selectedMissing = editCustomerId && !sorted.some((customer) => customer.id === editCustomerId);
    if (!selectedMissing) return sorted;
    return [{ id: editCustomerId, label: "לקוח נוכחי" }, ...sorted];
  }, [customerOptions, editCustomerId]);

  async function deleteProjectDocument(documentId: string) {
    if (!documentId || deletingDocumentId) return;
    setDocumentActionError(null);
    setDeletingDocumentId(documentId);
    try {
      const res = await fetch("/api/documents/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document_id: documentId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof json?.error === "string" ? json.error : "מחיקת הקובץ נכשלה.");
      }
      setExistingDocuments((prev) => prev.filter((document) => document.document_id !== documentId));
      router.refresh();
    } catch (error: unknown) {
      setDocumentActionError(toHebrewError(error, "שגיאה לא ידועה"));
    } finally {
      setDeletingDocumentId(null);
    }
  }

  async function saveProjectEdit() {
    if (editSubmitting) return;
    setEditError(null);
    setDocumentActionError(null);

    if (!project.id || !editName.trim() || !editCustomerId) {
      setEditError("יש למלא שדות חובה.");
      return;
    }

    const agreed = editAgreedBasePrice.trim() ? Number(editAgreedBasePrice) : 0;
    if (!Number.isFinite(agreed) || agreed < 0) {
      setEditError("מחיר בסיס אינו תקין.");
      return;
    }

    setEditSubmitting(true);
    try {
      const result = await offlineFetch(
        "/api/projects/update",
        {
          id: project.id,
          customer_id: editCustomerId,
          name: editName.trim(),
          project_type: editProjectType,
          status: editStatus,
          agreed_base_price: editNoCharge ? 0 : agreed,
          actual_price: editNoCharge ? 0 : agreed,
          price_includes_vat: editPriceIncludesVat,
          no_charge: editNoCharge,
          expenses_billed_separately: editExpensesSeparately,
          project_manager_id: editProjectManagerId || null,
          start_date: editStartDate || null,
          end_date: editEndDate || null,
          notes: editNotes.trim() || null,
          items_to_move: textToItemsToMove(editItemsToMove),
          origin_address: editOrigin.address.trim() || null,
          origin_floor: editOrigin.floor.trim() || null,
          origin_has_elevator: elevatorToBool(editOrigin.hasElevator),
          destination_address: editDestination.address.trim() || null,
          destination_floor: editDestination.floor.trim() || null,
          destination_has_elevator: elevatorToBool(editDestination.hasElevator),
        },
        "עדכון פרויקט"
      );

      if (!result.queued) {
        const json = result.ok ? (result.data as { project?: unknown } | null) : null;
        if (!result.ok || !json?.project) {
          setEditError((result.ok ? "עדכון פרויקט נכשל." : result.error) || "עדכון פרויקט נכשל.");
          return;
        }
        // Uploads need a live connection; only attempt them when actually online.
        for (const file of attachmentFiles) {
          await uploadProjectDocument(project.id, file);
        }
      }

      setEditOpen(false);
      setAttachmentFiles([]);
      // Pricing / marking ללא חיוב resolves the "closed unbilled" alert — resync now.
      void resyncAlerts();
      router.refresh();
    } catch (error: unknown) {
      setEditError(toHebrewError(error, "שגיאה לא ידועה"));
    } finally {
      setEditSubmitting(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {project.status === "quote" ? null : (
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href={`/projects/${project.id}/export?mode=worker`} target="_blank" rel="noreferrer">
              <FileText className="h-4 w-4" />
              <span>דף עבודה</span>
            </Link>
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="h-4 w-4" />
          <span>עריכה</span>
        </Button>
        <LogCommunicationButton entityType="project" entityId={project.id} customerId={project.customer_id} defaultTopic="general" />
        <DeleteProjectButton projectId={project.id} projectName={project.name} redirectTo="/projects" size="sm">
          <Trash2 className="h-4 w-4" />
          <span>מחיקה</span>
        </DeleteProjectButton>
      </div>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          if (!open && !editSubmitting) {
            setAttachmentFiles([]);
            setDocumentActionError(projectDocumentsError);
          }
          setEditOpen(open);
        }}
      >
        <AdaptiveDialog size="form2xl">
          <DialogHeader>
            <DialogTitle>עריכת פרויקט</DialogTitle>
            <DialogDescription>עדכון פרטי הפרויקט מתוך מסך הפרטים.</DialogDescription>
          </DialogHeader>

          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void saveProjectEdit();
            }}
          >
            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <label className="text-sm font-medium">שם פרויקט *</label>
                <Input value={editName} onChange={(event) => setEditName(event.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">לקוח *</label>
                <CustomerPicker
                  placeholder="בחירת לקוח..."
                  value={
                    editCustomerId
                      ? {
                          id: editCustomerId,
                          name: mergedCustomerOptions.find((c) => c.id === editCustomerId)?.label ?? "",
                          phone: null,
                        }
                      : null
                  }
                  onChange={(customer) => setEditCustomerId(customer?.id ?? "")}
                />
              </div>
            </AdaptiveGrid>

            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <label className="text-sm font-medium">סוג פרויקט *</label>
                <select
                  value={editProjectType}
                  onChange={(event) => setEditProjectType(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {defaultProjectTypeOptions.map((value) => (
                    <option key={value} value={value}>
                      {projectTypeLabel(value)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">סטטוס *</label>
                <select
                  value={editStatus}
                  onChange={(event) => setEditStatus(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {defaultStatusOptions.map((value) => (
                    <option key={value} value={value}>
                      {statusLabel(value)}
                    </option>
                  ))}
                </select>
              </div>
            </AdaptiveGrid>

            <div className="space-y-1">
              <label className="text-sm font-medium">מחיר בסיס מוסכם</label>
              <CurrencyInput
                value={editNoCharge ? "0" : editAgreedBasePrice}
                onChange={(event) => setEditAgreedBasePrice(event.target.value)}
                disabled={editNoCharge}
              />
              <label className="flex items-center gap-2 pt-1 text-sm">
                <input
                  type="checkbox"
                  checked={editPriceIncludesVat}
                  disabled={editNoCharge}
                  onChange={(event) => setEditPriceIncludesVat(event.target.checked)}
                />
                <span>הוסף מע״מ מעל מחיר הבסיס (הלקוח משלם בסיס + מע״מ)</span>
              </label>
              <label className="flex items-center gap-2 pt-1 text-sm">
                <input
                  type="checkbox"
                  checked={editNoCharge}
                  onChange={(event) => {
                    setEditNoCharge(event.target.checked);
                    if (event.target.checked) setEditPriceIncludesVat(false);
                  }}
                />
                <span>ללא חיוב — תרומה / טובה / ללא תשלום (המחיר יישאר 0)</span>
              </label>
              <div className="text-xs text-muted-foreground">
                כשמסומן — היעד הוא הסכום כולל מע״מ וכל תשלום נזקף במלואו. כשלא — המחיר הוא נטו ותשלום
                רשמי מנכה מע״מ.
              </div>
            </div>

            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <label className="text-sm font-medium">תאריך התחלה</label>
                <DateInput value={editStartDate} onChange={(event) => setEditStartDate(event.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">תאריך סיום</label>
                <DateInput value={editEndDate} onChange={(event) => setEditEndDate(event.target.value)} />
              </div>
            </AdaptiveGrid>

            <div className="space-y-1">
              <label className="text-sm font-medium">מנהל פרויקט</label>
              <select
                value={editProjectManagerId}
                onChange={(event) => setEditProjectManagerId(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">ללא שיוך</option>
                {managerOptions.map((manager) => (
                  <option key={manager.id} value={manager.id}>
                    {manager.label}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editExpensesSeparately}
                onChange={(event) => setEditExpensesSeparately(event.target.checked)}
              />
              <span>חיוב הוצאות בנפרד</span>
            </label>

            <div className="space-y-1">
              <label className="text-sm font-medium">הערות</label>
              <Textarea value={editNotes} onChange={(event) => setEditNotes(event.target.value)} rows={3} />
            </div>

            {isMovingProjectType(editProjectType) ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">כתובות ההובלה</label>
                <AdaptiveGrid variant="formTwo">
                  <MovingEndpointFields
                    title="מוצא (מאיפה)"
                    value={editOrigin}
                    onChange={setEditOrigin}
                    disabled={editSubmitting}
                  />
                  <MovingEndpointFields
                    title="יעד (לאן)"
                    value={editDestination}
                    onChange={setEditDestination}
                    disabled={editSubmitting}
                  />
                </AdaptiveGrid>
              </div>
            ) : null}

            {isMovingProjectType(editProjectType) ? (
              <div className="space-y-1">
                <label className="text-sm font-medium">פריטים להעברה</label>
                <Textarea
                  value={editItemsToMove}
                  onChange={(event) => setEditItemsToMove(event.target.value)}
                  rows={5}
                  placeholder="כל פריט בשורה נפרדת"
                />
                <div className="text-xs text-muted-foreground">אפשר להשאיר ריק. כל שורה תישמר כפריט נפרד.</div>
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="text-sm font-medium">קבצים קיימים</label>
              {existingDocuments.length > 0 ? (
                <div className="space-y-2 rounded-lg border border-border/70 p-3">
                  {existingDocuments.map((document) => {
                    const displayName = document.title?.trim() || document.file_name?.trim() || "קובץ";
                    const uploadedAt = formatDateTime(document.uploaded_at);
                    return (
                      <div
                        key={document.document_id}
                        className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border/60 p-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{displayName}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {[
                              document.document_type ? `סוג: ${document.document_type}` : null,
                              uploadedAt ? `הועלה: ${uploadedAt}` : null,
                              document.uploaded_by_name ? `על ידי: ${document.uploaded_by_name}` : null,
                            ]
                              .filter(Boolean)
                              .join(" • ") || "קובץ מצורף לפרויקט"}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {document.url ? (
                            <Button type="button" variant="outline" size="sm" asChild>
                              <Link href={document.url} target="_blank" rel="noreferrer">
                                פתח
                              </Link>
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={deletingDocumentId === document.document_id || editSubmitting}
                            onClick={() => void deleteProjectDocument(document.document_id)}
                          >
                            {deletingDocumentId === document.document_id ? "מוחק..." : "מחק"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">עדיין אין קבצים שמצורפים לפרויקט.</div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">תמונות / מסמכים חדשים</label>
              <div className="flex items-center gap-2">
                <FileUploadActions
                  files={attachmentFiles}
                  multiple
                  onFilesSelected={setAttachmentFiles}
                  chooseLabel={attachmentFiles.length > 0 ? "הוסף קבצים" : "העלה קבצים"}
                  chooseVariant="outline"
                  size="sm"
                />
                {attachmentFiles.length > 0 ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setAttachmentFiles([])}>
                    נקה בחירה
                  </Button>
                ) : null}
              </div>
              {attachmentFiles.length === 0 ? (
                <div className="text-xs text-muted-foreground">אפשר להעלות קבצים או לצלם תמונה ישירות מהמכשיר.</div>
              ) : null}
            </div>

            {documentActionError ? <p className="text-sm text-destructive">{documentActionError}</p> : null}
            {editError ? <p className="text-sm text-destructive">{editError}</p> : null}

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setEditOpen(false)} disabled={editSubmitting}>
                ביטול
              </Button>
              <Button type="submit" disabled={editSubmitting || deletingDocumentId !== null}>
                {editSubmitting ? "שומר..." : "שמירת שינויים"}
              </Button>
            </DialogFooter>
          </form>
        </AdaptiveDialog>
      </Dialog>
    </>
  );
}
