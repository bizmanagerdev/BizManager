"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreateCustomerDialog } from "@/components/customers/CreateCustomerDialog";
import type { CreatedCustomer } from "@/components/customers/CreateCustomerDialog";
import { InlineCustomerEditor } from "@/components/customers/InlineCustomerEditor";
import type { InlineCustomerUpdate } from "@/components/customers/InlineCustomerEditor";
import {
  ORDER_PAYMENT_METHOD_OPTIONS,
  derivePaymentStatus,
  paymentMethodLabel,
  paymentStatusLabel,
} from "@/lib/orders/paymentStatus";

type Row = Record<string, unknown>;

type OrderLine = {
  product_id: string;
  product_name: string;
  quantity_ordered: number;
  unit_price: number;
  discount_amount: number;
  notes: string;
};

type CustomerOption = {
  id: string;
  name: string;
  nameForInvoice: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
  requiresPrepayment: boolean;
  contacts?: Array<{ full_name: string; phone: string | null; email: string | null }>;
};

type ProductOption = {
  id: string;
  name: string;
  code: string | null;
  unitPrice: number;
  stock: number | null;
};

type InitialOrder = {
  id: string;
  customer_id: string;
  order_date: string;
  status: string;
  payment_status: string;
  discount_amount: number;
  notes: string;
  items: OrderLine[];
};

type PaymentRow = {
  id: string;
  payment_date: string | null;
  amount_total: number;
  payment_method: string;
  reference_number: string;
  notes: string;
};

type PaymentDraft = {
  payment_date: string;
  amount_total: string;
  payment_method: string;
  reference_number: string;
  notes: string;
};

function getString(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function getNumber(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function toPositiveInt(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.round(value));
}

function toNonNegativeInt(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  }).format(value);
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizePhone(value: string) {
  return value.replace(/[^\d+]/g, "");
}

function mapCustomerSearchResult(row: Record<string, unknown>): CustomerOption | null {
  const id = typeof row.id === "string" ? row.id : "";
  if (!id) return null;

  const contacts = Array.isArray(row.contacts)
    ? (row.contacts as Array<Record<string, unknown>>).map((c) => ({
        full_name: typeof c.full_name === "string" ? c.full_name : "",
        phone: typeof c.phone === "string" ? c.phone : null,
        email: typeof c.email === "string" ? c.email : null,
      }))
    : undefined;

  return {
    id,
    name: (typeof row.name === "string" && row.name.trim() ? row.name.trim() : null) ?? "לקוח",
    nameForInvoice: typeof row.name_for_invoice === "string" && row.name_for_invoice.trim() ? row.name_for_invoice.trim() : null,
    phone: typeof row.phone === "string" ? row.phone : null,
    email: typeof row.email === "string" ? row.email : null,
    address: typeof row.address === "string" ? row.address : null,
    city: typeof row.address === "string" ? extractCityFromAddress(row.address) : null,
    requiresPrepayment: row.requires_prepayment === true,
    contacts,
  };
}

function ValueField({
  label,
  value,
  className = "",
  valueClassName = "",
}: {
  label: string;
  value: string;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={`rounded-xl border border-border/70 bg-background/70 px-4 py-3 ${className}`.trim()}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`mt-2 text-sm font-medium leading-6 text-foreground ${valueClassName}`.trim()}>{value}</div>
    </div>
  );
}

function extractCityFromAddress(address: string | null) {
  if (!address) return null;
  const normalized = address.trim();
  if (!normalized) return null;
  const first = normalized.split("|")[0]?.trim() ?? "";
  return first || null;
}

const ORDER_STATUS_OPTIONS = [
  { value: "draft", label: "פתוחה" },
  { value: "confirmed", label: "מאושרת" },
  { value: "processing", label: "בטיפול" },
  { value: "out_for_delivery", label: "במשלוח" },
  { value: "delivered", label: "סופקה" },
  { value: "completed", label: "הושלמה" },
  { value: "closed", label: "סגורה" },
  { value: "cancelled", label: "בוטלה" },
] as const;

export default function NewOrderClient({
  customers,
  products,
  customersError,
  productsError,
  mode = "create",
  initialOrder = null,
  initialPayments = [],
  embedded = false,
  onCancel,
  onSubmitted,
  onActionLockedChange,
  initialStatusOverride,
}: {
  customers: Row[];
  products: Row[];
  customersError: string | null;
  productsError: string | null;
  mode?: "create" | "edit";
  initialOrder?: InitialOrder | null;
  initialPayments?: PaymentRow[];
  embedded?: boolean;
  onCancel?: () => void;
  onSubmitted?: (orderId: string) => void;
  onActionLockedChange?: (locked: boolean) => void;
  initialStatusOverride?: string;
  allowOrderStatusEdit?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillHandled = useRef(false);
  const isEditMode = mode === "edit" && initialOrder !== null;
  const cancelHref = isEditMode ? `/sales/orders/${initialOrder.id}` : "/sales";

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [customerId, setCustomerId] = useState(initialOrder?.customer_id ?? "");
  const [customerQuery, setCustomerQuery] = useState("");
  const [orderDate, setOrderDate] = useState(
    initialOrder?.order_date ?? new Date().toISOString().slice(0, 10)
  );
  const [orderStatus, setOrderStatus] = useState(
    initialStatusOverride ?? initialOrder?.status ?? "draft"
  );
  const [orderDiscount, setOrderDiscount] = useState(String(initialOrder?.discount_amount ?? 0));
  const [notes, setNotes] = useState(initialOrder?.notes ?? "");

  const [productQuery, setProductQuery] = useState("");
  const [lines, setLines] = useState<OrderLine[]>(initialOrder?.items ?? []);
  const [newPayments, setNewPayments] = useState<PaymentDraft[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const actionLocked = submitting;

  useEffect(() => {
    onActionLockedChange?.(actionLocked);
  }, [actionLocked, onActionLockedChange]);

  const initialCustomerOptions = useMemo(
    () =>
      customers
        .map((row) => ({
          id: getString(row, ["id", "customer_id"]) ?? "",
          name:
            getString(row, ["name", "customer_name", "name_for_invoice", "email", "phone"]) ??
            "לקוח",
          nameForInvoice: getString(row, ["name_for_invoice"]),
          phone: getString(row, ["phone", "mobile", "tel"]),
          email: getString(row, ["email"]),
          address: getString(row, ["address"]),
          city: extractCityFromAddress(getString(row, ["address"])),
          requiresPrepayment: row.requires_prepayment === true,
        }))
        .filter((row) => row.id),
    [customers]
  );

  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>(initialCustomerOptions);
  const [customerSearchError, setCustomerSearchError] = useState<string | null>(null);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);

  useEffect(() => {
    setCustomerOptions(initialCustomerOptions);
  }, [initialCustomerOptions]);

  useEffect(() => {
    if (prefillHandled.current && !isEditMode) return;

    const selectedId = initialOrder?.customer_id ?? "";
    if (selectedId) {
      const matchedInitial = initialCustomerOptions.find((row) => row.id === selectedId) ?? null;
      if (matchedInitial) {
        setCustomerId(matchedInitial.id);
        setCustomerQuery(matchedInitial.name);
        prefillHandled.current = true;
        return;
      }
    }

    if (prefillHandled.current) return;

    const prefillCustomerId = (searchParams.get("customer_id") ?? "").trim();
    if (!prefillCustomerId) {
      prefillHandled.current = true;
      return;
    }

    const matched = initialCustomerOptions.find((row) => row.id === prefillCustomerId) ?? null;
    if (matched) {
      setCustomerId(matched.id);
      setCustomerQuery(matched.name);
      setStep(2);
    }

    prefillHandled.current = true;
  }, [initialCustomerOptions, initialOrder?.customer_id, isEditMode, searchParams]);

  const initialProductOptions = useMemo(
    () =>
      products
        .map((row) => {
          const id = getString(row, ["id"]) ?? "";
          const name = getString(row, ["name", "product_name", "title", "sku"]) ?? "מוצר";
          const code = getString(row, ["sku", "code", "barcode"]);
          const unitPrice = getNumber(row, ["base_price"]) ?? 0;
          const stock = getNumber(row, ["stock", "quantity", "available_quantity", "in_stock"]);
          return { id, name, code, unitPrice, stock };
        })
        .filter((row): row is ProductOption => Boolean(row.id)),
    [products]
  );

  const [productOptions, setProductOptions] = useState<ProductOption[]>(initialProductOptions);
  const [productSearchError, setProductSearchError] = useState<string | null>(null);
  const [productSearchLoading, setProductSearchLoading] = useState(false);

  useEffect(() => {
    setProductOptions(initialProductOptions);
  }, [initialProductOptions]);

  useEffect(() => {
    const q = customerQuery.trim();
    const qPhone = normalizePhone(customerQuery);

    if (!q && !qPhone) {
      if (initialCustomerOptions.length > 0) {
        setCustomerOptions(initialCustomerOptions);
        setCustomerSearchError(null);
        setCustomerSearchLoading(false);
        return;
      }

      const controller = new AbortController();
      setCustomerSearchLoading(true);
      setCustomerSearchError(null);

      void fetch("/api/customers/search?limit=50", {
        signal: controller.signal,
      })
        .then(async (res) => {
          const json = (await res.json().catch(() => ({}))) as {
            error?: string;
            customers?: Array<Record<string, unknown>>;
          };
          if (!res.ok) throw new Error(json.error ?? "Customer search failed");

          const remoteCustomers = (json.customers ?? [])
            .map(mapCustomerSearchResult)
            .filter((row): row is CustomerOption => Boolean(row));

          setCustomerOptions((prev) => {
            const selected = prev.find((row) => row.id === customerId);
            return Array.from(
              new Map([selected, ...remoteCustomers].filter(Boolean).map((row) => [row!.id, row!])).values()
            );
          });
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === "AbortError") return;
          setCustomerSearchError(error instanceof Error ? error.message : "שגיאת חיפוש לקוחות");
        })
        .finally(() => setCustomerSearchLoading(false));

      return () => controller.abort();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setCustomerSearchLoading(true);
      setCustomerSearchError(null);

      void fetch(`/api/customers/search?q=${encodeURIComponent(customerQuery)}&limit=50`, {
        signal: controller.signal,
      })
        .then(async (res) => {
          const json = (await res.json().catch(() => ({}))) as {
            error?: string;
            customers?: Array<Record<string, unknown>>;
          };
          if (!res.ok) throw new Error(json.error ?? "Customer search failed");

          const remoteCustomers = (json.customers ?? [])
            .map(mapCustomerSearchResult)
            .filter((row): row is CustomerOption => Boolean(row));

          setCustomerOptions((prev) => {
            const selected = prev.find((row) => row.id === customerId);
            return Array.from(
              new Map([selected, ...remoteCustomers].filter(Boolean).map((row) => [row!.id, row!])).values()
            );
          });
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === "AbortError") return;
          setCustomerSearchError(error instanceof Error ? error.message : "שגיאת חיפוש לקוחות");
        })
        .finally(() => setCustomerSearchLoading(false));

    }, 250);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [customerId, customerQuery, initialCustomerOptions]);

  useEffect(() => {
    const q = productQuery.trim();

    if (!q) {
      setProductOptions(initialProductOptions);
      setProductSearchError(null);
      setProductSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setProductSearchLoading(true);
      setProductSearchError(null);

      void fetch(`/api/products/search?q=${encodeURIComponent(productQuery)}&limit=50`, {
        signal: controller.signal,
      })
        .then(async (res) => {
          const json = (await res.json().catch(() => ({}))) as {
            error?: string;
            products?: Row[];
          };
          if (!res.ok) throw new Error(json.error ?? "Product search failed");

          const remoteProducts = (json.products ?? [])
            .map((row): ProductOption => {
              const id = getString(row, ["id"]) ?? "";
              const name = getString(row, ["name", "product_name", "title", "sku"]) ?? "מוצר";
              const code = getString(row, ["sku", "code", "barcode"]);
              const unitPrice = getNumber(row, ["base_price"]) ?? 0;
              return { id, name, code, unitPrice, stock: null };
            })
            .filter((row): row is ProductOption => Boolean(row.id));

          setProductOptions((prev) => {
            const selectedProducts = lines
              .map((line) => prev.find((row) => row.id === line.product_id))
              .filter((row): row is ProductOption => Boolean(row));
            return Array.from(
              new Map([...selectedProducts, ...remoteProducts].map((row) => [row.id, row])).values()
            );
          });
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === "AbortError") return;
          setProductSearchError(error instanceof Error ? error.message : "שגיאת חיפוש מוצרים");
        })
        .finally(() => setProductSearchLoading(false));

    }, 250);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [initialProductOptions, lines, productQuery]);

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return productOptions.slice(0, 80);
    return productOptions
      .filter((p) => p.name.toLowerCase().includes(q) || (p.code ?? "").toLowerCase().includes(q))
      .slice(0, 80);
  }, [productOptions, productQuery]);

  const selectedLineByProductId = useMemo(
    () =>
      new Map(
        lines.map((line, index) => [
          line.product_id,
          { line, index },
        ])
      ),
    [lines]
  );

  // The API already filters by name/email/phone/address/contacts — return results directly.
  // Local re-filtering would incorrectly exclude contact-matched customers (whose customer fields don't contain the query).
  const filteredCustomers = useMemo(() => customerOptions.slice(0, 50), [customerOptions]);

  const subtotal = useMemo(
    () =>
      lines.reduce(
        (sum, line) => sum + line.quantity_ordered * line.unit_price - line.discount_amount,
        0
      ),
    [lines]
  );
  const totalUnits = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity_ordered, 0),
    [lines]
  );

  const orderDiscountNumber = Number(orderDiscount || 0);
  const effectiveOrderDiscount = Number.isFinite(orderDiscountNumber) ? orderDiscountNumber : 0;
  const totalAmount = subtotal - effectiveOrderDiscount;
  const existingPaidTotal = useMemo(
    () => initialPayments.reduce((sum, payment) => sum + payment.amount_total, 0),
    [initialPayments]
  );
  const newPaidTotal = useMemo(
    () =>
      newPayments.reduce((sum, payment) => {
        const amount = Number(payment.amount_total || 0);
        return sum + (Number.isFinite(amount) ? amount : 0);
      }, 0),
    [newPayments]
  );
  const combinedPaidTotal = existingPaidTotal + newPaidTotal;
  const remainingBalance = Math.max(totalAmount - combinedPaidTotal, 0);
  const paymentStatus = derivePaymentStatus(totalAmount, combinedPaidTotal);

  const selectedCustomer = customerOptions.find((c) => c.id === customerId) ?? null;

  function addProduct(productId: string) {
    const product = productOptions.find((p) => p.id === productId);
    if (!product) return;

    setLines((prev) => {
      const existing = prev.find((line) => line.product_id === productId);
      if (existing) {
        return prev.map((line) =>
          line.product_id === productId
            ? { ...line, quantity_ordered: line.quantity_ordered + 1 }
            : line
        );
      }

      return [
        ...prev,
        {
          product_id: product.id,
          product_name: product.name,
          quantity_ordered: 1,
          unit_price: product.unitPrice,
          discount_amount: 0,
          notes: "",
        },
      ];
    });
  }

  function updateLine(index: number, patch: Partial<OrderLine>) {
    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const next = { ...line, ...patch };
        return {
          ...next,
          quantity_ordered: toPositiveInt(next.quantity_ordered),
          unit_price: toNonNegativeInt(next.unit_price),
          discount_amount: toNonNegativeInt(next.discount_amount),
        };
      })
    );
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function incrementLine(index: number) {
    setLines((prev) =>
      prev.map((line, i) =>
        i === index ? { ...line, quantity_ordered: line.quantity_ordered + 1 } : line
      )
    );
  }

  function decrementLine(index: number) {
    setLines((prev) =>
      prev.map((line, i) =>
        i === index
          ? { ...line, quantity_ordered: Math.max(1, line.quantity_ordered - 1) }
          : line
      )
    );
  }

  function addPaymentDraft() {
    setNewPayments((prev) => [
      ...prev,
      {
        payment_date: getTodayDate(),
        amount_total: "",
        payment_method: "",
        reference_number: "",
        notes: "",
      },
    ]);
  }

  function updatePaymentDraft(index: number, patch: Partial<PaymentDraft>) {
    setNewPayments((prev) => prev.map((payment, i) => (i === index ? { ...payment, ...patch } : payment)));
  }

  function removePaymentDraft(index: number) {
    setNewPayments((prev) => prev.filter((_, i) => i !== index));
  }

  async function submitOrder() {
    if (submitting) return;
    setSubmitError(null);

    if (!customerId) {
      setSubmitError("יש לבחור לקוח.");
      return;
    }
    if (!orderDate) {
      setSubmitError("יש להזין תאריך הזמנה.");
      return;
    }
    if (lines.length === 0) {
      setSubmitError("יש להוסיף לפחות מוצר אחד.");
      return;
    }

    const invalidLine = lines.find(
      (line) =>
        !line.product_id ||
        !Number.isFinite(line.quantity_ordered) ||
        line.quantity_ordered <= 0 ||
        !Number.isFinite(line.unit_price)
    );

    if (invalidLine) {
      setSubmitError("אחת משורות ההזמנה אינה תקינה.");
      return;
    }

    const invalidPayment = newPayments.find((payment) => {
      const amount = Number(payment.amount_total || 0);
      return (
        !Number.isFinite(amount) ||
        amount <= 0 ||
        !payment.payment_date ||
        !payment.payment_method
      );
    });

    if (invalidPayment) {
      setSubmitError("יש להשלים לכל תשלום חדש סכום, תאריך ואמצעי תשלום.");
      return;
    }

    if (selectedCustomer?.requiresPrepayment && remainingBalance > 0.009) {
      setSubmitError("לקוח זה מוגדר לתשלום מראש. יש להשלים את מלוא התשלום לפני שמירת ההזמנה.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(isEditMode ? "/api/orders/update" : "/api/orders/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          order_id: initialOrder?.id,
          customer_id: customerId,
          order_date: orderDate,
          status: orderStatus,
          payment_status: paymentStatus,
          discount_amount: Number.isFinite(orderDiscountNumber) ? orderDiscountNumber : 0,
          notes: notes.trim() || null,
          payments: newPayments.map((payment) => ({
            amount_total: Number(payment.amount_total || 0),
            payment_date: payment.payment_date,
            payment_method: payment.payment_method,
            reference_number: payment.reference_number.trim() || null,
            notes: payment.notes.trim() || null,
          })),
          items: lines.map((line) => ({
            product_id: line.product_id,
            quantity_ordered: line.quantity_ordered,
            unit_price: line.unit_price,
            discount_amount: line.discount_amount,
            notes: line.notes.trim() || null,
          })),
        }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        order_id?: string;
      };

      if (!res.ok || !json.order_id) {
        setSubmitError(json.error ?? (isEditMode ? "עדכון ההזמנה נכשל." : "יצירת ההזמנה נכשלה."));
        return;
      }

      if (embedded) {
        onSubmitted?.(json.order_id);
        router.refresh();
      } else {
        emitNavigationStart();
        router.push("/sales");
        router.refresh();
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "שגיאה לא ידועה";
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <div className={step === 1 ? "font-semibold" : "text-muted-foreground"}>1. לקוח</div>
        <div className="text-muted-foreground">/</div>
        <div className={step === 2 ? "font-semibold" : "text-muted-foreground"}>2. מוצרים</div>
        <div className="text-muted-foreground">/</div>
        <div className={step === 3 ? "font-semibold" : "text-muted-foreground"}>3. סקירה</div>
      </div>

      {customersError ? <p className="text-sm text-destructive">שגיאת לקוחות: {customersError}</p> : null}
      {productsError ? <p className="text-sm text-destructive">שגיאת מוצרים: {productsError}</p> : null}
      {customerSearchError ? <p className="text-sm text-destructive">שגיאת חיפוש לקוחות: {customerSearchError}</p> : null}
      {productSearchError ? <p className="text-sm text-destructive">שגיאת חיפוש מוצרים: {productSearchError}</p> : null}

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>בחירת לקוח</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">חיפוש לקוח לפי שם / טלפון / אימייל / עיר *</label>
              <Input
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                placeholder="לדוגמה: יוסי כהן, 0501234567 או תל אביב"
              />
              {customerSearchLoading ? (
                <p className="text-xs text-muted-foreground">מחפש לקוחות...</p>
              ) : null}
            </div>

            {selectedCustomer ? (
              <div className="space-y-3 rounded-md border bg-muted/30 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">לקוח נבחר: {selectedCustomer.name}</p>
                  {selectedCustomer.requiresPrepayment ? (
                    <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-medium text-destructive-foreground">
                      תשלום מראש
                    </span>
                  ) : null}
                </div>
                <InlineCustomerEditor
                  customerId={selectedCustomer.id}
                  name={selectedCustomer.name}
                  phone={selectedCustomer.phone}
                  email={selectedCustomer.email}
                  address={selectedCustomer.address}
                  disabled={actionLocked}
                  onUpdated={(updated: InlineCustomerUpdate) => {
                    setCustomerOptions((prev) =>
                      prev.map((c) =>
                        c.id === updated.id
                          ? {
                              ...c,
                              name: updated.name,
                              phone: updated.phone,
                              email: updated.email,
                              address: updated.address,
                              city: extractCityFromAddress(updated.address),
                            }
                          : c
                      )
                    );
                    setCustomerQuery((current) =>
                      current === selectedCustomer.name ? updated.name : current
                    );
                  }}
                />
              </div>
            ) : null}

            <div className="max-h-64 space-y-2 overflow-auto rounded-md border p-2">
              {filteredCustomers.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  disabled={actionLocked}
                  onClick={() => {
                    setCustomerId(customer.id);
                    setCustomerQuery(customer.name);
                  }}
                  className={`w-full rounded-xl border px-3 py-2 text-right text-sm transition-all duration-200 ${
                    customer.id === customerId
                      ? "border-primary/20 bg-primary text-primary-foreground shadow-md shadow-primary/25"
                      : "border-border bg-accent/50 text-accent-foreground shadow-sm hover:-translate-y-0.5 hover:bg-accent hover:shadow-md"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{customer.name}</span>
                    {(customer.phone || customer.city) ? (
                      <span className={`text-xs ${customer.id === customerId ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        · {[customer.phone, customer.city].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                    {customer.requiresPrepayment ? (
                      <span className={`text-xs ${customer.id === customerId ? "text-primary-foreground/80" : "text-destructive"}`}>
                        · תשלום מראש
                      </span>
                    ) : null}
                  </div>
                  {customer.nameForInvoice && customer.nameForInvoice !== customer.name ? (
                    <div className={`mt-0.5 text-xs ${customer.id === customerId ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      שם לחשבונית: {customer.nameForInvoice}
                    </div>
                  ) : null}
                  {(customer.contacts ?? []).length > 0 ? (
                    <div className={`mt-0.5 text-xs ${customer.id === customerId ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      ← {customer.contacts![0].full_name}{customer.contacts![0].phone ? ` · ${customer.contacts![0].phone}` : ""}
                    </div>
                  ) : null}
                </button>
              ))}

              {filteredCustomers.length === 0 ? (
                <div className="space-y-2 p-2 text-sm">
                  <p className="text-muted-foreground">לא נמצאו לקוחות לחיפוש הזה.</p>
                  <Button type="button" variant="outline" onClick={() => setCreateCustomerOpen(true)} disabled={actionLocked}>
                    הוספת לקוח חדש
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-2">
              {embedded ? (
                <Button type="button" variant="secondary" onClick={onCancel} disabled={actionLocked}>
                  ביטול
                </Button>
              ) : (
                <Button type="button" variant="secondary" asChild disabled={actionLocked}>
                  <Link href={cancelHref}>ביטול</Link>
                </Button>
              )}
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={() => setCreateCustomerOpen(true)} disabled={actionLocked}>
                  לקוח חדש
                </Button>
                <Button type="button" onClick={() => setStep(2)} disabled={!customerId || actionLocked}>
                  המשך למוצרים
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>הוספת מוצרים</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">חיפוש מוצר</label>
              <Input
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                placeholder="חיפוש לפי שם או מק״ט"
              />
              {productSearchLoading ? (
                <p className="text-xs text-muted-foreground">מחפש מוצרים...</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">בחירת מוצרים</div>
              <div className="max-h-[26rem] overflow-auto rounded-xl border border-border/70 bg-muted/10 p-2.5">
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                  {filteredProducts.map((product) => {
                    const selected = selectedLineByProductId.get(product.id);
                    return (
                      <button
                        key={product.id}
                        type="button"
                        disabled={actionLocked}
                        onClick={() => addProduct(product.id)}
                        className={`group aspect-square rounded-xl border p-2.5 text-right transition ${
                          selected
                            ? "border-primary bg-primary/10 shadow-sm"
                            : "border-border/70 bg-background hover:border-primary/40 hover:bg-primary/5"
                        } ${actionLocked ? "cursor-not-allowed opacity-70" : ""}`}
                      >
                        <div className="flex h-full flex-col justify-between">
                          <div className="flex items-start justify-between gap-2">
                            <div className="line-clamp-3 text-sm font-semibold leading-5">
                              {product.name}
                            </div>
                            {selected ? (
                              <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                                {selected.line.quantity_ordered}
                              </span>
                            ) : null}
                          </div>

                          <div className="space-y-1 text-xs text-muted-foreground">
                            {product.code ? <div className="truncate">קוד: {product.code}</div> : null}
                            <div>מחיר: {formatCurrency(product.unitPrice)}</div>
                            {product.stock !== null ? <div>מלאי: {product.stock}</div> : null}
                            <div className="pt-1 font-medium text-primary">
                              {selected ? "לחץ להוסיף עוד" : "לחץ להוספה"}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              {filteredProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground">לא נמצאו מוצרים.</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">מוצרים שנבחרו ({lines.length})</p>
              {lines.length === 0 ? <p className="text-sm text-muted-foreground">עדיין לא נוספו מוצרים.</p> : null}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {lines.map((line, index) => {
                  const lineTotal = line.quantity_ordered * line.unit_price - line.discount_amount;
                  return (
                    <div key={`${line.product_id}-${index}`} className="rounded-2xl border border-border/70 bg-background p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{line.product_name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            מחיר יחידה: {formatCurrency(line.unit_price)}
                          </p>
                          <p className="text-xs text-muted-foreground">סה״כ: {formatCurrency(lineTotal)}</p>
                        </div>
                        <button
                          type="button"
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-border/70 text-sm font-semibold transition hover:bg-muted"
                          onClick={() => removeLine(index)}
                          disabled={actionLocked}
                          aria-label={`הסרת ${line.product_name}`}
                        >
                          ×
                        </button>
                      </div>

                      <div className="mt-4 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 text-lg font-semibold transition hover:bg-muted"
                            onClick={() => decrementLine(index)}
                            disabled={actionLocked || line.quantity_ordered <= 1}
                            aria-label={`הפחתת כמות של ${line.product_name}`}
                          >
                            -
                          </button>
                          <div className="min-w-12 rounded-xl border border-border/70 bg-muted/20 px-3 py-2 text-center text-sm font-semibold">
                            {line.quantity_ordered}
                          </div>
                          <button
                            type="button"
                            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 text-lg font-semibold transition hover:bg-muted"
                            onClick={() => incrementLine(index)}
                            disabled={actionLocked}
                            aria-label={`הגדלת כמות של ${line.product_name}`}
                          >
                            +
                          </button>
                        </div>

                        <div className="text-xs text-muted-foreground">לחץ על המוצר למעלה כדי להוסיף עוד</div>
                      </div>

                      <details className="mt-4 rounded-xl border border-dashed p-3" open={Boolean(line.discount_amount || line.notes)}>
                        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                          פרטי שורה נוספים
                        </summary>
                        <div className="mt-3 space-y-3">
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">כמות</label>
                            <Input
                              type="number"
                              min="1"
                              step="1"
                              value={line.quantity_ordered}
                              disabled={actionLocked}
                              onChange={(e) =>
                                updateLine(index, {
                                  quantity_ordered: toPositiveInt(Number(e.target.value || 1)),
                                })
                              }
                              placeholder="כמות"
                            />
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground">מחיר יחידה</label>
                              <Input
                                type="number"
                                min="0"
                                step="1"
                                value={line.unit_price}
                                disabled={actionLocked}
                                onChange={(e) =>
                                  updateLine(index, {
                                    unit_price: toNonNegativeInt(Number(e.target.value || 0)),
                                  })
                                }
                                placeholder="מחיר יחידה"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground">הנחת שורה</label>
                              <Input
                                type="number"
                                min="0"
                                step="1"
                                value={line.discount_amount}
                                disabled={actionLocked}
                                onChange={(e) =>
                                  updateLine(index, {
                                    discount_amount: toNonNegativeInt(Number(e.target.value || 0)),
                                  })
                                }
                                placeholder="הנחת שורה"
                              />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">הערה לשורה</label>
                            <Input
                              value={line.notes}
                              disabled={actionLocked}
                              onChange={(e) => updateLine(index, { notes: e.target.value })}
                              placeholder="הערה לשורה (אופציונלי)"
                            />
                          </div>
                        </div>
                      </details>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="secondary" onClick={() => setStep(1)} disabled={actionLocked}>
                חזרה
              </Button>
              <Button type="button" onClick={() => setStep(3)} disabled={lines.length === 0 || actionLocked}>
                המשך לסקירה
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <CardHeader>
            <CardTitle>סקירת הזמנה</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
              <ValueField label="לקוח" value={selectedCustomer?.name || "-"} />
              <ValueField label="עיר לקוח" value={selectedCustomer?.city || "-"} />
              <ValueField label="אופן תשלום" value={selectedCustomer?.requiresPrepayment ? "תשלום מראש" : "רגיל"} />
              <div className="space-y-0.5">
                <label className="text-sm font-medium">תאריך הזמנה *</label>
                <DateInput
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                  placeholder="בחר תאריך הזמנה"
                />
              </div>
              <div className="space-y-0.5">
                <label className="text-sm font-medium">סטטוס הזמנה</label>
                <select
                  value={orderStatus}
                  onChange={(e) => setOrderStatus(e.target.value)}
                  disabled={actionLocked}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {ORDER_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <ValueField label="סטטוס תשלום" value={paymentStatusLabel(paymentStatus)} />
              <ValueField label="פריטים" value={String(totalUnits)} />
              <ValueField label="סכום ביניים" value={formatCurrency(subtotal)} />
              {effectiveOrderDiscount > 0 ? (
                <ValueField
                  label="הנחת הזמנה"
                  value={`-${formatCurrency(effectiveOrderDiscount)}`}
                  valueClassName="text-success-soft-foreground"
                />
              ) : null}
              <ValueField label="סכום סופי" value={formatCurrency(totalAmount)} valueClassName="text-base font-semibold" />
            </div>

            <details className="rounded-md border border-dashed p-3" open={Boolean(effectiveOrderDiscount || notes)}>
              <summary className="cursor-pointer text-sm font-medium">פרטים נוספים להזמנה</summary>
              <div className="mt-3 space-y-2.5">
                <div className="space-y-0.5">
                  <label className="text-sm font-medium">סטטוס תשלום</label>
                  <Input value={paymentStatusLabel(paymentStatus)} readOnly />
                  <p className="text-xs text-muted-foreground">
                    הסטטוס מחושב אוטומטית לפי סכום ההזמנה מול התשלומים בפועל.
                  </p>
                </div>

                <div className="space-y-0.5">
                  <label className="text-sm font-medium">הנחת הזמנה</label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={orderDiscount}
                    disabled={actionLocked}
                    onChange={(e) => setOrderDiscount(String(toNonNegativeInt(Number(e.target.value || 0))))}
                    placeholder="הזן סכום הנחה"
                  />
                </div>

                <div className="space-y-0.5">
                  <label className="text-sm font-medium">הערות</label>
                  <Textarea
                    value={notes}
                    disabled={actionLocked}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="הערות להזמנה (אופציונלי)"
                  />
                </div>
              </div>
            </details>

            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">תשלומים להזמנה</p>
                  <p className="text-xs text-muted-foreground">
                    אפשר לפצל את ההזמנה לכמה תשלומים ובכמה אמצעים שונים.
                  </p>
                </div>
                <Button type="button" variant="outline" onClick={addPaymentDraft} disabled={actionLocked}>
                  הוסף תשלום
                </Button>
              </div>

              {initialPayments.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">תשלומים קיימים</p>
                  {initialPayments.map((payment) => (
                    <div key={payment.id} className="grid gap-2 rounded-md border bg-muted/20 p-3 text-sm sm:grid-cols-4">
                      <div>
                        <div className="text-xs text-muted-foreground">תאריך</div>
                        <div>{payment.payment_date || "-"}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">אמצעי</div>
                        <div>{paymentMethodLabel(payment.payment_method)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">סכום</div>
                        <div>{formatCurrency(payment.amount_total)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">אסמכתא</div>
                        <div>{payment.reference_number || "-"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {newPayments.length === 0 ? (
                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  עדיין לא הוזנו תשלומים חדשים.
                </div>
              ) : null}

              {newPayments.map((payment, index) => (
                <div key={index} className="space-y-3 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">תשלום חדש #{index + 1}</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => removePaymentDraft(index)}
                      disabled={actionLocked}
                    >
                      הסר
                    </Button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">סכום *</label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={payment.amount_total}
                        disabled={actionLocked}
                        onChange={(e) => updatePaymentDraft(index, { amount_total: e.target.value })}
                        placeholder="0.00"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">תאריך *</label>
                      <DateInput
                        value={payment.payment_date}
                        disabled={actionLocked}
                        onChange={(e) => updatePaymentDraft(index, { payment_date: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">אמצעי תשלום *</label>
                    <select
                      value={payment.payment_method}
                      disabled={actionLocked}
                      onChange={(e) => updatePaymentDraft(index, { payment_method: e.target.value })}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">בחר אמצעי תשלום...</option>
                      {ORDER_PAYMENT_METHOD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <details className="rounded-md border border-dashed p-3" open={Boolean(payment.reference_number || payment.notes)}>
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                      פרטי תשלום נוספים
                    </summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">מספר אסמכתא</label>
                        <Input
                          value={payment.reference_number}
                          disabled={actionLocked}
                          onChange={(e) => updatePaymentDraft(index, { reference_number: e.target.value })}
                          placeholder="אופציונלי"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">הערות לתשלום</label>
                        <Input
                          value={payment.notes}
                          disabled={actionLocked}
                          onChange={(e) => updatePaymentDraft(index, { notes: e.target.value })}
                          placeholder="אופציונלי"
                        />
                      </div>
                    </div>
                  </details>
                </div>
              ))}

              <div className="grid gap-3 rounded-md bg-muted/30 p-3 text-sm sm:grid-cols-3">
                <ValueField label="שולם עד עכשיו" value={formatCurrency(existingPaidTotal)} />
                <ValueField label="תשלומים חדשים" value={formatCurrency(newPaidTotal)} />
                <ValueField label="יתרה אחרי שמירה" value={formatCurrency(remainingBalance)} />
              </div>

              {selectedCustomer?.requiresPrepayment ? (
                <div className="rounded-md border border-destructive bg-destructive p-3 text-sm text-destructive-foreground">
                  לקוח זה מסומן לתשלום מראש, ולכן אי אפשר לשמור את ההזמנה כל עוד נשארת יתרה פתוחה.
                </div>
              ) : null}
            </div>

            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span>סכום סופי</span>
                <span className="text-base font-semibold">{formatCurrency(totalAmount)}</span>
              </div>
            </div>

            {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}

            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="secondary" onClick={() => setStep(2)} disabled={actionLocked}>
                חזרה
              </Button>
              <Button type="button" onClick={() => void submitOrder()} disabled={submitting}>
                 {submitting ? "שולח..." : isEditMode ? "שמירת שינויים" : "יצירת הזמנה"}
               </Button>
             </div>
             {submitting ? (
               <p className="text-xs text-muted-foreground">
                 {isEditMode ? "ההזמנה מתעדכנת כעת, נא להמתין..." : "ההזמנה נוצרת כעת, נא להמתין..."}
               </p>
             ) : null}
          </CardContent>
        </Card>
      ) : null}

      <CreateCustomerDialog
        open={createCustomerOpen}
        onOpenChange={setCreateCustomerOpen}
        description="הלקוח לא נמצא? אפשר ליצור אותו ישירות כאן. שדות חובה: שם, טלפון ועיר."
        onCreated={(customer: CreatedCustomer) => {
          const newCustomer: CustomerOption = {
            id: customer.id,
            name: customer.name,
            nameForInvoice: customer.name_for_invoice ?? null,
            phone: customer.phone,
            email: customer.email,
            address: customer.address,
            city: extractCityFromAddress(customer.address),
            requiresPrepayment: customer.requires_prepayment,
          };
          setCustomerOptions((prev) => [newCustomer, ...prev]);
          setCustomerId(newCustomer.id);
          setCustomerQuery(newCustomer.name);
        }}
      />

    </div>
  );
}
