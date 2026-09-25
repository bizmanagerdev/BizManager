"use client";

import Link from "next/link";
import { useSetPageTitle } from "@/components/layout/page-title-context";
import Image from "next/image";
import type { ReactNode } from "react";
import { useDeferredValue, useEffect, useMemo, useState, useTransition, useSyncExternalStore, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DownloadIcon, FilterIcon, ChevronDownIcon, DocumentIcon, DeleteIcon, GridIcon, ListIcon, MoreIcon, ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, FolderIcon, ImageIcon, LayersIcon, LinkIcon, ProductIcon, SearchIcon, TagIcon, UploadIcon } from "@/components/ui/icons";
import { MetaRow } from "@/components/ui/meta-row";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import { ViewDialog } from "@/components/ui/view-dialog";
import { toHebrewError } from "@/lib/error-messages";
import { updateDocumentTag } from "@/lib/documents/updateDocumentTag";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getBusinessDomainLabel } from "@/lib/expenses";
import { DomainSelect } from "@/components/financial/DomainSelect";
import { UploadDocumentDialog } from "@/components/documents/UploadDocumentDialog";
import {
  DOCUMENT_CATEGORIES,
  getDocumentCategoryLabel,
  formatFileSize,
  splitFileNameForDisplay,
} from "@/lib/documents";
import {
  fetchDocumentCategories,
  categoryLabel,
  moneyCategoryCodes,
  type DocumentCategoryRow,
} from "@/lib/documents/categories";
import { isUnlinkedMoneyDocument } from "@/lib/documents/moneyLink";
import {
  expiryBadgeTone,
  expiryLabel,
  getExpiryStatus,
  supersededDocumentIds,
  type ExpiryResult,
} from "@/lib/documents/expiry";
import { documentsHe } from "@/lib/i18n/pluralHe";
import { israelDateKey } from "@/lib/timezone";
import { offerVehicleDateSync } from "@/lib/documents/vehicleDateSync";
import { downloadFileName } from "@/lib/documents/downloadName";
import PdfViewer from "@/components/documents/PdfViewer";
import PdfThumbnail from "@/components/documents/PdfThumbnail";
import DocumentsFilterSheet from "@/app/(app)/documents/DocumentsFilterSheet";
import {
  DocumentListRow,
  DocumentTile,
} from "@/app/(app)/documents/DocumentsArchiveClient.ui";
import LinkDocumentToLedgerDialog from "@/components/documents/LinkDocumentToLedgerDialog";
import AssignDocumentDialog from "@/components/documents/AssignDocumentDialog";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import DocumentCategoriesEditor from "@/components/documents/DocumentCategoriesEditor";
import { DateInput } from "@/components/ui/date-input";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { scheduleDeferredDelete, scheduleDeferredEdit } from "@/lib/undo-engine";
import type {
  ArchiveTargetOption,
  DocumentArchiveFilters,
  DocumentArchiveItem,
} from "@/lib/documents/archive";
import {
  GROUP_BY_OPTIONS,
  SORT_BY_OPTIONS,
  SYSTEM_CATEGORY_FILTER,
  UNCATEGORIZED_FILTER,
  collapseSets,
  compareGroups,
  documentYear,
  entityChipParts,
  facetTriggerLabel,
  fileKindLabel,
  formatDate,
  groupDropTarget,
  groupHref,
  groupLabel,
  isControlledCategory,
  normalizeText,
  packGroups,
  setKeyFor,
  sortDocuments,
  type FacetOption,
  type GroupDropTarget,
} from "@/app/(app)/documents/DocumentsArchiveClient.helpers";
import {
  ENTITY_FACETS,
  EXPIRY_FACETS,
  prefsStore,
  viewModeStore,
} from "@/app/(app)/documents/DocumentsArchiveClient.prefs";

const FIELD_LABEL = "text-xs text-[rgb(var(--primary-6))]";

/**
  * An arrow floating over the preview. Hidden until pointed at — and always
  * there on a touch screen, where there is no hover to reveal it with.
  */
const ARROW_BUTTON =
  "absolute inset-y-0 z-10 my-auto h-9 w-9 rounded-full border-[rgb(var(--secondary-9))] bg-background/80 opacity-0 shadow-sm transition-opacity hover:bg-background focus-visible:opacity-100 group-hover/preview:opacity-100 [@media(hover:none)]:opacity-100";

/** Sizes read from storage, kept per document for the life of the page. */
const fileSizeCache = new Map<string, number | null>();

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

function SelectField({
  value,
  onChange,
  children,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <NativeSelect
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      className={className}
    >
      {children}
    </NativeSelect>
  );
}

export default function DocumentsArchiveClient({
  documents: documentsProp,
  error,
  initialFilters,
  canManageCategories = false,
  focusDocumentId = null,
  projectOptions,
  propertyOptions,
  customerOptions = [],
  orderOptions = [],
  taskOptions = [],
  vehicleTagOptions = [],
  totalDocuments,
  isTruncated,
}: {
  documents: DocumentArchiveItem[];
  error: string | null;
  initialFilters: DocumentArchiveFilters;
  /** Admins get the category registry from the header, not a panel bolted to
   *  the bottom of the archive. */
  canManageCategories?: boolean;
  /** From `?focus=<id>` — open that document's preview straight away. */
  focusDocumentId?: string | null;
  projectOptions: ArchiveTargetOption[];
  propertyOptions: ArchiveTargetOption[];
  vehicleTagOptions?: ArchiveTargetOption[];
  /** Every customer, for filing — not only the ones that already own a file. */
  customerOptions?: ArchiveTargetOption[];
  orderOptions?: ArchiveTargetOption[];
  taskOptions?: ArchiveTargetOption[];
  totalDocuments: number;
  isTruncated: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const documents = useUndoOverlay(documentsProp, (d) => d.id, "document");
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
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadProjectOptions, setUploadProjectOptions] = useState<ArchiveTargetOption[]>(projectOptions);
  const [editDialogDoc, setEditDialogDoc] = useState<DocumentArchiveItem | null>(null);
  const [editTagValue, setEditTagValue] = useState("");
  const [editValidUntil, setEditValidUntil] = useState("");
  // Which categories want an expiry is a registry decision, so the edit dialog
  // reads it rather than hardcoding the list.
  const [categoryRows, setCategoryRows] = useState<DocumentCategoryRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchDocumentCategories()
      .then((rows) => {
        if (!cancelled) setCategoryRows(rows);
      })
      .catch(() => setCategoryRows([]));
    return () => {
      cancelled = true;
    };
  }, []);
  const editTracksExpiry = categoryRows.some(
    (c) => c.code === editTagValue.trim() && c.tracks_expiry
  );
  const moneyCodes = useMemo(() => moneyCategoryCodes(categoryRows), [categoryRows]);
  const [linkDoc, setLinkDoc] = useState<DocumentArchiveItem | null>(null);
  const [onlyUnlinkedMoney, setOnlyUnlinkedMoney] = useState(
    initialFilters.money === "unlinked"
  );
  const [onlyExpiring, setOnlyExpiring] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [assignDoc, setAssignDoc] = useState<DocumentArchiveItem | null>(null);



  // Sort applies inside each section (and to the flat search list), so the
  // grouping still decides WHAT is together and this decides the order within.

  // The component is server-rendered, so reading localStorage in a lazy
  // initializer would hydrate to a different value than the server produced.
  // useSyncExternalStore is the one API built for exactly this: the server
  // snapshot is always "list", the client reads the real preference.
  const viewMode = useSyncExternalStore(
    viewModeStore.subscribe,
    viewModeStore.get,
    () => "grid" as const
  );
  const changeViewMode = viewModeStore.set;
  // "Which kind of thing is this attached to" — the question people actually
  // ask. Counted over every document so the numbers double as a health check.
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  // Counted, not a boolean: dragging over a child fires dragleave on the parent,
  // so a flag flickers the overlay off while the pointer is still inside.
  const dragDepth = useRef(0);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  function hasFiles(event: React.DragEvent) {
    return Array.from(event.dataTransfer?.types ?? []).includes("Files");
  }

  function handleDragEnter(event: React.DragEvent) {
    if (!hasFiles(event)) return;
    dragDepth.current += 1;
    setIsDraggingFiles(true);
  }

  function handleDragLeave(event: React.DragEvent) {
    if (!hasFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDraggingFiles(false);
  }

  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [dropSeed, setDropSeed] = useState<GroupDropTarget | null>(null);

  function handleDrop(event: React.DragEvent) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setIsDraggingFiles(false);
    setDragOverGroup(null);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    setDroppedFiles(files);
    setUploadDialogOpen(true);
  }

  function handleGroupDrop(event: React.DragEvent, target: GroupDropTarget | null) {
    if (!hasFiles(event)) return;
    // Stops the page-wide handler from clearing the seed straight after.
    event.stopPropagation();
    setDropSeed(target);
    handleDrop(event);
  }

  const prefs = useSyncExternalStore(
    prefsStore.subscribe,
    prefsStore.get,
    prefsStore.getServerSnapshot
  );
  const attachedTo = useMemo(() => new Set(prefs.attachedTo), [prefs.attachedTo]);
  const groupBy = prefs.groupBy;
  const sortBy = prefs.sortBy;
  const typeChips = useMemo(() => new Set(prefs.typeChips), [prefs.typeChips]);
  const expiryChips = useMemo(() => new Set(prefs.expiry), [prefs.expiry]);

  const setAttachedTo = (next: Set<string>) =>
    prefsStore.set({ ...prefsStore.get(), attachedTo: Array.from(next) });

  function toggleAttachedTo(key: string) {
    const next = new Set(attachedTo);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setAttachedTo(next);
  }
  const setGroupBy = (next: string) => prefsStore.set({ ...prefsStore.get(), groupBy: next });
  const setSortBy = (next: string) => prefsStore.set({ ...prefsStore.get(), sortBy: next });
  const setTypeChips = (next: Set<string>) =>
    prefsStore.set({ ...prefsStore.get(), typeChips: Array.from(next) });
  const setExpiryChips = (next: Set<string>) =>
    prefsStore.set({ ...prefsStore.get(), expiry: Array.from(next) });

  function toggleExpiryChip(key: string) {
    const next = new Set(expiryChips);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpiryChips(next);
  }

  function toggleTypeChip(code: string) {
    const next = new Set(typeChips);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setTypeChips(next);
  }


  function matchesFacet(doc: DocumentArchiveItem, facet: string) {
    switch (facet) {
      case "project": return doc.projects.length > 0;
      case "vehicle": return doc.tags.length > 0;
      case "property": return doc.properties.length > 0;
      case "customer": return doc.customers.length > 0;
      case "order": return doc.orders.length > 0;
      case "task": return doc.tasks.length > 0;
      case "user": return doc.entity_types.includes("user");
      case "unlinked":
        return doc.linked_entities.length === 0 && doc.tags.length === 0 && !doc.no_link_needed;
      default: return true;
    }
  }


  // What is wrong with THIS document, in the words we would use about it — or
  // null when nothing is. Rendered as a dot on the card, so a document that
  // needs a person is spotted while browsing rather than in a separate mode.
  const attentionReason = useCallback(
    (doc: DocumentArchiveItem): string | null => {
      const soon = new Date();
      soon.setDate(soon.getDate() + 30);
      const soonIso = soon.toISOString().slice(0, 10);
      if (isUnlinkedMoneyDocument(doc.document_type, doc.entity_types, moneyCodes)) {
        return "מסמך כספי שאינו משויך לתנועה";
      }
      if (!(doc.document_type ?? "").trim()) return "ללא קטגוריה";
      if (doc.valid_until && doc.valid_until <= soonIso) return "התוקף עומד לפוג";
      if (doc.linked_entities.length === 0 && doc.tags.length === 0 && !doc.no_link_needed) {
        return "ללא שיוך";
      }
      return null;
    },
    [moneyCodes]
  );
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
  // Re-read from the live list by id rather than holding the object we opened.
  // Editing a category used to change nothing on screen until the viewer was
  // closed and reopened — the edit landed, the snapshot in state did not, and
  // the toast said "done" over a panel still showing the old value.
  const activePreviewDoc = useMemo(() => {
    const opened = previewDoc ?? focusedDoc;
    if (!opened) return null;
    return documents.find((doc) => doc.id === opened.id) ?? opened;
  }, [previewDoc, focusedDoc, documents]);

  const expiryByDocument = useMemo(() => {
    const today = israelDateKey();
    const leadByCode = new Map(
      categoryRows.filter((row) => row.tracks_expiry).map((row) => [row.code, row.expiry_lead_days])
    );
    const result = new Map<string, ExpiryResult>();
    if (leadByCode.size === 0) return result;

    const tracked = documents.filter((doc) => leadByCode.has((doc.document_type ?? "").trim()));
    const superseded = supersededDocumentIds(
      tracked.map((doc) => ({
        id: doc.id,
        category: (doc.document_type ?? "").trim(),
        validUntil: doc.valid_until,
        // A car holds its papers through its tag; everything else through its
        // first link. Empty means unfiled, and unfiled never supersedes.
        entityKey: doc.tags[0]
          ? `vehicle:${doc.tags[0].id}`
          : doc.linked_entities[0]
            ? `${doc.linked_entities[0].type}:${doc.linked_entities[0].id}`
            : "",
      }))
    );

    for (const doc of tracked) {
      const lead = leadByCode.get((doc.document_type ?? "").trim()) ?? 30;
      result.set(doc.id, getExpiryStatus(doc.valid_until, lead, superseded.has(doc.id), today));
    }
    return result;
  }, [documents, categoryRows]);

  /** Null for a category that does not expire — the question does not apply. */
  const expiryOf = useCallback(
    (doc: DocumentArchiveItem): ExpiryResult | null => expiryByDocument.get(doc.id) ?? null,
    [expiryByDocument]
  );

  /** What the filters and every count on this page actually ran over. */
  const loadedDocumentCount = isTruncated ? documents.length : totalDocuments;

  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = normalizeText(deferredQuery);




  // Deliberately a count, not a measurement: an overflow observer would reflow
  // the row as you filter, which is the thing this is meant to prevent.
  const MAX_INLINE_PILLS = 3;

  const hasActiveFilters =
    Boolean(normalizedQuery) ||
    onlyExpiring ||
    onlyUnlinkedMoney ||
    attachedTo.size > 0 ||
    typeChips.size > 0 ||
    expiryChips.size > 0;



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

  const passesFilters = useCallback(
    (doc: DocumentArchiveItem, ignore?: "facet" | "type" | "expiry") => {
      if (normalizedQuery && !doc.search_text.includes(normalizedQuery)) return false;
      if (businessDomain && !doc.business_domains.includes(businessDomain)) return false;
      if (onlyUnlinkedMoney && !isUnlinkedMoneyDocument(doc.document_type, doc.entity_types, moneyCodes)) {
        return false;
      }
      if (
        ignore !== "facet" &&
        attachedTo.size > 0 &&
        !Array.from(attachedTo).some((key) => matchesFacet(doc, key))
      ) {
        return false;
      }
      if (ignore !== "type" && typeChips.size > 0 && !typeChips.has(doc.document_type ?? "")) {
        return false;
      }
      if (ignore !== "expiry" && expiryChips.size > 0) {
        const expiry = expiryByDocument.get(doc.id);
        if (!expiry || expiry.status === "superseded") return false;
        const wanted =
          (expiryChips.has("expired") &&
            (expiry.status === "expired" || expiry.status === "today")) ||
          (expiryChips.has("soon") && expiry.status === "soon") ||
          (expiryChips.has("undated") && expiry.status === "missing");
        if (!wanted) return false;
      }
      if (onlyExpiring) {
        const expiry = expiryByDocument.get(doc.id);
        if (!expiry || !["expired", "today", "soon"].includes(expiry.status)) return false;
      }
      if (documentType) {
        if (documentType === SYSTEM_CATEGORY_FILTER) {
          // System bucket: any present type that isn't a controlled category.
          if (!doc.document_type || isControlledCategory(doc.document_type)) return false;
        } else if (documentType === UNCATEGORIZED_FILTER) {
          if ((doc.document_type ?? "").trim()) return false;
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
    },
    [
    businessDomain,
    customerId,
    documentType,
    fileKind,
    moneyCodes,
    onlyUnlinkedMoney,
    onlyExpiring,
    attachedTo,
    typeChips,
    expiryChips,
    expiryByDocument,
    normalizedQuery,
    projectId,
    propertyId,
    showProjectFilter,
    showPropertyFilter,
      tagFilter,
      yearFilter,
    ]
  );

  const filteredDocuments = useMemo(
    () => documents.filter((doc) => passesFilters(doc)),
    [documents, passesFilters]
  );

  const [previewSize, setPreviewSize] = useState<number | null>(null);
  useEffect(() => {
    const url = activePreviewDoc?.url;
    const id = activePreviewDoc?.id;
    if (!url || !id) return;
    const cached = fileSizeCache.get(id);
    if (cached !== undefined) {
      setPreviewSize(cached);
      return;
    }
    let cancelled = false;
    fetch(url, { method: "HEAD" })
      .then((response) => {
        const header = response.headers.get("content-length");
        const size = header ? Number(header) : null;
        const value = size && Number.isFinite(size) ? size : null;
        fileSizeCache.set(id, value);
        if (!cancelled) setPreviewSize(value);
      })
      .catch(() => {
        fileSizeCache.set(id, null);
        if (!cancelled) setPreviewSize(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activePreviewDoc?.url, activePreviewDoc?.id]);

  const previewSet = useMemo(() => {
    if (!activePreviewDoc) return [];
    const key = setKeyFor(activePreviewDoc);
    if (!key) return [];
    const members = filteredDocuments.filter((doc) => setKeyFor(doc) === key);
    return members.length > 1 ? members : [];
  }, [activePreviewDoc, filteredDocuments]);

  const previewIndex = activePreviewDoc
    ? filteredDocuments.findIndex((doc) => doc.id === activePreviewDoc.id)
    : -1;
  const previousPreviewDoc = previewIndex > 0 ? filteredDocuments[previewIndex - 1] : null;
  const swipeStartX = useRef<number | null>(null);

  function handleViewerTouchStart(event: React.TouchEvent) {
    swipeStartX.current = event.touches[0]?.clientX ?? null;
  }

  function handleViewerTouchEnd(event: React.TouchEvent) {
    const start = swipeStartX.current;
    swipeStartX.current = null;
    if (start === null) return;
    const delta = (event.changedTouches[0]?.clientX ?? start) - start;
    // Below this it is a tap or a scroll, not a deliberate swipe.
    if (Math.abs(delta) < 48) return;
    // RTL: dragging toward the start (right) goes back, toward the end forward.
    const target = delta > 0 ? previousPreviewDocRef.current : nextPreviewDocRef.current;
    if (target) setPreviewDoc(target);
  }
  const nextPreviewDoc =
    previewIndex >= 0 && previewIndex < filteredDocuments.length - 1
      ? filteredDocuments[previewIndex + 1]
      : null;

  // Refs so the touch/key handlers always see the CURRENT neighbours without
  // being re-created (and re-bound) on every navigation.
  const previousPreviewDocRef = useRef(previousPreviewDoc);
  const nextPreviewDocRef = useRef(nextPreviewDoc);
  previousPreviewDocRef.current = previousPreviewDoc;
  nextPreviewDocRef.current = nextPreviewDoc;
  const activePreviewDocRef = useRef<DocumentArchiveItem | null>(null);
  activePreviewDocRef.current = activePreviewDoc;

  useEffect(() => {
    if (!activePreviewDoc) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowRight" && previousPreviewDocRef.current) {
        setPreviewDoc(previousPreviewDocRef.current);
      } else if (event.key === "ArrowLeft" && nextPreviewDocRef.current) {
        setPreviewDoc(nextPreviewDocRef.current);
      } else if (event.key === "d" || event.key === "D") {
        const current = activePreviewDocRef.current;
        if (current) {
          event.preventDefault();
          void downloadOne(current);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePreviewDoc]);

  // Counted against everything EXCEPT the axis being counted, so each number
  // says how many of what you are currently looking at.
  const expiryFacetCounts = useMemo(() => {
    const counts = { expired: 0, soon: 0, undated: 0 };
    for (const doc of documents) {
      if (!passesFilters(doc, "expiry")) continue;
      const expiry = expiryByDocument.get(doc.id);
      if (!expiry || expiry.status === "superseded") continue;
      if (expiry.status === "expired" || expiry.status === "today") counts.expired += 1;
      else if (expiry.status === "soon") counts.soon += 1;
      else if (expiry.status === "missing") counts.undated += 1;
    }
    return counts;
  }, [documents, expiryByDocument, passesFilters]);

  const facetCounts = useMemo(() => {
    const counts: Record<string, number> = {
      project: 0, vehicle: 0, property: 0, customer: 0, order: 0, task: 0, user: 0, unlinked: 0, "": 0,
    };
    for (const doc of documents) {
      if (!passesFilters(doc, "facet")) continue;
      counts[""] += 1;
      for (const key of ["project", "vehicle", "property", "customer", "order", "task", "user", "unlinked"]) {
        if (matchesFacet(doc, key)) counts[key] += 1;
      }
    }
    return counts;
  }, [documents, passesFilters]);

  const topCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const doc of documents) {
      if (!passesFilters(doc, "type")) continue;
      const code = (doc.document_type ?? "").trim();
      if (!code) continue;
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    return Array.from(counts, ([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [documents, passesFilters]);

  // Clearing a backlog one dialog at a time is the slow path; selection is the
  // fast one. Held as ids so it survives a refetch reordering the list.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false);
  const [bulkCategoryValue, setBulkCategoryValue] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  /** Mark (or unmark) a document as deliberately owner-less, so it stops being
   *  counted as unfiled without inventing a link to an entity it does not
   *  belong to. */
  const toggleNoLinkNeeded = useCallback(async (doc: DocumentArchiveItem) => {
    const next = !doc.no_link_needed;
    const { error } = await createSupabaseBrowserClient()
      .from("documents")
      .update({ no_link_needed: next })
      .eq("id", doc.id);
    if (error) {
      // Pre-migration the column does not exist yet; say so rather than
      // failing silently.
      toast.error(
        error.code === "42703"
          ? "צריך להריץ את המיגרציה שמוסיפה את השדה."
          : toHebrewError(error.message, "העדכון נכשל.")
      );
      return;
    }
    toast.success(next ? "סומן כלא דורש שיוך" : "הוחזר לרשימת ללא שיוך");
    startTransition(() => { router.refresh(); });
  }, [router]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Everything the triage banner counts, in one list: unfiled first (the
  // harder decision), then merely uncategorised.
  const selectedDocs = useMemo(
    () => filteredDocuments.filter((doc) => selectedIds.has(doc.id)),
    [filteredDocuments, selectedIds]
  );

  async function bulkSetCategory() {
    if (selectedDocs.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const value = bulkCategoryValue.trim();
      const results = await Promise.all(
        selectedDocs.map((doc) => updateDocumentTag(doc.id, value))
      );
      const failed = results.filter((r) => !r.ok).length;
      if (failed === results.length) {
        toast.error("עדכון הקטגוריה נכשל.");
        return;
      }
      toast.success(failed > 0 ? `${results.length - failed} עודכנו, ${failed} נכשלו` : "הקטגוריה עודכנה");
      setBulkCategoryOpen(false);
      setSelectedIds(new Set());
      startTransition(() => { router.refresh(); });
    } finally {
      setBulkBusy(false);
    }
  }

  async function downloadOne(doc: DocumentArchiveItem) {
    if (!doc.url) {
      toast.error("לא נמצא קובץ להורדה.");
      return;
    }
    try {
      const response = await fetch(doc.url);
      if (!response.ok) throw new Error("fetch failed");
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = downloadFileName(doc);
      anchor.click();
      URL.revokeObjectURL(href);
    } catch {
      toast.error("ההורדה נכשלה.");
    }
  }

  function bulkDelete() {
    if (selectedDocs.length === 0) return;
    const targets = selectedDocs;
    setSelectedIds(new Set());
    // Same deferred-delete engine the single row uses, so the undo toast and
    // the optimistic removal behave identically for one document or twenty.
    for (const doc of targets) {
      scheduleDeferredDelete({
        scope: "document",
        id: doc.id,
        message: targets.length === 1 ? "המסמך נמחק" : `${targets.length} מסמכים נמחקו`,
        onCommit: async () => {
          const response = await fetch("/api/documents/delete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ document_id: doc.id }),
          });
          if (!response.ok) {
            const json = await response.json().catch(() => ({}));
            return { ok: false, error: toHebrewError((json as { error?: string })?.error, "מחיקת המסמך נכשלה.") };
          }
          startTransition(() => { router.refresh(); });
          return { ok: true };
        },
      });
    }
  }



  // The bar carries the page's name on a phone, which is why the h1 below it
  // is hidden there — and the page runs its own search, so the bar's magnifier
  // stands down rather than sitting a thumb away searching something else.
  useSetPageTitle("מסמכים", undefined, undefined, false, true);

  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  /** Turned on by a long press; leaving the selection empty turns it back off. */
  const [selectionMode, setSelectionMode] = useState(false);
  /** What the "סינון" badge counts: facets, not the search box beside it. */
  const activeFilterCount = attachedTo.size + typeChips.size + expiryChips.size;

  const activePillCount =
    attachedTo.size + typeChips.size + expiryChips.size + (normalizedQuery ? 1 : 0);
  const showPills = activePillCount > 0 && activePillCount <= MAX_INLINE_PILLS;

  const scopeOptions: FacetOption[] = useMemo(
    () =>
      ENTITY_FACETS.filter((facet) => facet.key !== "")
        .map((facet) => ({
          key: facet.key,
          label: facet.label,
          count: facetCounts[facet.key] ?? 0,
        }))
        .filter((facet) => facet.count > 0 || attachedTo.has(facet.key)),
    [facetCounts, attachedTo]
  );

  const typeOptions: FacetOption[] = useMemo(
    () =>
      topCategories.map((entry) => ({
        key: entry.code,
        label: categoryLabel(categoryRows, entry.code),
        count: entry.count,
      })),
    [topCategories, categoryRows]
  );

  const groupedDocuments = useMemo(() => {
    // A query is a relevance question, not a filing question — grouping the
    // hits by entity buries them behind section headers.
    if (normalizedQuery) {
      const hits = sortDocuments(filteredDocuments, sortBy);
      return [{ label: "תוצאות חיפוש", href: null, drop: null, items: hits, sets: collapseSets(hits) }];
    }
    const map = new Map<string, DocumentArchiveItem[]>();
    for (const doc of filteredDocuments) {
      const label = groupLabel(groupBy, doc);
      const items = map.get(label) ?? [];
      items.push(doc);
      map.set(label, items);
    }

    return Array.from(map.entries())
      .map(([label, items]) => ({
        label,
        href: groupHref(groupBy, items[0]!),
        drop: groupDropTarget(groupBy, items[0]!),
        items,
      }))
      // Collapsed ONCE per group. This used to run on every read — for the span
      // of the tray, for its column count, and again for the cards — six passes
      // over every group on every render, which is what made a thousand
      // documents crawl.
      .map((group) => {
        const sorted = sortDocuments(group.items, sortBy);
        return { ...group, items: sorted, sets: collapseSets(sorted) };
      })
      .sort((a, b) => {
        // The unfiled buckets are always last, whatever the sort.
        const aLast = a.label === "ללא שיוך" || a.label === "ללא קטגוריה";
        const bLast = b.label === "ללא שיוך" || b.label === "ללא קטגוריה";
        if (aLast !== bLast) return aLast ? 1 : -1;
        return compareGroups(a, b, sortBy);
      });
  }, [filteredDocuments, groupBy, normalizedQuery, sortBy]);

  const GROUP_PREVIEW_SIZE = 8;
  // One row in the grid; the list can afford more before it needs a cap.
  const [gridColumns, setGridColumns] = useState(4);
  const measureGrid = useCallback((node: HTMLDivElement | null) => {
    if (!node || typeof ResizeObserver === "undefined") return;
    const read = () => {
      const tracks = window.getComputedStyle(node).gridTemplateColumns;
      const count = tracks.split(" ").filter(Boolean).length;
      if (count > 0) setGridColumns(count);
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const gridPreviewSize = Math.max(2, gridColumns * 2);

  // Grouping by שיוך produces a long tail of small groups, and a full-width
  // section for two cards wastes most of a row. Consecutive small groups are
  // collected so they can share one row — their position in the sequence is
  // preserved, so this is layout only, not a reordering.
  //
  // A group earns a full-width row by FILLING one, measured in CARDS rather
  // than documents: four photos from one upload are a single card, and giving
  // that group a row of its own left most of the row empty.
  const groupRuns = useMemo(() => {
    type Group = (typeof groupedDocuments)[number];
    const runs: Array<{ kind: "full"; group: Group } | { kind: "compact"; groups: Group[] }> = [];
    const columns = Math.max(1, gridColumns);
    for (const group of groupedDocuments) {
      // List rows are full-width by nature, so only the grid packs.
      const cards =
        viewMode === "grid" ? group.sets.length : Number.MAX_SAFE_INTEGER;
      if (cards >= columns) {
        runs.push({ kind: "full", group });
        continue;
      }
      const last = runs[runs.length - 1];
      if (last && last.kind === "compact") last.groups.push(group);
      else runs.push({ kind: "compact", groups: [group] });
    }
    for (const run of runs) {
      if (run.kind !== "compact" || run.groups.length < 2) continue;
      const spans = run.groups.map((group) =>
        Math.min(group.sets.length, columns)
      );
      run.groups = packGroups(spans, columns, 6).map((index) => run.groups[index]!);
    }
    return runs;
  }, [groupedDocuments, gridColumns, viewMode]);

  // One section, rendered either as a full-width block or — when it is small
  // enough to share a row with its neighbours — sized to its own cards.
  const rowContext = useMemo(
    () => ({
      groupBy,
      normalizedQuery,
      moneyCodes,
      categoryRows,
      selectedIds,
      toggleSelected,
      typeChips,
      expiryOf,
      attentionReason,
      selectionMode,
      onEnterSelection: (doc: DocumentArchiveItem) => {
        setSelectionMode(true);
        toggleSelected(doc.id);
      },
      onPreview: setPreviewDoc,
      onAssign: setAssignDoc,
      onToggleNoLinkNeeded: (doc: DocumentArchiveItem) => void toggleNoLinkNeeded(doc),
      onEditCategory: (doc: DocumentArchiveItem) => {
        setEditDialogDoc(doc);
        setEditTagValue(doc.document_type ?? "");
        setEditValidUntil(doc.valid_until ?? "");
      },
      onEditDomain: (doc: DocumentArchiveItem) => {
        setEditDomainDoc(doc);
        setEditDomainValue(doc.business_domains[0] ?? "");
      },
      onLinkToLedger: setLinkDoc,
      onDelete: setDeleteDialogDoc,
    }),
    [
      groupBy,
      normalizedQuery,
      moneyCodes,
      categoryRows,
      selectedIds,
      toggleSelected,
      typeChips,
      expiryOf,
      attentionReason,
      toggleNoLinkNeeded,
      selectionMode,
    ]
  );

  /** The one category a tray's documents all share, or null when they differ. */
  const groupUniformCategory = useCallback((items: DocumentArchiveItem[]): string | null => {
    if (items.length === 0) return null;
    const first = getDocumentCategoryLabel(items[0]!.document_type).trim();
    if (!first) return null;
    for (const doc of items) {
      if (getDocumentCategoryLabel(doc.document_type).trim() !== first) return null;
    }
    return first;
  }, []);

  const renderGroup = (group: (typeof groupedDocuments)[number], compact: boolean) => (
          <section
            key={group.label}
            className={
              compact
                ? "contents"
                : "mt-4 rounded-xl bg-[rgb(var(--tray))] p-3 first:mt-0"
            }
          >
            {dragOverGroup === group.label ? (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-background/70">
                <span className="rounded-lg bg-background px-2 py-1 text-center text-xs font-medium shadow">
                  שחרר כדי לשייך ל־{group.label}
                </span>
              </div>
            ) : null}
            <div
              onDragOver={(event) => {
                if (!hasFiles(event)) return;
                event.preventDefault();
                setDragOverGroup(group.label);
              }}
              onDragLeave={() =>
                setDragOverGroup((current) => (current === group.label ? null : current))
              }
              onDrop={(event) => handleGroupDrop(event, group.drop)}
              className={
                compact
                  ? `relative grid min-w-0 grid-rows-subgrid rounded-xl bg-[rgb(var(--tray))] px-2 @[40em]:px-3 ${
                      group.sets.length > 1 ? "col-span-2 @[40em]:col-auto" : ""
                    } ${dragOverGroup === group.label ? "border-2 border-secondary" : ""}`
                  : dragOverGroup === group.label
                    ? "relative border-2 border-secondary"
                    : "relative"
              }
              style={
                compact
                  ? {
                      gridColumn: `span ${Math.min(
                        group.sets.length,
                        Math.max(1, gridColumns)
                      )}`,
                      gridRow: "span 2",
                    }
                  : undefined
              }
            >
              <div
                className={
                  compact
                    ? "flex min-h-9 items-end justify-between gap-2 pt-3"
                    : "mb-3 flex flex-wrap items-center justify-between gap-2"
                }
              >
                <div className={compact ? "flex items-end gap-2" : "flex items-center gap-2"}>
                  <h2 className="text-[0.8rem] font-medium leading-snug @[40em]:text-base [overflow-wrap:anywhere]">
                    {group.href ? (
                      <Link href={group.href} className="hover:text-secondary hover:underline">
                        {group.label}
                      </Link>
                    ) : (
                      group.label
                    )}
                  </h2>
                </div>
                {compact ? null : (
                  <span className="text-xs text-muted-foreground">
                    {documentsHe(group.items.length)}
                  </span>
                )}
              </div>
            <div
              className={
                viewMode === "grid"
                  ? compact
                    ? "space-y-3 pb-3"
                    : "space-y-3 pt-1"
                  : "space-y-0 pt-1"
              }
            >
              {viewMode === "grid" ? (
                <div
                  dir="rtl"
                  className="grid gap-2 [grid-template-columns:repeat(2,minmax(0,1fr))] @[40em]:[grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]"
                  style={
                    compact
                      ? {
                          gridTemplateColumns: `repeat(${Math.min(
                            group.sets.length,
                            Math.max(1, gridColumns)
                          )}, minmax(0, 1fr))`,
                        }
                      : undefined
                  }
                >
                  {(expandedGroups.has(group.label)
                    ? group.sets
                    : group.sets.slice(0, gridPreviewSize)
                  ).map(({ lead: doc, members }) => (
                    <DocumentTile
                      key={doc.id}
                      doc={doc}
                      members={members}
                      groupLabel={group.label}
                      uniformCategoryLabel={groupUniformCategory(group.items)}
                      KindIcon={fileKindIcon(doc.file_kind)}
                      {...rowContext}
                    />
                  ))}
                </div>
              ) : null}
              {viewMode === "list" ? (
              <>
              {(expandedGroups.has(group.label)
                ? group.items
                : group.items.slice(0, GROUP_PREVIEW_SIZE)
              ).map((doc) => (
                <DocumentListRow
                  key={doc.id}
                  doc={doc}
                  groupLabel={group.label}
                  KindIcon={fileKindIcon(doc.file_kind)}
                  {...rowContext}
                />
              ))}
              </>
              ) : null}
              {(viewMode === "grid" ? group.sets.length : group.items.length) >
                (viewMode === "grid" ? gridPreviewSize : GROUP_PREVIEW_SIZE) &&
              !expandedGroups.has(group.label) ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() =>
                    setExpandedGroups((prev) => new Set(prev).add(group.label))
                  }
                >
                  הצג הכל ({group.items.length})
                </Button>
              ) : null}
            </div>
            </div>
          </section>
  );


  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());


  function resetFilters() {
    setQuery("");
    setBusinessDomain("");
    setDocumentType("");
    setCustomerId("");
    setProjectId("");
    setPropertyId("");
    setFileKind("");
    setYearFilter("");
    setOnlyUnlinkedMoney(false);
    setOnlyExpiring(false);
    setTagFilter("");
    prefsStore.set({
      ...prefsStore.get(),
      attachedTo: [],
      typeChips: [],
      expiry: [],
      groupBy: "entity",
    });
  }

  function saveTag() {
    if (!editDialogDoc) return;
    const target = editDialogDoc;
    const nextValue = editTagValue.trim();
    // A category that does not track expiry must not keep a stale date around.
    const nextValidUntil = editTracksExpiry ? editValidUntil.trim() : "";
    setEditDialogDoc(null);
    setEditTagValue("");
    setEditValidUntil("");
    scheduleDeferredEdit({
      scope: "document",
      id: target.id,
      message: "הקטגוריה עודכנה",
      patch: { document_type: nextValue || null, valid_until: nextValidUntil || null },
      onCommit: async () => {
        const result = await updateDocumentTag(target.id, nextValue, nextValidUntil);
        if (!result.ok) return { ok: false, error: toHebrewError(result.error, "עדכון הקטגוריה נכשל.") };
        startTransition(() => { router.refresh(); });
        if (nextValidUntil) {
          const vehicle = target.tags[0];
          if (vehicle) {
            void offerVehicleDateSync({
              category: nextValue || null,
              vehicleTagId: vehicle.id,
              vehicleLabel: vehicle.label,
              date: nextValidUntil,
              onUpdated: () => startTransition(() => { router.refresh(); }),
            });
          }
        }
        return { ok: true };
      },
    });
  }

  function saveDomain() {
    if (!editDomainDoc) return;
    const target = editDomainDoc;
    const nextValue = editDomainValue.trim();
    if (!nextValue) {
      toast.error("יש לבחור תחום");
      return;
    }
    setEditDomainDoc(null);
    setEditDomainValue("");
    scheduleDeferredEdit({
      scope: "document",
      id: target.id,
      message: "התחום עודכן",
      patch: { business_domains: [nextValue] },
      onCommit: async () => {
        const response = await fetch("/api/documents/domain", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            document_id: target.id,
            business_domain: nextValue,
          }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) return { ok: false, error: toHebrewError(json?.error, "עדכון התחום נכשל.") };
        startTransition(() => { router.refresh(); });
        return { ok: true };
      },
    });
  }

  function deleteDocument() {
    if (!deleteDialogDoc) return;
    const target = deleteDialogDoc;
    setDeleteDialogDoc(null);
    if (previewDoc?.id === target.id) setPreviewDoc(null);
    scheduleDeferredDelete({
      scope: "document",
      id: target.id,
      message: "המסמך נמחק",
      onCommit: async () => {
        const response = await fetch("/api/documents/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ document_id: target.id }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) return { ok: false, error: toHebrewError(json?.error, "מחיקת המסמך נכשלה.") };
        startTransition(() => { router.refresh(); });
        return { ok: true };
      },
    });
  }

  return (
    <div
      className={`@container relative space-y-2 pb-28 md:-mt-2 md:pb-0 lg:-mt-4 ${
        selectedIds.size > 0 ? "md:pb-20" : ""
      }`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={(event) => {
        if (hasFiles(event)) event.preventDefault();
      }}
      onDrop={handleDrop}
    >
      {isDraggingFiles ? (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-secondary bg-secondary/5">
          <div className="flex flex-col items-center gap-1 rounded-xl bg-background px-4 py-3 text-center shadow">
            <UploadIcon className="h-5 w-5 text-secondary" />
            <span className="text-sm font-medium">שחרר כאן להעלאה</span>
            <span className="text-xs text-muted-foreground">
              ניתן לשחרר על קבוצה כדי לשייך אליה
            </span>
          </div>
        </div>
      ) : null}
      {isTruncated ? (
        <p className="text-xs text-muted-foreground">
          מוצגים {documents.length} המסמכים האחרונים מתוך {totalDocuments}. הסינון והמספרים
          בעמוד מתייחסים אליהם בלבד.
        </p>
      ) : null}

      {customerName ? (
        <div className="text-lg font-medium">
          לקוח: {customerName}
          {customerPhone ? (
            <a
              href={`tel:${customerPhone}`}
              className="ms-2 text-sm font-normal text-muted-foreground hover:underline"
            >
              {customerPhone}
            </a>
          ) : null}
        </div>
      ) : null}

      {/* Row 1 — the page itself: what this is, how to find one, what to do.
          No container: it belongs to the page, not to the results. Sticky,
          because search is the page's primary job. */}
      <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-x-3 gap-y-2 bg-background/95 px-1 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <h1 className="hidden text-lg font-semibold @[40em]:block">מסמכים</h1>
        <div className="relative min-w-[10rem] max-w-[32rem] flex-1 basis-40">
          <SearchIcon className="pointer-events-none absolute start-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="חיפוש"
            className="h-10 ps-11 pe-10"
            aria-label="חיפוש מסמכים"
            onKeyDown={(event) => {
              // Escape returns to browsing, it does not leave the page.
              if (event.key === "Escape" && query) {
                event.preventDefault();
                setQuery("");
              }
            }}
          />
          {query ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute end-1 top-1/2 h-7 w-7 -translate-y-1/2"
              aria-label="ניקוי החיפוש"
              title="ניקוי"
              onClick={() => setQuery("")}
            >
              ✕
            </Button>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 @[40em]:hidden">
          <Button
            type="button"
            variant="outline"
            className={`h-10 gap-1.5 ${activeFilterCount > 0 ? "border-secondary text-secondary" : ""}`}
            onClick={() => setFilterSheetOpen(true)}
          >
            <FilterIcon className="h-4 w-4" />
            סינון
            {activeFilterCount > 0 ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary px-1 text-xs text-secondary-foreground">
                {activeFilterCount}
              </span>
            ) : null}
          </Button>
          <Button
            type="button"
            variant={viewMode === "grid" ? "default" : "outline"}
            size="icon"
            className="h-10 w-10"
            aria-label={viewMode === "grid" ? "תצוגת רשימה" : "תצוגת כרטיסים"}
            onClick={() => changeViewMode(viewMode === "grid" ? "list" : "grid")}
          >
            {viewMode === "grid" ? <ListIcon className="h-4 w-4" /> : <GridIcon className="h-4 w-4" />}
          </Button>
        </div>
        <div className="ms-auto hidden items-center gap-3 @[40em]:flex">
          {canManageCategories ? (
            <Button variant="outline" className="h-10" onClick={() => setCategoriesOpen(true)}>
              <TagIcon className="h-4 w-4" />
              ניהול קטגוריות
            </Button>
          ) : null}
          <Button className="h-10" onClick={() => setUploadDialogOpen(true)}>
            <UploadIcon className="h-4 w-4" />
            העלאת קבצים
          </Button>
        </div>
      </div>

      {activeFilterCount > 0 || groupBy !== "entity" || sortBy !== "newest" ? (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden @[40em]:hidden">
          {Array.from(attachedTo).map((key) => (
            <button
              key={`m-scope-${key}`}
              type="button"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-secondary/40 px-2.5 text-xs text-secondary"
              onClick={() => toggleAttachedTo(key)}
            >
              {ENTITY_FACETS.find((facet) => facet.key === key)?.label ?? key}
              <span aria-hidden>✕</span>
              <span className="sr-only">הסרת הסינון</span>
            </button>
          ))}
          {Array.from(expiryChips).map((key) => (
            <button
              key={`m-exp-${key}`}
              type="button"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-secondary/40 px-2.5 text-xs text-secondary"
              onClick={() => toggleExpiryChip(key)}
            >
              תוקף: {EXPIRY_FACETS.find((facet) => facet.key === key)?.label ?? key}
              <span aria-hidden>✕</span>
              <span className="sr-only">הסרת הסינון</span>
            </button>
          ))}
          {Array.from(typeChips).map((code) => (
            <button
              key={`m-type-${code}`}
              type="button"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-secondary/40 px-2.5 text-xs text-secondary"
              onClick={() => toggleTypeChip(code)}
            >
              {categoryLabel(categoryRows, code)}
              <span aria-hidden>✕</span>
              <span className="sr-only">הסרת הסינון</span>
            </button>
          ))}
          {groupBy !== "entity" ? (
            <button
              type="button"
              className="inline-flex h-7 shrink-0 items-center rounded-full border border-dashed border-border px-2.5 text-xs text-muted-foreground"
              onClick={() => setFilterSheetOpen(true)}
            >
              קיבוץ: {GROUP_BY_OPTIONS[groupBy] ?? groupBy}
            </button>
          ) : null}
          {sortBy !== "newest" ? (
            <button
              type="button"
              className="inline-flex h-7 shrink-0 items-center rounded-full border border-dashed border-border px-2.5 text-xs text-muted-foreground"
              onClick={() => setFilterSheetOpen(true)}
            >
              מיון: {SORT_BY_OPTIONS[sortBy] ?? sortBy}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Row 2 — chrome, not content. It sits directly on the tinted page so
          the only white on the screen is documents. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-1">
        <div className="order-2 ms-auto hidden flex-wrap items-center gap-1.5 @[40em]:flex">
        {/* order-last on narrow: the controls wrap above, search keeps a whole
            line to itself instead of competing for one. */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={`h-10 shrink-0 justify-between gap-2 font-medium ${
                  attachedTo.size > 0 ? "border-secondary text-secondary" : ""
                }`}
              >
                <span>
                  {facetTriggerLabel("שיוך", attachedTo, scopeOptions)}
                </span>
                <ChevronDownIcon className="h-4 w-4 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-60 overflow-y-auto">
              <DropdownMenuCheckboxItem
                checked={attachedTo.size === 0}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() => setAttachedTo(new Set())}
              >
                <span className="flex-1">הכל</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {facetCounts[""] ?? documents.length}
                </span>
              </DropdownMenuCheckboxItem>
              {scopeOptions.map((facet) => (
                <DropdownMenuCheckboxItem
                  key={facet.key}
                  checked={attachedTo.has(facet.key)}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={() => toggleAttachedTo(facet.key)}
                >
                  <span className="flex-1">{facet.label}</span>
                  <span className="text-xs font-normal text-muted-foreground">{facet.count}</span>
                </DropdownMenuCheckboxItem>
              ))}
              {attachedTo.size > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setAttachedTo(new Set())}>
                    נקה
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={`h-10 shrink-0 justify-between gap-2 font-medium ${
                  expiryChips.size > 0 ? "border-secondary text-secondary" : ""
                }`}
              >
                <span>
                  {facetTriggerLabel(
                    "תוקף",
                    expiryChips,
                    EXPIRY_FACETS.map((facet) => ({
                      key: facet.key,
                      label: facet.label,
                      count:
                        expiryFacetCounts[facet.key as keyof typeof expiryFacetCounts] ?? 0,
                    }))
                  )}
                </span>
                <ChevronDownIcon className="h-4 w-4 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {EXPIRY_FACETS.map((facet) => (
                <DropdownMenuCheckboxItem
                  key={facet.key}
                  checked={expiryChips.has(facet.key)}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={() => toggleExpiryChip(facet.key)}
                >
                  <span className="flex-1">{facet.label}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {expiryFacetCounts[facet.key as keyof typeof expiryFacetCounts] ?? 0}
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
              {expiryChips.size > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setExpiryChips(new Set())}>נקה</DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={`h-10 shrink-0 justify-between gap-2 font-medium ${
                  typeChips.size > 0 ? "border-secondary text-secondary" : ""
                }`}
              >
                <span>
                  {facetTriggerLabel("סוג", typeChips, typeOptions)}
                </span>
                <ChevronDownIcon className="h-4 w-4 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-60 overflow-y-auto">
              {topCategories.map((entry) => (
                <DropdownMenuCheckboxItem
                  key={entry.code}
                  checked={typeChips.has(entry.code)}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={() => toggleTypeChip(entry.code)}
                >
                  <span className="flex-1">{categoryLabel(categoryRows, entry.code)}</span>
                  <span className="text-xs font-normal text-muted-foreground">{entry.count}</span>
                </DropdownMenuCheckboxItem>
              ))}
              {typeChips.size > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setTypeChips(new Set())}>נקה</DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>

          <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-border" />

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-10 shrink-0 justify-between gap-2 text-muted-foreground"
              >
                <span>קיבוץ: {GROUP_BY_OPTIONS[groupBy] ?? ""}</span>
                <ChevronDownIcon className="h-4 w-4 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuRadioGroup value={groupBy} onValueChange={setGroupBy}>
                {Object.entries(GROUP_BY_OPTIONS).map(([value, label]) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-10 shrink-0 justify-between gap-2 text-muted-foreground"
              >
                <span>מיון: {SORT_BY_OPTIONS[sortBy] ?? ""}</span>
                <ChevronDownIcon className="h-4 w-4 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuRadioGroup value={sortBy} onValueChange={setSortBy}>
                {Object.entries(SORT_BY_OPTIONS).map(([value, label]) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            size="icon"
            className="h-10 w-10"
            variant={viewMode === "grid" ? "default" : "outline"}
            aria-label="תצוגת כרטיסים"
            title="כרטיסים"
            onClick={() => changeViewMode("grid")}
          >
            <GridIcon className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            className="h-10 w-10"
            variant={viewMode === "list" ? "default" : "outline"}
            aria-label="תצוגת רשימה"
            title="רשימה"
            onClick={() => changeViewMode("list")}
          >
            <ListIcon className="h-4 w-4" />
          </Button>
        </div>
        <div className="order-1 flex flex-wrap items-center gap-2 text-xs">
          {/* Every number on this page describes the LOADED set, because that
              is the only set the filters ever saw. Saying "5 מתוך 3000" while
              the filter ran over the newest 1,000 is a quiet lie; the notice
              above names the archive's real size. */}
          <span className="text-muted-foreground">
            {hasActiveFilters
              ? `מציג ${filteredDocuments.length} מתוך ${loadedDocumentCount}`
              : documentsHe(loadedDocumentCount)}
          </span>
              {showPills
                ? Array.from(attachedTo).map((key) => (
                <button
                  key={`scope-${key}`}
                  type="button"
                  className="hidden h-6 shrink-0 items-center gap-1 rounded-full border border-secondary/40 px-2 text-xs text-secondary hover:bg-secondary/10 @[40em]:inline-flex"
                  onClick={() => toggleAttachedTo(key)}
                >
                  {ENTITY_FACETS.find((facet) => facet.key === key)?.label ?? key}
                  <span aria-hidden>✕</span>
                  <span className="sr-only">הסרת הסינון</span>
                </button>
                  ))
                : null}
              {showPills
                ? Array.from(expiryChips).map((key) => (
                <button
                  key={`expiry-${key}`}
                  type="button"
                  className="hidden h-6 shrink-0 items-center gap-1 rounded-full border border-secondary/40 px-2 text-xs text-secondary hover:bg-secondary/10 @[40em]:inline-flex"
                  onClick={() => toggleExpiryChip(key)}
                >
                  {EXPIRY_FACETS.find((facet) => facet.key === key)?.label ?? key}
                  <span aria-hidden>✕</span>
                  <span className="sr-only">הסרת הסינון</span>
                </button>
                  ))
                : null}
              {showPills
                ? Array.from(typeChips).map((code) => (
                <button
                  key={`type-${code}`}
                  type="button"
                  className="hidden h-6 shrink-0 items-center gap-1 rounded-full border border-secondary/40 px-2 text-xs text-secondary hover:bg-secondary/10 @[40em]:inline-flex"
                  onClick={() => toggleTypeChip(code)}
                >
                  {categoryLabel(categoryRows, code)}
                  <span aria-hidden>✕</span>
                  <span className="sr-only">הסרת הסינון</span>
                </button>
                  ))
                : null}
              {showPills && normalizedQuery ? (
                <button
                  type="button"
                  className="hidden h-6 shrink-0 items-center gap-1 rounded-full border border-secondary/40 px-2 text-xs text-secondary hover:bg-secondary/10 @[40em]:inline-flex"
                  onClick={() => setQuery("")}
                >
                  {query.trim()}
                  <span aria-hidden>✕</span>
                  <span className="sr-only">ניקוי החיפוש</span>
                </button>
              ) : null}
              {hasActiveFilters ? (
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={resetFilters}>
                  נקה הכל
                </Button>
              ) : null}
          </div>
      </div>

      {error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">
            שגיאה בטעינת ארכיון המסמכים: {error}
          </CardContent>
        </Card>
      ) : null}

      <div
        aria-hidden
        ref={measureGrid}
        className="grid h-0 gap-x-3 [grid-template-columns:repeat(2,minmax(0,1fr))] @[40em]:[grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]"
      />

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
        groupRuns.map((run, runIndex) =>
          run.kind === "full" ? (
            renderGroup(run.group, false)
          ) : (
            <div
              key={`run-${runIndex}`}
              className="mt-4 grid gap-x-3 gap-y-3 [grid-template-columns:repeat(2,minmax(0,1fr))] @[40em]:[grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))] first:mt-0"
            >
              {run.groups.map((group) => renderGroup(group, true))}
            </div>
          )
        )
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
        size="details4xl"
        className="max-w-[95vw] lg:h-[92vh]"
        bodyClassName="lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden"
        title={activePreviewDoc?.title ?? "מסמך"}
        description={
          activePreviewDoc
            ? [fileKindLabel(activePreviewDoc.file_kind), formatFileSize(previewSize)]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
        footer={
          activePreviewDoc ? (
            <div className="flex flex-nowrap items-center justify-between gap-2">
              <div className="flex shrink-0 flex-nowrap items-center gap-1">
                {/* RTL: "previous" sits toward the start, which is the right in
                    Hebrew — logical properties handle it, the glyphs are chosen
                    to point the way reading goes. */}
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="המסמך הקודם"
                  title="הקודם"
                  disabled={!previousPreviewDoc}
                  onClick={() => previousPreviewDoc && setPreviewDoc(previousPreviewDoc)}
                >
                  <ChevronRightIcon className="h-4 w-4" />
                </Button>
                {previewIndex >= 0 ? (
                  <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                    {previewIndex + 1} / {filteredDocuments.length}
                  </span>
                ) : null}
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="המסמך הבא"
                  title="הבא"
                  disabled={!nextPreviewDoc}
                  onClick={() => nextPreviewDoc && setPreviewDoc(nextPreviewDoc)}
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex min-w-0 flex-nowrap items-center justify-end gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setAssignDoc(activePreviewDoc)}
                >
                  <LinkIcon className="h-4 w-4" />
                  שיוך
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditDialogDoc(activePreviewDoc);
                    setEditTagValue(activePreviewDoc.document_type ?? "");
                    setEditValidUntil(activePreviewDoc.valid_until ?? "");
                  }}
                >
                  <TagIcon className="h-4 w-4" />
                  קטגוריה
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!activePreviewDoc.url}
                  onClick={() => void downloadOne(activePreviewDoc)}
                >
                  <DownloadIcon className="h-4 w-4" />
                  הורדה
                </Button>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="px-2"
                      title="עוד פעולות"
                      aria-label="עוד פעולות"
                    >
                      <MoreIcon className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem
                      onClick={() => {
                        setEditDomainDoc(activePreviewDoc);
                        setEditDomainValue(activePreviewDoc.business_domains[0] ?? "");
                      }}
                    >
                      <LayersIcon className="me-2 h-4 w-4" />
                      תחום
                    </DropdownMenuItem>
                    {activePreviewDoc.url ? (
                      <DropdownMenuItem asChild>
                        <a href={activePreviewDoc.url} target="_blank" rel="noreferrer">
                          <ExternalLinkIcon className="me-2 h-4 w-4" />
                          פתיחה בכרטיסייה חדשה
                        </a>
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setDeleteDialogDoc(activePreviewDoc)}
                    >
                      <DeleteIcon className="me-2 h-4 w-4" />
                      מחיקה
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ) : null
        }
      >

          {activePreviewDoc ? (
            <div className="mt-4 flex min-h-0 flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row-reverse">
              <div
                className="group/preview relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-muted/30"
                onTouchStart={handleViewerTouchStart}
                onTouchEnd={handleViewerTouchEnd}
              >
                {previousPreviewDoc ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="המסמך הקודם"
                    title="הקודם"
                    className={ARROW_BUTTON + " start-2"}
                    onClick={() => setPreviewDoc(previousPreviewDoc)}
                  >
                    <ChevronRightIcon className="h-5 w-5" />
                  </Button>
                ) : null}
                {nextPreviewDoc ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="המסמך הבא"
                    title="הבא"
                    className={ARROW_BUTTON + " end-2"}
                    onClick={() => setPreviewDoc(nextPreviewDoc)}
                  >
                    <ChevronLeftIcon className="h-5 w-5" />
                  </Button>
                ) : null}
                {activePreviewDoc.url && activePreviewDoc.file_kind === "image" ? (
                  <a
                    href={activePreviewDoc.url}
                    target="_blank"
                    rel="noreferrer"
                    title="פתיחה בכרטיסייה חדשה"
                    className="relative block min-h-[20rem] w-full flex-1 lg:min-h-0"
                  >
                    <Image
                      src={activePreviewDoc.url}
                      alt={activePreviewDoc.title}
                      fill
                      className="object-contain"
                    />
                  </a>
                ) : activePreviewDoc.url && activePreviewDoc.file_kind === "pdf" ? (
                  <PdfViewer
                    url={activePreviewDoc.url}
                    className="min-h-[20rem] w-full flex-1 lg:min-h-0"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm text-muted-foreground">
                    <DocumentIcon className="h-8 w-8" />
                    {activePreviewDoc.url ? (
                      <>
                        <span>אין תצוגה מקדימה לסוג הקובץ הזה.</span>
                        <Button asChild size="sm">
                          <a href={activePreviewDoc.url} target="_blank" rel="noreferrer">
                            <ExternalLinkIcon className="h-4 w-4" />
                            פתיחה בכרטיסייה חדשה
                          </a>
                        </Button>
                      </>
                    ) : (
                      <span>לא נמצא קובץ להצגה עבור המסמך הזה.</span>
                    )}
                  </div>
                )}
                {previewSet.length > 1 ? (
                  <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-t bg-background/60 px-2 py-1.5">
                    {previewSet.map((member, index) => (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => setPreviewDoc(member)}
                        className={`relative h-12 w-16 shrink-0 overflow-hidden rounded border-2 ${
                          member.id === activePreviewDoc.id
                            ? "border-secondary"
                            : "border-transparent"
                        }`}
                        aria-label={`תמונה ${index + 1} מתוך ${previewSet.length}`}
                        title={`${index + 1} / ${previewSet.length}`}
                      >
                        {member.url && member.file_kind === "image" ? (
                          <Image src={member.url} alt="" fill className="object-cover" />
                        ) : member.url && member.file_kind === "pdf" ? (
                          <PdfThumbnail
                            cacheKey={member.id}
                            url={member.url}
                            width={64}
                            fallback={<DocumentIcon className="h-4 w-4 text-muted-foreground" />}
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center bg-muted">
                            <DocumentIcon className="h-4 w-4 text-muted-foreground" />
                          </span>
                        )}
                      </button>
                    ))}
                    <span className="ms-auto shrink-0 ps-2 text-xs tabular-nums text-muted-foreground">
                      {previewSet.findIndex((member) => member.id === activePreviewDoc.id) + 1} /{" "}
                      {previewSet.length}
                    </span>
                  </div>
                ) : null}
              </div>

              <dl className="grid min-h-0 shrink-0 grid-cols-1 content-start gap-3 overflow-y-auto text-sm lg:w-[15rem] lg:shrink">
                <div className="space-y-0.5">
                  <dt className={FIELD_LABEL}>שם הקובץ</dt>
                  <dd className="break-words font-medium">
                    {activePreviewDoc.file_name ? (
                      (() => {
                        const { rtl, ltr } = splitFileNameForDisplay(activePreviewDoc.file_name);
                        return (
                          <span dir="rtl">
                            {rtl ? <bdi>{rtl}</bdi> : null}
                            {rtl && ltr ? " " : null}
                            {ltr ? <bdi dir="ltr">{ltr}</bdi> : null}
                          </span>
                        );
                      })()
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div className="space-y-0.5">
                  <dt className={FIELD_LABEL}>תאריך העלאה</dt>
                  <dd className="font-medium">{formatDate(activePreviewDoc.uploaded_at)}</dd>
                </div>
                <div className="space-y-0.5">
                  <dt className={FIELD_LABEL}>הועלה על ידי</dt>
                  <dd className="font-medium">{activePreviewDoc.uploaded_by_name ?? "—"}</dd>
                </div>
                {(() => {
                  const expiry = expiryOf(activePreviewDoc);
                  if (!expiry) return null;
                  const tone = expiryBadgeTone(expiry.status);
                  const open = () => {
                    setEditDialogDoc(activePreviewDoc);
                    setEditTagValue(activePreviewDoc.document_type ?? "");
                    setEditValidUntil(activePreviewDoc.valid_until ?? "");
                  };
                  return (
                    <div className="space-y-0.5">
                      <dt className={FIELD_LABEL}>בתוקף עד</dt>
                      <dd className="flex flex-wrap items-center gap-1.5 font-medium">
                        {activePreviewDoc.valid_until ? (
                          <>
                            <button
                              type="button"
                              onClick={open}
                              className="font-medium hover:underline"
                              title="עריכת תאריך התוקף"
                            >
                              {formatDate(activePreviewDoc.valid_until)}
                            </button>
                            {tone ? <Badge variant={tone}>{expiryLabel(expiry)}</Badge> : null}
                            {expiry.status === "superseded" ? (
                              <span className="text-xs text-muted-foreground">הוחלף</span>
                            ) : null}
                          </>
                        ) : (
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="h-auto p-0"
                            onClick={open}
                          >
                            הוסף תאריך תוקף
                          </Button>
                        )}
                      </dd>
                    </div>
                  );
                })()}
                <div className="space-y-0.5">
                  <dt className={FIELD_LABEL}>תחום</dt>
                  <dd className="font-medium">
                    <MetaRow items={activePreviewDoc.business_domains.map(getBusinessDomainLabel)} fallback="—" />
                  </dd>
                </div>
                {activePreviewDoc.ref_year ? (
                  <div>
                    <dt className={FIELD_LABEL}>שנת המסמך</dt>
                    <dd className="font-medium tabular-nums">{activePreviewDoc.ref_year}</dd>
                  </div>
                ) : null}
                <div className="space-y-0.5">
                  <dt className={FIELD_LABEL}>שיוך</dt>
                  <dd className="flex flex-wrap gap-1.5 font-medium">
                    {(() => {
                      const chips = [
                        ...activePreviewDoc.tags.map((tag) => ({
                          key: `tag:${tag.id}`,
                          parts: [tag.label],
                          href: tag.href ?? null,
                        })),
                        ...activePreviewDoc.linked_entities.map((entity) => ({
                          key: `${entity.type}:${entity.id}`,
                          parts: entityChipParts(entity.type, entity.label),
                          href: entity.href,
                        })),
                      ];
                      if (chips.length === 0) {
                        return <span className="text-muted-foreground">ללא שיוך</span>;
                      }
                      return chips.map((chip) =>
                        chip.href ? (
                          <Link
                            key={chip.key}
                            href={chip.href}
                            className="rounded-full border border-secondary/40 px-2 py-0.5 text-xs text-secondary hover:bg-secondary/10"
                          >
                            <MetaRow items={chip.parts} />
                          </Link>
                        ) : (
                          <span
                            key={chip.key}
                            className="rounded-full border border-border px-2 py-0.5 text-xs"
                          >
                            <MetaRow items={chip.parts} />
                          </span>
                        )
                      );
                    })()}
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}

      </ViewDialog>


      {/* Pinned to the bottom so it is reachable on a phone without scrolling
          back, and above the FAB. Only exists while something is selected. */}
      {selectedIds.size > 0 ? (
        <div className="sticky bottom-20 z-30 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-2xl border-2 border-[rgb(var(--secondary-9))] bg-background px-3 py-2 text-card-foreground shadow-lg md:bottom-4">
          <span className="px-1 text-sm font-medium">{selectedIds.size} נבחרו</span>
          {selectedIds.size < filteredDocuments.length ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => setSelectedIds(new Set(filteredDocuments.map((doc) => doc.id)))}
            >
              בחר הכל ({filteredDocuments.length})
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={() => setBulkAssignOpen(true)}>
            <LinkIcon className="h-4 w-4" />
            שיוך
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setBulkCategoryValue("");
              setBulkCategoryOpen(true);
            }}
          >
            <TagIcon className="h-4 w-4" />
            קטגוריה
          </Button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="px-2"
                title="עוד פעולות"
                aria-label="עוד פעולות"
              >
                <MoreIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem className="text-destructive" onClick={bulkDelete}>
                <DeleteIcon className="me-2 h-4 w-4" />
                מחיקה
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="button" size="sm" variant="outline" onClick={() => { setSelectedIds(new Set()); setSelectionMode(false); }}>
            ביטול
          </Button>
        </div>
      ) : null}

      <AssignDocumentDialog
        documentIds={selectedDocs.map((doc) => doc.id)}
        documentTitle={`${selectedDocs.length} מסמכים`}
        open={bulkAssignOpen}
        onOpenChange={setBulkAssignOpen}
        projects={projectOptions}
        orders={orderOptions}
        properties={propertyOptions}
        customers={customerOptions}
        vehicles={vehicleTagOptions}
        tasks={taskOptions}
        onAssigned={() => {
          setBulkAssignOpen(false);
          setSelectedIds(new Set());
          startTransition(() => { router.refresh(); });
        }}
      />

      <FormDialog
        open={bulkCategoryOpen}
        onOpenChange={setBulkCategoryOpen}
        title="קטגוריה למסמכים הנבחרים"
        description={`${selectedDocs.length} מסמכים`}
        size="formMd"
        onSubmit={() => void bulkSetCategory()}
        submitLabel="שמירה"
        busyLabel="שומר..."
        busy={bulkBusy}
      >
        <div className="mt-4 space-y-2">
          <SelectField
            value={bulkCategoryValue}
            onChange={setBulkCategoryValue}
            ariaLabel="קטגוריית מסמך"
          >
            <option value="">ללא קטגוריה</option>
            {DOCUMENT_CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>
        </div>
      </FormDialog>

      <UploadDocumentDialog
        open={uploadDialogOpen}
        onOpenChange={(next) => {
          setUploadDialogOpen(next);
          if (!next) {
            setDroppedFiles([]);
            setDropSeed(null);
          }
        }}
        projects={uploadProjectOptions.map((option) => ({ id: option.id, label: option.label }))}
        properties={propertyFilterOptions.map((option) => ({ id: option.id, label: option.label }))}
        customers={customerOptions}
        defaultDomain={dropSeed?.kind === "domain" ? dropSeed.value : businessDomain}
        defaultProjectId={
          dropSeed?.kind === "project" ? dropSeed.id : initialFilters.project_id
        }
        defaultPropertyId={
          dropSeed?.kind === "property" ? dropSeed.id : initialFilters.property_id
        }
        defaultCustomerId={dropSeed?.kind === "customer" ? dropSeed.id : ""}
        defaultCategory={dropSeed?.kind === "category" ? dropSeed.value : ""}
        initialFiles={droppedFiles}
        onUploaded={() => startTransition(() => { router.refresh(); })}
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
        onSubmit={saveTag}
        submitLabel="שמירה"
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
            {editTracksExpiry ? (
              <label className="block space-y-1 text-sm">
                <span className="font-medium">בתוקף עד</span>
                <DateInput
                  value={editValidUntil}
                  onChange={(e) => setEditValidUntil(e.target.value)}
                />
                <span className="block text-xs text-muted-foreground">
                  נקבל התראה לפני שהתוקף פג. אפשר להשאיר ריק.
                </span>
              </label>
            ) : null}
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
        onSubmit={saveDomain}
        submitLabel="שמירה"
      >
          <div className="space-y-3">
            <div className="text-sm font-medium">{editDomainDoc?.title ?? "מסמך"}</div>
            <DomainSelect value={editDomainValue} onChange={setEditDomainValue} ariaLabel="תחום המסמך" />
          </div>
      </FormDialog>

      <ViewDialog
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
        title="קטגוריות מסמכים"
        description="מה המערכת עושה עם כל סוג מסמך — מעקב תוקף, מסמכים נדרשים, ושיוך לתנועה."
        size="formLg"
      >
        <DocumentCategoriesEditor />
      </ViewDialog>

      <DocumentsFilterSheet
        open={filterSheetOpen}
        onOpenChange={setFilterSheetOpen}
        scopeOptions={scopeOptions}
        attachedTo={attachedTo}
        onToggleScope={toggleAttachedTo}
        expiryOptions={EXPIRY_FACETS.map((facet) => ({
          key: facet.key,
          label: facet.label,
          count: expiryFacetCounts[facet.key as keyof typeof expiryFacetCounts] ?? 0,
        }))}
        expiryChips={expiryChips}
        onToggleExpiry={toggleExpiryChip}
        typeOptions={topCategories.map((entry) => ({
          key: entry.code,
          label: categoryLabel(categoryRows, entry.code),
          count: entry.count,
        }))}
        typeChips={typeChips}
        onToggleType={toggleTypeChip}
        groupByOptions={GROUP_BY_OPTIONS}
        groupBy={groupBy}
        onGroupBy={setGroupBy}
        sortByOptions={SORT_BY_OPTIONS}
        sortBy={sortBy}
        onSortBy={setSortBy}
        resultCount={filteredDocuments.length}
        hasActiveFilters={hasActiveFilters}
        onClear={resetFilters}
      />

      <AssignDocumentDialog
        documentIds={assignDoc ? [assignDoc.id] : []}
        documentTitle={assignDoc?.title ?? ""}
        open={Boolean(assignDoc)}
        onOpenChange={(next) => {
          if (!next) setAssignDoc(null);
        }}
        projects={projectOptions}
        orders={orderOptions}
        properties={propertyOptions}
        customers={customerOptions}
        vehicles={vehicleTagOptions}
        tasks={taskOptions}
        onAssigned={() => {
          setAssignDoc(null);
          startTransition(() => { router.refresh(); });
        }}
      />

      <LinkDocumentToLedgerDialog
        documentId={linkDoc?.id ?? null}
        documentTitle={linkDoc?.title ?? ""}
        open={Boolean(linkDoc)}
        onOpenChange={(next) => {
          if (!next) setLinkDoc(null);
        }}
        onLinked={() => {
          setLinkDoc(null);
          startTransition(() => { router.refresh(); });
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteDialogDoc)}
        onOpenChange={(open) => {
          if (!open) setDeleteDialogDoc(null);
        }}
        destructive
        title="מחיקת מסמך"
        description="הפעולה תמחק את קובץ האחסון ואת כל הקישורים של המסמך."
        confirmLabel="מחיקה"
        onConfirm={deleteDocument}
      >
        <p className="text-sm">
          האם למחוק את <span className="font-medium">{deleteDialogDoc?.title ?? "המסמך"}</span>?
        </p>
      </ConfirmDialog>
    </div>
  );
}
