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

type ProductRow = {
  id: string;
  name: string;
  code: string | null;
  unitPrice: number | null;
  stock: number | null;
  notes?: string | null;
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

export default function PriceListClient({ initialProducts }: { initialProducts: ProductRow[] }) {
  const [rows, setRows] = useState<ProductRow[]>(initialProducts);
  const [query, setQuery] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createName, setCreateName] = useState("");
  const [createCode, setCreateCode] = useState("");
  const [createPrice, setCreatePrice] = useState("");
  const [createStock, setCreateStock] = useState("");
  const [createNotes, setCreateNotes] = useState("");
  const [createActive, setCreateActive] = useState(true);

  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editStock, setEditStock] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editActive, setEditActive] = useState(true);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      return row.name.toLowerCase().includes(q) || (row.code ?? "").toLowerCase().includes(q);
    });
  }, [rows, query]);

  function normalizeProducts(list: ProductRow[]) {
    return [...list].sort((a, b) => a.name.localeCompare(b.name, "he"));
  }

  async function addProduct() {
    if (createLoading) return;
    setCreateError("");

    if (!createName.trim()) {
      setCreateError("שם מוצר הוא שדה חובה.");
      return;
    }

    const unitPrice = createPrice.trim() ? Number(createPrice) : null;
    const stock = createStock.trim() ? Number(createStock) : null;
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      setCreateError("מחיר מוצר אינו תקין.");
      return;
    }
    if (stock !== null && !Number.isFinite(stock)) {
      setCreateError("כמות מלאי אינה תקינה.");
      return;
    }

    setCreateLoading(true);
    try {
      const res = await fetch("/api/products/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          code: createCode.trim() || null,
          unit_price: unitPrice,
          stock,
          notes: createNotes.trim() || null,
          active: createActive,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        product?: Record<string, unknown>;
      };
      if (!res.ok || !json.product) {
        setCreateError(json.error ?? "יצירת מוצר נכשלה.");
        return;
      }

      const created: ProductRow = {
        id: typeof json.product.id === "string" ? json.product.id : crypto.randomUUID(),
        name:
          (typeof json.product.name === "string" && json.product.name) ||
          (typeof json.product.product_name === "string" && json.product.product_name) ||
          (typeof json.product.title === "string" && json.product.title) ||
          createName.trim(),
        code:
          (typeof json.product.sku === "string" && json.product.sku) ||
          (typeof json.product.code === "string" && json.product.code) ||
          (typeof json.product.barcode === "string" && json.product.barcode) ||
          (createCode.trim() || null),
        unitPrice:
          (typeof json.product.sale_price === "number" ? json.product.sale_price : null) ??
          (typeof json.product.selling_price === "number" ? json.product.selling_price : null) ??
          (typeof json.product.price === "number" ? json.product.price : null) ??
          (typeof json.product.unit_price === "number" ? json.product.unit_price : null) ??
          (typeof json.product.retail_price === "number" ? json.product.retail_price : null) ??
          unitPrice,
        stock:
          (typeof json.product.stock === "number" ? json.product.stock : null) ??
          (typeof json.product.quantity === "number" ? json.product.quantity : null) ??
          (typeof json.product.available_quantity === "number"
            ? json.product.available_quantity
            : null) ??
          (typeof json.product.in_stock === "number" ? json.product.in_stock : null) ??
          stock,
        notes:
          (typeof json.product.notes === "string" ? json.product.notes : null) ||
          (createNotes.trim() || null),
        active: typeof json.product.active === "boolean" ? json.product.active : createActive,
      };

      setRows((prev) => normalizeProducts([created, ...prev]));
      setCreateOpen(false);
      setCreateName("");
      setCreateCode("");
      setCreatePrice("");
      setCreateStock("");
      setCreateNotes("");
      setCreateActive(true);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "שגיאה לא ידועה");
    } finally {
      setCreateLoading(false);
    }
  }

  function openEdit(row: ProductRow) {
    setEditError("");
    setEditId(row.id);
    setEditName(row.name);
    setEditCode(row.code ?? "");
    setEditPrice(row.unitPrice !== null ? String(row.unitPrice) : "");
    setEditStock(row.stock !== null ? String(row.stock) : "");
    setEditNotes(row.notes ?? "");
    setEditActive(row.active !== false);
    setEditOpen(true);
  }

  async function saveEdit() {
    if (editLoading) return;
    setEditError("");

    if (!editId) return setEditError("מזהה מוצר חסר.");
    if (!editName.trim()) return setEditError("שם מוצר הוא שדה חובה.");

    const unitPrice = editPrice.trim() ? Number(editPrice) : null;
    const stock = editStock.trim() ? Number(editStock) : null;
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      setEditError("מחיר מוצר אינו תקין.");
      return;
    }
    if (stock !== null && !Number.isFinite(stock)) {
      setEditError("כמות מלאי אינה תקינה.");
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
          code: editCode.trim() || null,
          unit_price: unitPrice,
          stock,
          notes: editNotes.trim() || null,
          active: editActive,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        product?: Record<string, unknown>;
      };
      if (!res.ok || !json.product) {
        setEditError(json.error ?? "עדכון מוצר נכשל.");
        return;
      }

      const updated: ProductRow = {
        id: editId,
        name:
          (typeof json.product.name === "string" && json.product.name) ||
          (typeof json.product.product_name === "string" && json.product.product_name) ||
          (typeof json.product.title === "string" && json.product.title) ||
          editName.trim(),
        code:
          (typeof json.product.sku === "string" && json.product.sku) ||
          (typeof json.product.code === "string" && json.product.code) ||
          (typeof json.product.barcode === "string" && json.product.barcode) ||
          (editCode.trim() || null),
        unitPrice:
          (typeof json.product.sale_price === "number" ? json.product.sale_price : null) ??
          (typeof json.product.selling_price === "number" ? json.product.selling_price : null) ??
          (typeof json.product.price === "number" ? json.product.price : null) ??
          (typeof json.product.unit_price === "number" ? json.product.unit_price : null) ??
          (typeof json.product.retail_price === "number" ? json.product.retail_price : null) ??
          unitPrice,
        stock:
          (typeof json.product.stock === "number" ? json.product.stock : null) ??
          (typeof json.product.quantity === "number" ? json.product.quantity : null) ??
          (typeof json.product.available_quantity === "number"
            ? json.product.available_quantity
            : null) ??
          (typeof json.product.in_stock === "number" ? json.product.in_stock : null) ??
          stock,
        notes:
          (typeof json.product.notes === "string" ? json.product.notes : null) ||
          (editNotes.trim() || null),
        active: typeof json.product.active === "boolean" ? json.product.active : editActive,
      };

      setRows((prev) => normalizeProducts(prev.map((r) => (r.id === editId ? updated : r))));
      setEditOpen(false);
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "שגיאה לא ידועה");
    } finally {
      setEditLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש מוצר לפי שם או קוד"
          className="max-w-sm"
        />
        <Button type="button" onClick={() => setCreateOpen(true)}>
          הוספת מוצר
        </Button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין מוצרים להצגה במחירון.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="min-w-[920px] w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-right font-medium">מוצר</th>
                <th className="px-3 py-2 text-right font-medium">קוד</th>
                <th className="px-3 py-2 text-right font-medium">מחיר</th>
                <th className="px-3 py-2 text-right font-medium">מלאי נוכחי</th>
                <th className="px-3 py-2 text-right font-medium">סטטוס</th>
                <th className="px-3 py-2 text-right font-medium">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((product) => (
                <tr key={product.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2">{product.name}</td>
                  <td className="px-3 py-2">{product.code ?? "-"}</td>
                  <td className="px-3 py-2">{formatCurrency(product.unitPrice)}</td>
                  <td className="px-3 py-2">{product.stock ?? "-"}</td>
                  <td className="px-3 py-2">{product.active === false ? "לא פעיל" : "פעיל"}</td>
                  <td className="px-3 py-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => openEdit(product)}>
                      עריכה
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
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
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="מחיר מכירה">
                <Input value={createPrice} onChange={(e) => setCreatePrice(e.target.value)} inputMode="decimal" />
              </Field>
              <Field label="מלאי התחלתי">
                <Input value={createStock} onChange={(e) => setCreateStock(e.target.value)} inputMode="decimal" />
              </Field>
            </div>
            <Field label="הערות">
              <Textarea value={createNotes} onChange={(e) => setCreateNotes(e.target.value)} rows={3} />
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
              <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
                ביטול
              </Button>
              <Button type="submit" disabled={createLoading}>
                {createLoading ? "שומר..." : "שמירת מוצר"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
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
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="מחיר מכירה">
                <Input value={editPrice} onChange={(e) => setEditPrice(e.target.value)} inputMode="decimal" />
              </Field>
              <Field label="מלאי נוכחי">
                <Input value={editStock} onChange={(e) => setEditStock(e.target.value)} inputMode="decimal" />
              </Field>
            </div>
            <Field label="הערות">
              <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3} />
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
              <Button type="button" variant="secondary" onClick={() => setEditOpen(false)}>
                ביטול
              </Button>
              <Button type="submit" disabled={editLoading}>
                {editLoading ? "שומר..." : "שמירת שינויים"}
              </Button>
            </DialogFooter>
          </form>
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
