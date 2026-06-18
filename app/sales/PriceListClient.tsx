"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { loadMorePriceList } from "@/app/sales/actions";
import type { ProductsFilters } from "@/app/sales/loadProducts";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { Loader2, Pencil, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toHebrewError } from "@/lib/error-messages";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type CategoryOption = {
  id: string;
  name: string;
  active: boolean;
};

const NEW_CATEGORY_VALUE = "__new__";
const PRICE_LIST_SHARE_CONTENT_ID = "price-list-share-pdf";

type ProductRow = {
  id: string;
  name: string;
  categoryId: string | null;
  category: string | null;
  lowStockThreshold: number | null;
  code: string | null;
  unitPrice: number | null;
  baseCost: number | null;
  stock: number | null;
  purchasedAmount: number;
  soldAmount: number;
  description?: string | null;
  active?: boolean;
};

function formatCurrency(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  }).format(value);
}

export default function PriceListClient({
  initialProducts,
  initialCategories,
  initialHasMore = false,
  totalCount,
  initialQuery = "",
  initialCategoryFilter = "",
}: {
  initialProducts: ProductRow[];
  initialCategories: CategoryOption[];
  initialHasMore?: boolean;
  totalCount?: number;
  initialQuery?: string;
  initialCategoryFilter?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const categoryFilter = initialCategoryFilter;

  // Fetch-from-DB-as-you-scroll: accumulate product pages and pull the next one
  // from the server when the bottom comes into view (no "next page" button).
  const fetchFilters = useMemo<ProductsFilters>(
    () => ({ q: initialQuery, category: initialCategoryFilter }),
    [initialQuery, initialCategoryFilter]
  );
  const fetchPage = useCallback((page: number) => loadMorePriceList(page, fetchFilters), [fetchFilters]);
  const getRowId = useCallback((product: ProductRow) => product.id, []);
  const {
    rows,
    setRows,
    hasMore,
    loading: loadingMore,
    sentinelRef,
    mobileSentinelRef,
    scrollRef,
  } = useInfiniteScroll<ProductRow>({
    initialRows: initialProducts,
    initialHasMore,
    fetchPage,
    getId: getRowId,
  });
  const [categories, setCategories] = useState<CategoryOption[]>(initialCategories);
  const [query, setQuery] = useState(initialQuery);

  function pushFilters(next: { q?: string; category?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("pricePage");
    const nextQ = next.q ?? query;
    const nextCategory = next.category ?? categoryFilter;
    if (nextQ.trim()) params.set("q", nextQ.trim());
    else params.delete("q");
    if (nextCategory.trim()) params.set("category", nextCategory.trim());
    else params.delete("category");
    const qs = params.toString();
    router.push(qs ? `/sales?${qs}` : "/sales", { scroll: false });
  }

  const lastPushedQueryRef = useRef(initialQuery);
  useEffect(() => {
    if (query === lastPushedQueryRef.current) return;
    const timer = setTimeout(() => {
      pushFilters({ q: query });
      lastPushedQueryRef.current = query;
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function setCategoryFilter(value: string) {
    pushFilters({ category: value });
  }

  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createName, setCreateName] = useState("");
  const [createCode, setCreateCode] = useState("");
  const [createPrice, setCreatePrice] = useState("");
  const [createCost, setCreateCost] = useState("");
  const [createCategoryId, setCreateCategoryId] = useState(initialCategories[0]?.id ?? "");
  const [createNewCategoryName, setCreateNewCategoryName] = useState("");
  const [createCategoryLoading, setCreateCategoryLoading] = useState(false);
  const [createCategoryError, setCreateCategoryError] = useState("");
  const [createPurchasedAmount, setCreatePurchasedAmount] = useState("");
  const [createLowStockThreshold, setCreateLowStockThreshold] = useState("5");
  const [createDescription, setCreateDescription] = useState("");
  const [createActive, setCreateActive] = useState(true);

  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editCost, setEditCost] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editNewCategoryName, setEditNewCategoryName] = useState("");
  const [editCategoryLoading, setEditCategoryLoading] = useState(false);
  const [editCategoryError, setEditCategoryError] = useState("");
  const [editPurchasedAmount, setEditPurchasedAmount] = useState("");
  const [editLowStockThreshold, setEditLowStockThreshold] = useState("5");
  const [editDescription, setEditDescription] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [deleteLoadingId, setDeleteLoadingId] = useState("");
  const [tableError, setTableError] = useState("");
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ProductRow | null>(null);
  const isCreateNewCategory = createCategoryId === NEW_CATEGORY_VALUE;
  const isEditNewCategory = editCategoryId === NEW_CATEGORY_VALUE;

  // Server already filtered by ?q and ?category URL params across the full dataset.
  const filtered = rows;

  function normalizeProducts(list: ProductRow[]) {
    return [...list].sort((a, b) => a.name.localeCompare(b.name, "he"));
  }

  function normalizeCategories(list: CategoryOption[]) {
    return [...list].sort((a, b) => a.name.localeCompare(b.name, "he"));
  }

  const activeCategoryName = useMemo(
    () => categories.find((category) => category.id === categoryFilter)?.name ?? null,
    [categories, categoryFilter]
  );
  const shareTitle = activeCategoryName ? `מחירון - ${activeCategoryName}` : "מחירון";
  const shareDateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("he-IL", {
        dateStyle: "full",
        timeStyle: "short",
      }).format(new Date()),
    []
  );
  const activeProductsCount = filtered.filter((product) => product.active !== false).length;
  const pricedProductsCount = filtered.filter((product) => product.unitPrice !== null).length;
  const averagePrice =
    pricedProductsCount > 0
      ? filtered.reduce((sum, product) => sum + (product.unitPrice ?? 0), 0) / pricedProductsCount
      : null;

  function getPriceListShareElement() {
    const exportElement = document.getElementById(PRICE_LIST_SHARE_CONTENT_ID);
    if (!exportElement) {
      throw new Error("לא נמצא תוכן המחירון ליצירת PDF.");
    }

    return exportElement;
  }

  function applyPdfCaptureColorOverrides(documentClone: Document) {
    const exportElement = documentClone.getElementById(PRICE_LIST_SHARE_CONTENT_ID) as HTMLElement | null;
    if (!exportElement) return;

    // Brand palette used for PDF rendering — must mirror the semantic tokens
    // in globals.css. html2canvas needs explicit hex/rgb values because it can
    // struggle with CSS variables, so we materialise them here.
    const BRAND = {
      page: "#F0F9FF",           // sky-50 page bg
      surface: "#FFFFFF",        // card surface
      surfaceMuted: "#E0F2FE",   // sky-100 alternating row / muted panel
      headerNavy: "#283561",     // primary (header strip)
      footerNavy: "#0A1020",     // primary-1 (footer strip)
      textPrimary: "#1D2848",    // foreground (body text)
      textMuted: "#0369A1",      // secondary (sky-700) muted
      textSubtle: "#0284C7",     // secondary-6 (sky-600) subtle
      textOnNavyStrong: "#FFFFFF",
      textOnNavyMuted: "#BAE6FD", // secondary-9 (sky-200) on dark
      successBg: "#DCF4E3",      // success-soft (current green-9)
      successText: "#1CB452",    // success anchor (current green-4)
      mutedBg: "#E0F2FE",
      mutedText: "#0369A1",
      border: "#BAE6FD",         // secondary-9 (sky-200) border
    };

    const wrapperElement = exportElement.parentElement as HTMLElement | null;
    if (wrapperElement) {
      wrapperElement.style.backgroundColor = BRAND.page;
    }

    exportElement.style.backgroundColor = BRAND.surface;
    exportElement.style.color = BRAND.textPrimary;
    exportElement.style.boxShadow = "0 24px 80px rgba(29, 40, 72, 0.14)";

    const allElements = [exportElement, ...Array.from(exportElement.querySelectorAll<HTMLElement>("*"))];

    for (const element of allElements) {
      const className = typeof element.className === "string" ? element.className : "";
      const classTokens = className.split(/\s+/).filter(Boolean);
      const hasClass = (token: string) => classTokens.includes(token);

      if (hasClass("bg-page")) element.style.backgroundColor = BRAND.page;
      if (hasClass("bg-surface")) element.style.backgroundColor = BRAND.surface;
      if (hasClass("bg-surface-muted")) element.style.backgroundColor = BRAND.surfaceMuted;
      if (hasClass("bg-header-navy")) element.style.backgroundColor = BRAND.headerNavy;
      if (hasClass("bg-footer-navy")) element.style.backgroundColor = BRAND.footerNavy;
      if (hasClass("bg-success-soft-pdf")) element.style.backgroundColor = BRAND.successBg;
      if (hasClass("bg-muted-pdf")) element.style.backgroundColor = BRAND.mutedBg;
      if (hasClass("bg-white-overlay")) element.style.backgroundColor = "rgba(255, 255, 255, 0.10)";

      if (hasClass("text-on-navy")) element.style.color = BRAND.textOnNavyStrong;
      if (hasClass("text-on-navy-muted")) element.style.color = BRAND.textOnNavyMuted;
      if (hasClass("text-primary-pdf")) element.style.color = BRAND.textPrimary;
      if (hasClass("text-muted-pdf")) element.style.color = BRAND.textMuted;
      if (hasClass("text-subtle-pdf")) element.style.color = BRAND.textSubtle;
      if (hasClass("text-success-pdf")) element.style.color = BRAND.successText;

      if (hasClass("border-brand")) {
        element.style.borderColor = BRAND.border;
        element.style.borderStyle = "solid";
      }
      if (hasClass("border-white-overlay")) {
        element.style.borderColor = "rgba(255, 255, 255, 0.15)";
        element.style.borderStyle = "solid";
      }

      if (hasClass("shadow-brand-pdf")) {
        element.style.boxShadow = "0 24px 80px rgba(29, 40, 72, 0.14)";
      }

      if (hasClass("backdrop-blur-sm")) {
        element.style.backdropFilter = "none";
      }
    }
  }

  async function createPriceListPdfFile() {
    const exportElement = getPriceListShareElement();

    if ("fonts" in document) {
      await document.fonts.ready;
    }

    const canvas = await html2canvas(exportElement, {
      scale: Math.min(window.devicePixelRatio || 1, 2),
      useCORS: true,
      backgroundColor: "#F0F9FF",
      logging: false,
      onclone: applyPdfCaptureColorOverrides,
      windowWidth: Math.max(exportElement.scrollWidth, 1120),
      windowHeight: exportElement.scrollHeight,
    });

    const imageData = canvas.toDataURL("image/jpeg", 0.95);
    const pdf = new jsPDF({
      orientation: "p",
      unit: "mm",
      format: "a4",
      compress: true,
    });

    const margin = 8;
    const pageWidth = pdf.internal.pageSize.getWidth() - margin * 2;
    const pageHeight = pdf.internal.pageSize.getHeight() - margin * 2;
    const imageWidth = pageWidth;
    const imageHeight = (canvas.height * imageWidth) / canvas.width;

    let heightLeft = imageHeight;
    let position = margin;

    pdf.addImage(imageData, "JPEG", margin, position, imageWidth, imageHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position -= pageHeight;
      pdf.addPage();
      pdf.addImage(imageData, "JPEG", margin, position, imageWidth, imageHeight);
      heightLeft -= pageHeight;
    }

    const pdfBlob = pdf.output("blob");
    const today = new Date().toISOString().slice(0, 10);
    return new File([pdfBlob], `price-list-${today}.pdf`, { type: "application/pdf" });
  }

  function downloadPdfFile(pdfFile: File) {
    const fileUrl = URL.createObjectURL(pdfFile);
    const downloadLink = document.createElement("a");
    downloadLink.href = fileUrl;
    downloadLink.download = pdfFile.name;
    downloadLink.click();
    URL.revokeObjectURL(fileUrl);
  }

  async function sharePriceList() {
    if (shareLoading) return;
    if (filtered.length === 0) {
      setShareMessage("");
      setShareError("אין מוצרים לשליחה ברשימה הנוכחית.");
      return;
    }

    setShareLoading(true);
    setShareError("");
    setShareMessage("");

    try {
      const pdfFile = await createPriceListPdfFile();
      const shareData = {
        title: shareTitle,
        text: shareTitle,
        files: [pdfFile],
      };
      const fileShareData = { files: [pdfFile] };

      if (
        typeof navigator !== "undefined" &&
        "share" in navigator &&
        "canShare" in navigator &&
        navigator.canShare(fileShareData)
      ) {
        await navigator.share(shareData);
        setShareMessage("המחירון מוכן ונפתח בחלון השיתוף של המכשיר ל-WhatsApp, מייל או כל אפליקציה אחרת.");
        return;
      }

      downloadPdfFile(pdfFile);
      setShareMessage(`קובץ ה-PDF הורד בשם ${pdfFile.name}. אפשר לצרף אותו ל-WhatsApp או למייל.`);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }

      setShareError(toHebrewError(error, "יצירת ה-PDF נכשלה."));
    } finally {
      setShareLoading(false);
    }
  }

  function resetCreateForm(nextCategoryId?: string) {
    setCreateName("");
    setCreateCode("");
    setCreatePrice("");
    setCreateCost("");
    setCreateCategoryId(nextCategoryId ?? categories[0]?.id ?? "");
    setCreateNewCategoryName("");
    setCreateCategoryError("");
    setCreatePurchasedAmount("");
    setCreateLowStockThreshold("5");
    setCreateDescription("");
    setCreateActive(true);
    setCreateError("");
  }

  function normalizeSelectedCategoryId(value: string) {
    return value && value !== NEW_CATEGORY_VALUE ? value : "";
  }

  function openCreateDialog() {
    resetCreateForm();
    setCreateOpen(true);
  }

  async function addCategory(mode: "create" | "edit") {
    const isCreate = mode === "create";
    const name = (isCreate ? createNewCategoryName : editNewCategoryName).trim();

    if (!name) {
      if (isCreate) setCreateCategoryError("יש להזין שם קטגוריה.");
      else setEditCategoryError("יש להזין שם קטגוריה.");
      return;
    }

    if (isCreate) {
      setCreateCategoryLoading(true);
      setCreateCategoryError("");
    } else {
      setEditCategoryLoading(true);
      setEditCategoryError("");
    }

    try {
      const res = await fetch("/api/product-categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        category?: Record<string, unknown>;
      };

      if (!res.ok || !json.category) {
        const message = toHebrewError(json.error, "יצירת קטגוריה נכשלה.");
        if (isCreate) setCreateCategoryError(message);
        else setEditCategoryError(message);
        return;
      }

      const createdCategory: CategoryOption = {
        id: typeof json.category.id === "string" ? json.category.id : crypto.randomUUID(),
        name: typeof json.category.name === "string" ? json.category.name : name,
        active: json.category.active !== false,
      };

      setCategories((prev) => {
        const existing = prev.find((category) => category.id === createdCategory.id);
        const next = existing
          ? prev.map((category) => (category.id === createdCategory.id ? createdCategory : category))
          : [...prev, createdCategory];
        return normalizeCategories(next);
      });

      if (isCreate) {
        setCreateCategoryId(createdCategory.id);
        setCreateNewCategoryName("");
      } else {
        setEditCategoryId(createdCategory.id);
        setEditNewCategoryName("");
      }
    } catch (err: unknown) {
      const message = toHebrewError(err, "שגיאה לא ידועה");
      if (isCreate) setCreateCategoryError(message);
      else setEditCategoryError(message);
    } finally {
      if (isCreate) setCreateCategoryLoading(false);
      else setEditCategoryLoading(false);
    }
  }

  async function addProduct() {
    if (createLoading) return;
    setTableError("");
    setCreateError("");
    setCreateCategoryError("");

    if (!createName.trim()) {
      setCreateError("שם מוצר הוא שדה חובה.");
      return;
    }

    const selectedCategoryId = normalizeSelectedCategoryId(createCategoryId);
    if (!selectedCategoryId) {
      setCreateError("יש לבחור קטגוריה.");
      return;
    }

    const unitPrice = createPrice.trim() ? Number(createPrice) : null;
    const baseCost = createCost.trim() ? Number(createCost) : null;
    const purchasedAmount = createPurchasedAmount.trim() ? Number(createPurchasedAmount) : 0;
    const lowStockThreshold = createLowStockThreshold.trim() ? Number(createLowStockThreshold) : 5;
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      setCreateError("מחיר מוצר אינו תקין.");
      return;
    }
    if (baseCost !== null && (!Number.isFinite(baseCost) || baseCost < 0)) {
      setCreateError("עלות בסיס אינה תקינה.");
      return;
    }
    if (!Number.isFinite(purchasedAmount) || purchasedAmount < 0) {
      setCreateError("כמות שנרכשה אינה תקינה.");
      return;
    }

    if (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0) {
      setCreateError("סף מלאי נמוך אינו תקין.");
      return;
    }

    setCreateLoading(true);
    try {
      const res = await fetch("/api/products/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          sku: createCode.trim() || null,
          category_id: selectedCategoryId,
          unit_price: unitPrice,
          base_cost: baseCost,
          purchased_amount: purchasedAmount,
          low_stock_threshold: lowStockThreshold,
          description: createDescription.trim() || null,
          active: createActive,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        warning?: string;
        product?: Record<string, unknown>;
      };
      if (!res.ok || !json.product) {
        setCreateError(toHebrewError(json.error, "יצירת מוצר נכשלה."));
        return;
      }

      setTableError(json.warning ?? "");

      const created: ProductRow = {
        id: typeof json.product.id === "string" ? json.product.id : crypto.randomUUID(),
        name:
          (typeof json.product.name === "string" && json.product.name) ||
          (typeof json.product.product_name === "string" && json.product.product_name) ||
          (typeof json.product.title === "string" && json.product.title) ||
          createName.trim(),
        categoryId:
          (typeof json.product.category_id === "string" && json.product.category_id) || selectedCategoryId || null,
        category:
          (typeof json.product.category_name === "string" && json.product.category_name) ||
          (typeof json.product.category === "string" && json.product.category) ||
          categories.find((category) => category.id === selectedCategoryId)?.name ||
          null,
        code:
          (typeof json.product.sku === "string" && json.product.sku) ||
          (typeof json.product.code === "string" && json.product.code) ||
          (typeof json.product.barcode === "string" && json.product.barcode) ||
          (createCode.trim() || null),
        unitPrice:
          (typeof json.product.base_price === "number" ? json.product.base_price : null) ?? unitPrice,
        baseCost:
          (typeof json.product.base_cost === "number" ? json.product.base_cost : null) ?? baseCost,
        stock:
          (typeof json.product.stock === "number" ? json.product.stock : null) ??
          (typeof json.product.quantity === "number" ? json.product.quantity : null) ??
          (typeof json.product.available_quantity === "number"
            ? json.product.available_quantity
            : null) ??
          (typeof json.product.in_stock === "number" ? json.product.in_stock : null) ??
          null,
        purchasedAmount,
        soldAmount: 0,
        lowStockThreshold:
          (typeof json.product.low_stock_threshold === "number"
            ? json.product.low_stock_threshold
            : null) ?? lowStockThreshold,
        description:
          (typeof json.product.description === "string" ? json.product.description : null) ||
          (createDescription.trim() || null),
        active: typeof json.product.active === "boolean" ? json.product.active : createActive,
      };

      const nextRows = normalizeProducts([created, ...rows]);
      const wasAdded = nextRows.some((row) => row.id === created.id);
      setRows(nextRows);
      if (!wasAdded) {
        setCreateError("המוצר נשמר אך לא עודכן ברשימה. נסו לרענן.");
        return;
      }

      setCreateOpen(false);
      resetCreateForm(selectedCategoryId);
    } catch (err: unknown) {
      setCreateError(toHebrewError(err, "שגיאה לא ידועה"));
    } finally {
      setCreateLoading(false);
    }
  }

  function openEdit(row: ProductRow) {
    setEditError("");
    setEditCategoryError("");
    setEditId(row.id);
    setEditName(row.name);
    setEditCode(row.code ?? "");
    setEditPrice(row.unitPrice !== null ? String(row.unitPrice) : "");
    setEditCost(row.baseCost !== null ? String(row.baseCost) : "");
    setEditCategoryId(row.categoryId ?? "");
    setEditNewCategoryName("");
    setEditPurchasedAmount("");
    setEditLowStockThreshold(
      row.lowStockThreshold !== null && Number.isFinite(row.lowStockThreshold)
        ? String(row.lowStockThreshold)
        : "5"
    );
    setEditDescription(row.description ?? "");
    setEditActive(row.active !== false);
    setEditOpen(true);
  }

  async function saveEdit() {
    if (editLoading) return;
    setTableError("");
    setEditError("");
    setEditCategoryError("");

    if (!editId) return setEditError("מזהה מוצר חסר.");
    if (!editName.trim()) return setEditError("שם מוצר הוא שדה חובה.");

    const selectedCategoryId = normalizeSelectedCategoryId(editCategoryId);
    if (!selectedCategoryId) return setEditError("יש לבחור קטגוריה.");

    const unitPrice = editPrice.trim() ? Number(editPrice) : null;
    const baseCost = editCost.trim() ? Number(editCost) : null;
    const purchasedAmount = editPurchasedAmount.trim() ? Number(editPurchasedAmount) : 0;
    const lowStockThreshold = editLowStockThreshold.trim() ? Number(editLowStockThreshold) : 5;
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      setEditError("מחיר מוצר אינו תקין.");
      return;
    }
    if (baseCost !== null && (!Number.isFinite(baseCost) || baseCost < 0)) {
      setEditError("עלות בסיס אינה תקינה.");
      return;
    }
    if (!Number.isFinite(purchasedAmount) || purchasedAmount < 0) {
      setEditError("כמות שנרכשה אינה תקינה.");
      return;
    }

    if (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0) {
      setEditError("סף מלאי נמוך אינו תקין.");
      return;
    }

    setEditLoading(true);
    try {
      const res = await fetch("/api/products/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: editId,
          name: editName.trim(),
          sku: editCode.trim() || null,
          category_id: selectedCategoryId,
          unit_price: unitPrice,
          base_cost: baseCost,
          purchased_amount: purchasedAmount,
          low_stock_threshold: lowStockThreshold,
          description: editDescription.trim() || null,
          active: editActive,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        warning?: string;
        product?: Record<string, unknown>;
      };
      if (!res.ok || !json.product) {
        setEditError(toHebrewError(json.error, "עדכון מוצר נכשל."));
        return;
      }

      setTableError(json.warning ?? "");

      const updated: ProductRow = {
        id: editId,
        name:
          (typeof json.product.name === "string" && json.product.name) ||
          (typeof json.product.product_name === "string" && json.product.product_name) ||
          (typeof json.product.title === "string" && json.product.title) ||
          editName.trim(),
        categoryId:
          (typeof json.product.category_id === "string" && json.product.category_id) || selectedCategoryId || null,
        category:
          (typeof json.product.category_name === "string" && json.product.category_name) ||
          (typeof json.product.category === "string" && json.product.category) ||
          categories.find((category) => category.id === selectedCategoryId)?.name ||
          rows.find((row) => row.id === editId)?.category ||
          null,
        code:
          (typeof json.product.sku === "string" && json.product.sku) ||
          (typeof json.product.code === "string" && json.product.code) ||
          (typeof json.product.barcode === "string" && json.product.barcode) ||
          (editCode.trim() || null),
        unitPrice:
          (typeof json.product.base_price === "number" ? json.product.base_price : null) ?? unitPrice,
        baseCost:
          (typeof json.product.base_cost === "number" ? json.product.base_cost : null) ?? baseCost,
        stock:
          (typeof json.product.stock === "number" ? json.product.stock : null) ??
          (typeof json.product.quantity === "number" ? json.product.quantity : null) ??
          (typeof json.product.available_quantity === "number"
            ? json.product.available_quantity
            : null) ??
          (typeof json.product.in_stock === "number" ? json.product.in_stock : null) ??
          null,
        purchasedAmount: rows.find((row) => row.id === editId)?.purchasedAmount ?? 0,
        soldAmount: rows.find((row) => row.id === editId)?.soldAmount ?? 0,
        lowStockThreshold:
          (typeof json.product.low_stock_threshold === "number"
            ? json.product.low_stock_threshold
            : null) ?? lowStockThreshold,
        description:
          (typeof json.product.description === "string" ? json.product.description : null) ||
          (editDescription.trim() || null),
        active: typeof json.product.active === "boolean" ? json.product.active : editActive,
      };

      let didUpdate = false;
      const nextRows = normalizeProducts(
        rows.map((r) => {
          if (r.id !== editId) return r;
          didUpdate = true;
          return updated;
        })
      );
      setRows(nextRows);
      if (!didUpdate) {
        setEditError("השינוי נשמר אך לא עודכן בשורה. נסו לרענן.");
        return;
      }

      setEditOpen(false);
    } catch (err: unknown) {
      setEditError(toHebrewError(err, "שגיאה לא ידועה"));
    } finally {
      setEditLoading(false);
    }
  }

  function openDeleteDialog(row: ProductRow) {
    setPendingDelete(row);
    setDeleteConfirmOpen(true);
  }

  async function confirmDeleteProduct() {
    if (!pendingDelete) return;
    if (deleteLoadingId) return;

    setTableError("");
    setDeleteLoadingId(pendingDelete.id);
    try {
      const res = await fetch("/api/products/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: pendingDelete.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setTableError(toHebrewError(json.error, "מחיקת מוצר נכשלה."));
        return;
      }
      const nextRows = rows.filter((item) => item.id !== pendingDelete.id);
      const wasRemoved = nextRows.length < rows.length;
      setRows(nextRows);
      if (!wasRemoved) {
        setTableError("המחיקה בוצעה אך השורה לא ירדה מהרשימה. נסו לרענן.");
        return;
      }

      setDeleteConfirmOpen(false);
      setPendingDelete(null);
    } catch (err: unknown) {
      setTableError(toHebrewError(err, "שגיאה לא ידועה"));
    } finally {
      setDeleteLoadingId("");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש מוצר לפי שם או קוד"
            className="h-11 sm:max-w-sm"
          />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-56"
          >
            <option value="">כל הקטגוריות</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:flex lg:items-center">
          <Button type="button" variant="outline" className="h-11 lg:h-10" onClick={() => void sharePriceList()} disabled={shareLoading}>
            {shareLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span>שליחת מחירון</span>
          </Button>
          <Button type="button" className="h-11 lg:h-10" onClick={openCreateDialog}>
            הוספת מוצר
          </Button>
        </div>
      </div>
      {shareError ? <p className="text-sm text-destructive">{shareError}</p> : null}
      {shareMessage ? <p className="text-sm text-muted-foreground">{shareMessage}</p> : null}

      {/* Off-screen template captured by html2canvas for the price-list PDF.
          Sentinel class names like `bg-header-navy` / `text-on-navy` are remapped
          to brand hex values by applyPdfCaptureColorOverrides() at capture time.
          Uses a fixed-pixel negative offset so it stays off-screen on every
          viewport (a `vw` offset isn't enough on narrow phones). Avoid using
          `opacity-0` or `display:none` — html2canvas honors those at capture
          time and would produce a blank PDF. */}
      <div aria-hidden="true" className="pointer-events-none fixed -left-[9999px] top-0 w-[1120px] bg-page p-8">
        <div
          id={PRICE_LIST_SHARE_CONTENT_ID}
          dir="rtl"
          className="overflow-hidden rounded-[28px] bg-surface text-primary-pdf shadow-brand-pdf"
        >
          <div className="bg-header-navy px-10 py-8 text-on-navy">
            <div className="flex items-start justify-between gap-8">
              <div className="space-y-3">
                <div className="text-xs font-medium tracking-[0.32em] text-on-navy-muted">מחירון</div>
                <div>
                  <h2 className="text-3xl font-semibold">{shareTitle}</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-on-navy-muted">
                    מחירון מוכן לשיתוף עם רשימת המוצרים המסוננת, מסודרת וברורה לשליחה ללקוחות.
                  </p>
                </div>
              </div>
              <div className="min-w-[280px] rounded-3xl border border-white-overlay bg-white-overlay p-5">
                <div className="text-xs font-medium tracking-[0.18em] text-on-navy-muted">נוצר בתאריך</div>
                <div className="mt-2 text-lg font-semibold">{shareDateLabel}</div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-right">
                  <div className="rounded-2xl bg-white-overlay p-3">
                    <div className="text-xs text-on-navy-muted">מוצרים</div>
                    <div className="mt-1 text-xl font-semibold">{filtered.length}</div>
                  </div>
                  <div className="rounded-2xl bg-white-overlay p-3">
                    <div className="text-xs text-on-navy-muted">פעילים</div>
                    <div className="mt-1 text-xl font-semibold">{activeProductsCount}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6 px-10 py-8">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-3xl border border-brand bg-surface-muted p-5">
                <div className="text-xs font-medium tracking-[0.14em] text-muted-pdf">קטגוריה</div>
                <div className="mt-2 text-lg font-semibold">{activeCategoryName ?? "כל הקטגוריות"}</div>
              </div>
              <div className="rounded-3xl border border-brand bg-surface-muted p-5">
                <div className="text-xs font-medium tracking-[0.14em] text-muted-pdf">חיפוש פעיל</div>
                <div className="mt-2 text-lg font-semibold">{query.trim() || "ללא"}</div>
              </div>
              <div className="rounded-3xl border border-brand bg-surface-muted p-5">
                <div className="text-xs font-medium tracking-[0.14em] text-muted-pdf">מחיר ממוצע</div>
                <div className="mt-2 text-lg font-semibold">{averagePrice === null ? "-" : formatCurrency(averagePrice)}</div>
              </div>
            </div>

            <div className="max-h-[70vh] overflow-auto rounded-[24px] border border-brand">
              <table className="w-full border-collapse text-right text-sm">
                <thead className="sticky top-0 z-10 bg-muted-pdf">
                  <tr className="bg-muted-pdf text-muted-pdf">
                    <th className="px-4 py-3 font-medium">מוצר</th>
                    <th className="px-4 py-3 font-medium">קוד</th>
                    <th className="px-4 py-3 font-medium">קטגוריה</th>
                    <th className="px-4 py-3 font-medium">סטטוס</th>
                    <th className="px-4 py-3 font-medium">מחיר</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((product, index) => (
                    <tr key={product.id} className={index % 2 === 0 ? "bg-surface" : "bg-surface-muted"}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-primary-pdf">{product.name}</div>
                        {product.description ? (
                          <div className="mt-1 text-xs leading-5 text-muted-pdf">{product.description}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-muted-pdf">{product.code ?? "-"}</td>
                      <td className="px-4 py-3 text-muted-pdf">{product.category ?? "-"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            product.active === false
                              ? "inline-flex rounded-full bg-muted-pdf px-3 py-1 text-xs font-medium text-muted-pdf"
                              : "inline-flex rounded-full bg-success-soft-pdf px-3 py-1 text-xs font-medium text-success-pdf"
                          }
                        >
                          {product.active === false ? "לא פעיל" : "פעיל"}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-primary-pdf">{formatCurrency(product.unitPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between rounded-3xl bg-footer-navy px-6 py-4 text-sm text-on-navy-muted">
              <span>המחירון הופק מתוך BizManager</span>
              <span>{pricedProductsCount} מוצרים עם מחיר מוגדר</span>
            </div>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין מוצרים להצגה במחירון.</p>
      ) : (
        <>
          <div ref={scrollRef} className="hidden max-h-[70vh] overflow-auto rounded-md border xl:block">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">מוצר</th>
                  <th className="px-3 py-2 text-right font-medium">קוד</th>
                  <th className="px-3 py-2 text-right font-medium">מחיר</th>
                  <th className="px-3 py-2 text-right font-medium">עלות בסיס</th>
                  <th className="px-3 py-2 text-right font-medium">מלאי נוכחי</th>
                  <th className="px-3 py-2 text-right font-medium">כמות שנרכשה</th>
                  <th className="px-3 py-2 text-right font-medium">כמות שנמכרה</th>
                  <th className="px-3 py-2 text-right font-medium">סטטוס</th>
                  <th className="px-3 py-2 text-right font-medium">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((product) => (
                  <tr key={product.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="font-medium">{product.name}</div>
                      {product.category ? (
                        <div className="text-xs text-muted-foreground">{product.category}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{product.code ?? "-"}</td>
                    <td className="px-3 py-2">{formatCurrency(product.unitPrice)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {product.baseCost !== null ? formatCurrency(product.baseCost) : "-"}
                    </td>
                    <td className="px-3 py-2">{product.stock ?? "-"}</td>
                    <td className="px-3 py-2">{product.purchasedAmount}</td>
                    <td className="px-3 py-2">{product.soldAmount}</td>
                    <td className="px-3 py-2">{product.active === false ? "לא פעיל" : "פעיל"}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 w-8 p-0"
                          title="עריכה"
                          aria-label="עריכה"
                          onClick={() => openEdit(product)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          className="h-8 w-8 p-0"
                          title="מחיקה"
                          aria-label="מחיקה"
                          disabled={deleteLoadingId === product.id}
                          onClick={() => openDeleteDialog(product)}
                        >
                          {deleteLoadingId === product.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hasMore ? <div ref={sentinelRef} className="h-1" /> : null}
          </div>

          <div className="grid grid-cols-1 gap-2 xl:hidden">
            {filtered.map((product) => (
              <div
                key={product.id}
                className={`min-w-0 overflow-hidden rounded-lg border ${product.active === false ? "border-border/60 bg-muted/30" : "border-border/70 bg-background"} p-3 shadow-sm`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold leading-tight">{product.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {product.category ?? "ללא קטגוריה"}
                      {product.code ? ` • ${product.code}` : ""}
                      {product.active === false ? " • לא פעיל" : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-left text-sm font-semibold">
                    {formatCurrency(product.unitPrice)}
                  </div>
                </div>

                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                  <span className="text-muted-foreground">
                    עלות:{" "}
                    <span className="font-medium text-foreground">
                      {product.baseCost !== null ? formatCurrency(product.baseCost) : "-"}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    מלאי: <span className="font-medium text-foreground">{product.stock ?? "-"}</span>
                  </span>
                  <span className="text-muted-foreground">
                    נרכש: <span className="font-medium text-foreground">{product.purchasedAmount}</span>
                  </span>
                  <span className="text-muted-foreground">
                    נמכר: <span className="font-medium text-foreground">{product.soldAmount}</span>
                  </span>
                </div>

                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9 w-9 rounded-lg p-0"
                    title="עריכה"
                    aria-label="עריכה"
                    onClick={() => openEdit(product)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="h-9 w-9 rounded-lg p-0"
                    title="מחיקה"
                    aria-label="מחיקה"
                    disabled={deleteLoadingId === product.id}
                    onClick={() => openDeleteDialog(product)}
                  >
                    {deleteLoadingId === product.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {hasMore ? <div ref={mobileSentinelRef} className="h-1 xl:hidden" /> : null}
          <div className="pt-3 text-center text-xs text-muted-foreground">
            {loadingMore
              ? "טוען…"
              : `מציג ${filtered.length}${totalCount != null ? ` מתוך ${totalCount}` : ""} מוצרים`}
          </div>
        </>
      )}
      {tableError ? <p className="text-sm text-destructive">{tableError}</p> : null}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open && createLoading) return;
          setCreateOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>הוספת מוצר</DialogTitle>
            <DialogDescription>הגדירו מוצר חדש למחירון.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void addProduct();
            }}
          >
            <Field label="שם מוצר *">
              <Input value={createName} onChange={(e) => setCreateName(e.target.value)} />
            </Field>
            <Field label="קוד מוצר *">
              <Input value={createCode} onChange={(e) => setCreateCode(e.target.value)} />
            </Field>
            <Field label="קטגוריה *">
              <select
                value={createCategoryId}
                onChange={(e) => setCreateCategoryId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">בחרו קטגוריה</option>
                {categories
                  .filter((category) => category.active)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                <option value={NEW_CATEGORY_VALUE}>+ קטגוריה חדשה</option>
              </select>
            </Field>
            {isCreateNewCategory ? (
              <>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <Field label="שם קטגוריה חדשה">
                    <Input
                      value={createNewCategoryName}
                      onChange={(e) => setCreateNewCategoryName(e.target.value)}
                      placeholder="לדוגמה: מוצרי נקיון"
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={createCategoryLoading}
                    onClick={() => void addCategory("create")}
                  >
                    {createCategoryLoading ? "מוסיף..." : "הוספת קטגוריה"}
                  </Button>
                </div>
                {createCategoryError ? <p className="text-sm text-destructive">{createCategoryError}</p> : null}
              </>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="מחיר מכירה">
                <CurrencyInput value={createPrice} onChange={(e) => setCreatePrice(e.target.value)} />
              </Field>
              <Field label="עלות בסיס">
                <CurrencyInput value={createCost} onChange={(e) => setCreateCost(e.target.value)} />
              </Field>
            </div>
            <Field label="כמות שנרכשה">
              <Input
                value={createPurchasedAmount}
                onChange={(e) => setCreatePurchasedAmount(e.target.value)}
                inputMode="decimal"
                placeholder="לדוגמה: 25"
              />
            </Field>
            <Field label="תיאור">
              <Textarea value={createDescription} onChange={(e) => setCreateDescription(e.target.value)} rows={3} />
            </Field>
            <Field label="סף מלאי נמוך">
              <Input
                value={createLowStockThreshold}
                onChange={(e) => setCreateLowStockThreshold(e.target.value)}
                inputMode="decimal"
                placeholder="לדוגמה: 5"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={createActive}
                onChange={(e) => setCreateActive(e.target.checked)}
              />
              <span>מוצר פעיל</span>
            </label>
            {createError ? <p className="text-sm text-destructive">{createError}</p> : null}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)} disabled={createLoading}>
                ביטול
              </Button>
              <Button type="submit" disabled={createLoading}>
                {createLoading ? "שומר..." : "שמירת מוצר"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          if (!open && editLoading) return;
          setEditOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>עריכת מוצר</DialogTitle>
            <DialogDescription>עדכון פרטי מוצר במחירון.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void saveEdit();
            }}
          >
            <Field label="שם מוצר *">
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </Field>
            <Field label="קוד מוצר *">
              <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} />
            </Field>
            <Field label="קטגוריה *">
              <select
                value={editCategoryId}
                onChange={(e) => setEditCategoryId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">בחרו קטגוריה</option>
                {categories
                  .filter((category) => category.active || category.id === editCategoryId)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                <option value={NEW_CATEGORY_VALUE}>+ קטגוריה חדשה</option>
              </select>
            </Field>
            {isEditNewCategory ? (
              <>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <Field label="שם קטגוריה חדשה">
                    <Input
                      value={editNewCategoryName}
                      onChange={(e) => setEditNewCategoryName(e.target.value)}
                      placeholder="לדוגמה: מוצרי נקיון"
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={editCategoryLoading}
                    onClick={() => void addCategory("edit")}
                  >
                    {editCategoryLoading ? "מוסיף..." : "הוספת קטגוריה"}
                  </Button>
                </div>
                {editCategoryError ? <p className="text-sm text-destructive">{editCategoryError}</p> : null}
              </>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="מחיר מכירה">
                <CurrencyInput value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
              </Field>
              <Field label="עלות בסיס">
                <CurrencyInput value={editCost} onChange={(e) => setEditCost(e.target.value)} />
              </Field>
            </div>
            <Field label="כמות שנרכשה">
              <Input
                value={editPurchasedAmount}
                onChange={(e) => setEditPurchasedAmount(e.target.value)}
                inputMode="decimal"
                placeholder={`כמות קיימת: ${String(rows.find((row) => row.id === editId)?.purchasedAmount ?? 0)}`}
              />
            </Field>
            <Field label="תיאור">
              <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} />
            </Field>
            <Field label="סף מלאי נמוך">
              <Input
                value={editLowStockThreshold}
                onChange={(e) => setEditLowStockThreshold(e.target.value)}
                inputMode="decimal"
                placeholder="לדוגמה: 5"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editActive}
                onChange={(e) => setEditActive(e.target.checked)}
              />
              <span>מוצר פעיל</span>
            </label>
            {editError ? <p className="text-sm text-destructive">{editError}</p> : null}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setEditOpen(false)} disabled={editLoading}>
                ביטול
              </Button>
              <Button type="submit" disabled={editLoading}>
                {editLoading ? "שומר..." : "שמירת שינויים"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          if (!open && deleteLoadingId) return;
          setDeleteConfirmOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>אישור מחיקה</DialogTitle>
            <DialogDescription>
              האם למחוק את המוצר {pendingDelete ? `"${pendingDelete.name}"` : ""}? פעולה זו אינה הפיכה.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={Boolean(deleteLoadingId)}
              onClick={() => {
                setDeleteConfirmOpen(false);
                setPendingDelete(null);
              }}
            >
              ביטול
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!pendingDelete || deleteLoadingId === pendingDelete.id}
              onClick={() => void confirmDeleteProduct()}
            >
              {pendingDelete && deleteLoadingId === pendingDelete.id ? "מוחק..." : "מחיקה"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
