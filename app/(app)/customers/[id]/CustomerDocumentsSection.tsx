"use client";
import { toHebrewError } from "@/lib/error-messages";

import { Suspense, use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DocumentIcon } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { DocumentRow } from "@/components/ui/document-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { MetaRow } from "@/components/ui/meta-row";
import { NativeSelect } from "@/components/ui/native-select";
import { SECTION_ICON_CLASS, SectionCount } from "@/components/ui/section-card";
import { WaitingBadge } from "@/components/ui/waiting-badge";
import MissingDocumentsChecklist from "@/components/documents/MissingDocumentsChecklist";
import { DOCUMENT_CATEGORIES, getDocumentCategoryLabel, isDocumentCategory } from "@/lib/documents";
import { updateDocumentTag } from "@/lib/documents/updateDocumentTag";
import { offlineFetch } from "@/lib/offline-queue";
import { formatShortDateTime } from "@/lib/date";
import { scheduleDeferredDelete, scheduleDeferredEdit } from "@/lib/undo-engine";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import AddCustomerDocumentButton from "@/app/(app)/customers/[id]/AddCustomerDocumentButton";
import { CountSkeleton, RowsSkeleton, SECTION_IDS, openSection } from "@/app/(app)/customers/[id]/customerSectionUi";
import { OrderRef } from "@/app/(app)/customers/[id]/CustomerOrdersSection";
import type { CustomerDocumentItem, CustomerDocumentsResult } from "@/app/(app)/customers/[id]/customerPageModel";

// מסמכים: what's filed on the customer, directly or through its orders and
// projects. They arrive after the page (with their signed links), into a
// section folded until it's opened. "מסמכים נדרשים" sits at the top whether or
// not anything is filed yet — it used to show only once there was something.
//
// The row opens the file; view and download at its end on hover, and the
// category edit and the delete in its quiet ⋮ (components/ui/document-tile.tsx),
// as on the project page. Each save updates the list in place: an upload shows
// at once (opened from the file on this device until the page is read again),
// a delete hides it for its undo window, a new category is a deferred edit.

const SCOPE = "customer-document";

function DocumentsCount({
  documents,
  addedCount,
  hiddenCount,
}: {
  documents: Promise<CustomerDocumentsResult>;
  addedCount: number;
  hiddenCount: number;
}) {
  const { total } = use(documents);
  return <SectionCount count={Math.max(total + addedCount - hiddenCount, 0)} />;
}

function DocumentsList({
  documents,
  added,
  projectNameById,
  allDocumentsHref,
  onEdit,
  onDelete,
  onHiddenChange,
}: {
  documents: Promise<CustomerDocumentsResult>;
  added: CustomerDocumentItem[];
  projectNameById: Map<string, string>;
  allDocumentsHref: string;
  onEdit: (doc: CustomerDocumentItem) => void;
  onDelete: (doc: CustomerDocumentItem) => void;
  onHiddenChange: (count: number) => void;
}) {
  const result = use(documents);
  const merged = useMemo(() => {
    const ids = new Set(result.documents.map((doc) => doc.id));
    return [...added.filter((doc) => !ids.has(doc.id)), ...result.documents];
  }, [added, result.documents]);
  const shown = useUndoOverlay(merged, (doc) => doc.id, SCOPE);
  const hidden = merged.length - shown.length;
  // The header's count follows a delete within its undo window too.
  useEffect(() => {
    onHiddenChange(hidden);
  }, [hidden, onHiddenChange]);

  return (
    <div className="space-y-3">
      {result.error ? <p className="text-sm text-destructive">{result.error}</p> : null}
      {shown.length === 0 ? (
        <EmptyState dense>אין מסמכים ללקוח זה.</EmptyState>
      ) : (
        <div className="divide-y divide-border/60">
          {shown.map((doc) => (
            <div key={doc.id}>
              <DocumentRow
                name={doc.name}
                fileName={doc.fileName}
                url={doc.url}
                showThumb={false}
                className="-mx-2 rounded-xl border-0 bg-transparent py-2.5 hover:bg-muted/20"
                onEdit={doc.waiting ? undefined : () => onEdit(doc)}
                editLabel="עריכת קטגוריה"
                onDelete={doc.waiting ? undefined : () => onDelete(doc)}
                deleteLabel="מחיקת מסמך"
                confirmDelete={{ title: "מחיקת מסמך", description: `למחוק את ${doc.name}?` }}
                meta={
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {doc.waiting ? <WaitingBadge /> : null}
                    {doc.type ? <Badge variant="neutral">{getDocumentCategoryLabel(doc.type)}</Badge> : null}
                    <MetaRow
                      as="span"
                      className="inline-flex"
                      items={[
                        doc.sourceType === "order" ? (
                          <OrderRef key="ref" orderId={doc.sourceId} />
                        ) : doc.sourceType === "project" ? (
                          projectNameById.get(doc.sourceId) ?? "פרויקט"
                        ) : (
                          "לקוח"
                        ),
                        doc.uploadedAt ? `הועלה ${formatShortDateTime(doc.uploadedAt, "—")}` : null,
                      ]}
                    />
                  </span>
                }
              />
            </div>
          ))}
        </div>
      )}
      {result.total > result.documents.length ? (
        <Button asChild size="sm" variant="outline" className="w-full">
          <Link href={allDocumentsHref}>לכל המסמכים ({result.total})</Link>
        </Button>
      ) : null}
    </div>
  );
}

export default function CustomerDocumentsSection({
  customerId,
  customerName,
  documents,
  projectNames,
}: {
  customerId: string;
  customerName: string;
  documents: Promise<CustomerDocumentsResult>;
  /** The customer's projects by id — a document filed on one names it. */
  projectNames: Map<string, string>;
}) {
  const [added, setAdded] = useState<CustomerDocumentItem[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [presetCategory, setPresetCategory] = useState<string | undefined>(undefined);
  const [checklistKey, setChecklistKey] = useState(0);
  const [editing, setEditing] = useState<CustomerDocumentItem | null>(null);
  const [editValue, setEditValue] = useState("");
  const handleHidden = useCallback((count: number) => setHiddenCount(count), []);

  const allDocumentsHref = `/documents?customer_id=${encodeURIComponent(customerId)}&customer_name=${encodeURIComponent(customerName.trim())}`;

  function deleteDocument(doc: CustomerDocumentItem) {
    scheduleDeferredDelete({
      scope: SCOPE,
      id: doc.id,
      message: "המסמך נמחק",
      onCommit: async () => {
        const result = await offlineFetch("/api/documents/delete", { document_id: doc.id }, "מחיקת מסמך");
        if (!result.queued && !result.ok) return { ok: false, error: toHebrewError(result.error, "מחיקת המסמך נכשלה.") };
        return { ok: true };
      },
    });
  }

  function saveCategory() {
    const doc = editing;
    const value = editValue.trim();
    if (!doc || !value) return;
    setEditing(null);
    scheduleDeferredEdit({
      scope: SCOPE,
      id: doc.id,
      message: "הקטגוריה עודכנה",
      patch: { type: value },
      onCommit: async () => {
        const result = await updateDocumentTag(doc.id, value);
        if (!result.ok) return { ok: false, error: toHebrewError(result.error, "עדכון הקטגוריה נכשל.") };
        return { ok: true };
      },
    });
  }

  return (
    <CollapsibleSection
      id={SECTION_IDS.documents}
      title="מסמכים"
      icon={<DocumentIcon className={SECTION_ICON_CLASS} />}
      summary={
        <Suspense fallback={<CountSkeleton />}>
          <DocumentsCount documents={documents} addedCount={added.length} hiddenCount={hiddenCount} />
        </Suspense>
      }
      action={
        <AddCustomerDocumentButton
          customerId={customerId}
          customerName={customerName}
          open={uploadOpen}
          onOpenChange={(open) => {
            setUploadOpen(open);
            if (!open) setPresetCategory(undefined);
          }}
          presetCategory={presetCategory}
          onUploaded={(docs) => {
            setAdded((prev) => [...docs, ...prev]);
            setChecklistKey((key) => key + 1);
            openSection(SECTION_IDS.documents);
          }}
          onUndone={(ids) => setAdded((prev) => prev.filter((doc) => !ids.includes(doc.id)))}
        />
      }
      contentClassName="space-y-3"
    >
      <MissingDocumentsChecklist
        entityType="customer"
        entityId={customerId}
        refreshKey={checklistKey}
        onUpload={(code) => {
          setPresetCategory(code);
          setUploadOpen(true);
        }}
      />
      <Suspense fallback={<RowsSkeleton count={2} />}>
        <DocumentsList
          documents={documents}
          added={added}
          projectNameById={projectNames}
          allDocumentsHref={allDocumentsHref}
          onEdit={(doc) => {
            setEditing(doc);
            setEditValue(doc.type ?? "");
          }}
          onDelete={deleteDocument}
          onHiddenChange={handleHidden}
        />
      </Suspense>

      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title="עריכת קטגוריה"
        description={editing?.name}
        size="formMd"
        onSubmit={saveCategory}
        submitLabel="שמירה"
        submitDisabled={!editValue.trim()}
      >
        <Field label="קטגוריה">
          <NativeSelect value={editValue} onChange={(e) => setEditValue(e.target.value)} aria-label="קטגוריה">
            <option value="">בחירת קטגוריה</option>
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {editValue.trim() && !isDocumentCategory(editValue.trim()) ? (
              <option value={editValue}>{getDocumentCategoryLabel(editValue)} (נוכחי)</option>
            ) : null}
          </NativeSelect>
        </Field>
      </FormDialog>
    </CollapsibleSection>
  );
}
