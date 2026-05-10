"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

type ProductRow = {
  id: string;
  name: string;
  categoryId: string | null;
  category: string | null;
  lowStockThreshold: number | null;
  code: string | null;
  unitPrice: number | null;
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
}: {
  initialProducts: ProductRow[];
  initialCategories: CategoryOption[];
}) {
  const [rows, setRows] = useState<ProductRow[]>(initialProducts);
  const [categories, setCategories] = useState<CategoryOption[]>(initialCategories);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

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
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ProductRow | null>(null);
  const isCreateNewCategory = createCategoryId === NEW_CATEGORY_VALUE;
  const isEditNewCategory = editCategoryId === NEW_CATEGORY_VALUE;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesCategory = !categoryFilter || row.categoryId === categoryFilter;
      const matchesQuery =
        !q ||
        row.name.toLowerCase().includes(q) ||
        (row.category ?? "").toLowerCase().includes(q) ||
        (row.code ?? "").toLowerCase().includes(q);

      return matchesCategory && matchesQuery;
    });
  }, [rows, query, categoryFilter]);

  function normalizeProducts(list: ProductRow[]) {
    return [...list].sort((a, b) => a.name.localeCompare(b.name, "he"));
  }

  function normalizeCategories(list: CategoryOption[]) {
    return [...list].sort((a, b) => a.name.localeCompare(b.name, "he"));
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
        const message = json.error ?? "יצירת קטגוריה נכשלה.";
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
      const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
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
        setCreateError(json.error ?? "יצירת מוצר נכשלה.");
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
      setCreateError(err instanceof Error ? err.message : "שגיאה לא ידועה");
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
    setEditCost("");
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
        setEditError(json.error ?? "עדכון מוצר נכשל.");
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
      setEditError(err instanceof Error ? err.message : "שגיאה לא ידועה");
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
        setTableError(json.error ?? "מחיקת מוצר נכשלה.");
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
      setTableError(err instanceof Error ? err.message : "שגיאה לא ידועה");
    } finally {
      setDeleteLoadingId("");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש מוצר לפי שם או קוד"
          className="max-w-sm"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-56"
        >
          <option value="">כל הקטגוריות</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        </div>
        <Button type="button" onClick={openCreateDialog}>
          הוספת מוצר
        </Button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין מוצרים להצגה במחירון.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="min-w-[1040px] w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-right font-medium">מוצר</th>
                <th className="px-3 py-2 text-right font-medium">קוד</th>
                <th className="px-3 py-2 text-right font-medium">מחיר</th>
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
                  <td className="px-3 py-2">{product.stock ?? "-"}</td>
                  <td className="px-3 py-2">{product.purchasedAmount}</td>
                  <td className="px-3 py-2">{product.soldAmount}</td>
                  <td className="px-3 py-2">{product.active === false ? "לא פעיל" : "פעיל"}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => openEdit(product)}>
                        עריכה
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={deleteLoadingId === product.id}
                        onClick={() => openDeleteDialog(product)}
                      >
                        {deleteLoadingId === product.id ? "מוחק..." : "מחיקה"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
            <Field label="קוד מוצר">
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
                <Input value={createPrice} onChange={(e) => setCreatePrice(e.target.value)} inputMode="decimal" />
              </Field>
              <Field label="עלות בסיס">
                <Input value={createCost} onChange={(e) => setCreateCost(e.target.value)} inputMode="decimal" />
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
            <Field label="קוד מוצר">
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
                <Input value={editPrice} onChange={(e) => setEditPrice(e.target.value)} inputMode="decimal" />
              </Field>
              <Field label="עלות בסיס">
                <Input value={editCost} onChange={(e) => setEditCost(e.target.value)} inputMode="decimal" />
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
