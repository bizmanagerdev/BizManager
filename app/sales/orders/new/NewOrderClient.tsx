"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  ORDER_PAYMENT_METHOD_OPTIONS,
  paymentMethodLabel,
  paymentStatusLabel,
  validateRequestedPaymentStatus,
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
  phone: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
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

function extractCityFromAddress(address: string | null) {
  if (!address) return null;
  const normalized = address.trim();
  if (!normalized) return null;
  const first = normalized.split("|")[0]?.trim() ?? "";
  return first || null;
}

function orderStatusLabel(status: string) {
  switch (status) {
    case "draft":
      return "פתוחה";
    case "confirmed":
      return "מאושרת";
    case "processing":
      return "בטיפול";
    case "out_for_delivery":
      return "במשלוח";
    case "delivered":
      return "סופקה";
    case "completed":
      return "הושלמה";
    case "cancelled":
      return "בוטלה";
    default:
      return status || "-";
  }
}

const CITY_OPTIONS = [
  "ירושלים",
  "בני ברק",
  "אלעד",
  "ביתר עילית",
  "בית שמש",
  "אשדוד",
  "דימונה",
  "מירון",
  "פתח תקווה",
  "תל אביב",
  "חיפה",
  "נתניה",
  "באר שבע",
  "ראשון לציון",
  "אחר",
];

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
  initialStatusOverride,
  allowOrderStatusEdit = false,
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
  const [paymentStatus, setPaymentStatus] = useState(initialOrder?.payment_status ?? "unpaid");
  const [orderDiscount, setOrderDiscount] = useState(String(initialOrder?.discount_amount ?? 0));
  const [notes, setNotes] = useState(initialOrder?.notes ?? "");

  const [productQuery, setProductQuery] = useState("");
  const [lines, setLines] = useState<OrderLine[]>(initialOrder?.items ?? []);
  const [newPayments, setNewPayments] = useState<PaymentDraft[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [createCustomerName, setCreateCustomerName] = useState("");
  const [createCustomerPhone, setCreateCustomerPhone] = useState("");
  const [createCustomerEmail, setCreateCustomerEmail] = useState("");
  const [createCustomerCity, setCreateCustomerCity] = useState("");
  const [createCustomerCityOther, setCreateCustomerCityOther] = useState("");
  const [createCustomerAddress, setCreateCustomerAddress] = useState("");
  const [createCustomerNotes, setCreateCustomerNotes] = useState("");
  const [createCustomerError, setCreateCustomerError] = useState<string | null>(null);
  const [createCustomerSubmitting, setCreateCustomerSubmitting] = useState(false);
  const actionLocked = submitting || createCustomerSubmitting;

  const initialCustomerOptions = useMemo(
    () =>
      customers
        .map((row) => ({
          id: getString(row, ["id"]) ?? "",
          name:
            getString(row, ["name", "name_for_invoice", "email", "phone"]) ??
            "לקוח",
          phone: getString(row, ["phone", "mobile", "tel"]),
          email: getString(row, ["email"]),
          address: getString(row, ["address"]),
          city: extractCityFromAddress(getString(row, ["address"])),
        }))
        .filter((row) => row.id),
    [customers]
  );

  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>(initialCustomerOptions);

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
    }

    prefillHandled.current = true;
  }, [initialCustomerOptions, initialOrder?.customer_id, isEditMode, searchParams]);

  const productOptions = useMemo(
    () =>
      products
        .map((row) => {
          const id = getString(row, ["id"]) ?? "";
          const name = getString(row, ["name", "product_name", "title", "sku"]) ?? "מוצר";
          const code = getString(row, ["sku", "code", "barcode"]);
          const unitPrice =
            getNumber(row, [
              "base_price",
              "sale_price",
              "selling_price",
              "price",
              "unit_price",
              "retail_price",
            ]) ??
            0;
          const stock = getNumber(row, ["stock", "quantity", "available_quantity", "in_stock"]);
          return { id, name, code, unitPrice, stock };
        })
        .filter((row) => row.id),
    [products]
  );

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return productOptions.slice(0, 80);
    return productOptions
      .filter((p) => p.name.toLowerCase().includes(q) || (p.code ?? "").toLowerCase().includes(q))
      .slice(0, 80);
  }, [productOptions, productQuery]);

  const filteredCustomers = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    const qPhone = normalizePhone(customerQuery);
    if (!q && !qPhone) return customerOptions.slice(0, 50);

    return customerOptions
      .filter((customer) => {
        const byName = customer.name.toLowerCase().includes(q);
        const byEmail = (customer.email ?? "").toLowerCase().includes(q);
        const byPhone = (customer.phone ? normalizePhone(customer.phone) : "").includes(qPhone);
        const byCity = (customer.city ?? "").toLowerCase().includes(q);
        return byName || byEmail || byCity || (qPhone ? byPhone : false);
      })
      .slice(0, 50);
  }, [customerOptions, customerQuery]);

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
  const totalAmount = subtotal - (Number.isFinite(orderDiscountNumber) ? orderDiscountNumber : 0);
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
        };
      })
    );
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
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

  async function createCustomer() {
    if (createCustomerSubmitting) return;
    setCreateCustomerError(null);

    const name = createCustomerName.trim();
    const email = createCustomerEmail.trim();
    const city =
      createCustomerCity === "אחר"
        ? createCustomerCityOther.trim()
        : createCustomerCity.trim();
    const address = createCustomerAddress.trim();
    if (!name) {
      setCreateCustomerError("יש להזין שם לקוח.");
      return;
    }
    if (!email) {
      setCreateCustomerError("יש להזין אימייל לקוח עבור קבלה.");
      return;
    }
    if (!city) {
      setCreateCustomerError("יש להזין עיר למשלוח.");
      return;
    }
    if (!address) {
      setCreateCustomerError("יש להזין כתובת למשלוח.");
      return;
    }

    setCreateCustomerSubmitting(true);
    try {
      const res = await fetch("/api/customers/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          phone: createCustomerPhone.trim() || null,
          email,
          city,
          address,
          notes: createCustomerNotes.trim() || null,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        customer?: Row;
      };

      if (!res.ok || !json.customer) {
        setCreateCustomerError(json.error ?? "יצירת לקוח נכשלה.");
        return;
      }

      const newCustomer: CustomerOption = {
        id: getString(json.customer, ["id"]) ?? "",
        name: getString(json.customer, ["name", "name_for_invoice"]) ?? name,
        phone: getString(json.customer, ["phone", "mobile", "tel"]),
        email: getString(json.customer, ["email"]),
        address: getString(json.customer, ["address"]),
        city: extractCityFromAddress(getString(json.customer, ["address"])),
      };

      if (newCustomer.id) {
        setCustomerOptions((prev) => [newCustomer, ...prev]);
        setCustomerId(newCustomer.id);
        setCustomerQuery(newCustomer.name);
      }

      setCreateCustomerOpen(false);
      setCreateCustomerName("");
      setCreateCustomerPhone("");
      setCreateCustomerEmail("");
      setCreateCustomerCity("");
      setCreateCustomerCityOther("");
      setCreateCustomerAddress("");
      setCreateCustomerNotes("");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "שגיאה לא ידועה";
      setCreateCustomerError(message);
    } finally {
      setCreateCustomerSubmitting(false);
    }
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

    const paymentStatusError = validateRequestedPaymentStatus({
      requestedStatus: paymentStatus,
      totalAmount,
      paidAmount: combinedPaidTotal,
    });
    if (paymentStatusError) {
      setSubmitError(paymentStatusError);
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
        router.push(`/sales/orders/${json.order_id}`);
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
            </div>

            {selectedCustomer ? (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <p className="font-medium">לקוח נבחר: {selectedCustomer.name}</p>
                <p className="text-muted-foreground">
                  {selectedCustomer.phone ? `טלפון: ${selectedCustomer.phone}` : "טלפון: -"}
                  {selectedCustomer.email ? ` | אימייל: ${selectedCustomer.email}` : ""}
                </p>
                <p className="text-muted-foreground">
                  {selectedCustomer.city ? `עיר: ${selectedCustomer.city}` : "עיר: -"}
                  {selectedCustomer.address ? ` | כתובת: ${selectedCustomer.address}` : ""}
                </p>
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
                  className={`w-full rounded-md border p-2 text-right text-sm transition-colors ${
                    customer.id === customerId
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <div className="font-medium">{customer.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {customer.phone ? `טלפון: ${customer.phone}` : "טלפון: -"}
                    {customer.email ? ` | אימייל: ${customer.email}` : ""}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {customer.city ? `עיר: ${customer.city}` : "עיר: -"}
                    {customer.address ? ` | כתובת: ${customer.address}` : ""}
                  </div>
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
            </div>

            <div className="max-h-60 space-y-2 overflow-auto rounded-md border p-2">
              {filteredProducts.map((product) => (
                <div key={product.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {product.code ? `קוד: ${product.code} | ` : ""}
                      מחיר: {formatCurrency(product.unitPrice)}
                      {product.stock !== null ? ` | מלאי: ${product.stock}` : ""}
                    </p>
                  </div>
                  <Button type="button" size="sm" onClick={() => addProduct(product.id)} disabled={actionLocked}>
                    הוסף
                  </Button>
                </div>
              ))}
              {filteredProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground">לא נמצאו מוצרים.</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">מוצרים שנבחרו ({lines.length})</p>
              {lines.length === 0 ? <p className="text-sm text-muted-foreground">עדיין לא נוספו מוצרים.</p> : null}
              {lines.map((line, index) => {
                const lineTotal = line.quantity_ordered * line.unit_price - line.discount_amount;
                return (
                  <div key={`${line.product_id}-${index}`} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">{line.product_name}</p>
                      <Button type="button" size="sm" variant="outline" onClick={() => removeLine(index)} disabled={actionLocked}>
                        הסר
                      </Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-4">
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
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">מחיר יחידה</label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unit_price}
                          disabled={actionLocked}
                          onChange={(e) => updateLine(index, { unit_price: Number(e.target.value || 0) })}
                          placeholder="מחיר יחידה"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">הנחת שורה</label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.discount_amount}
                          disabled={actionLocked}
                          onChange={(e) => updateLine(index, { discount_amount: Number(e.target.value || 0) })}
                          placeholder="הנחת שורה"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">סה״כ שורה</label>
                        <div className="flex h-10 items-center rounded-md border px-3 text-sm">
                          {formatCurrency(lineTotal)}
                        </div>
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
                );
              })}
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
          <CardContent className="space-y-4">
            <div className="grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">לקוח</span>
                <span>{selectedCustomer?.name || "-"}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">עיר לקוח</span>
                <span>{selectedCustomer?.city || "-"}</span>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">תאריך הזמנה *</label>
                <Input
                  type="date"
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                  placeholder="בחר תאריך הזמנה"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">סטטוס הזמנה</label>
                {allowOrderStatusEdit ? (
                  <select
                    value={orderStatus}
                    onChange={(e) => setOrderStatus(e.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="draft">פתוחה</option>
                    <option value="closed">סגורה</option>
                    <option value="delivered">סופקה</option>
                  </select>
                ) : (
                  <Input value={orderStatusLabel(orderStatus)} readOnly />
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">סטטוס תשלום</span>
                <span>{paymentStatusLabel(paymentStatus)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">פריטים</span>
                <span>{totalUnits}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">סכום ביניים</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">סטטוס תשלום</label>
              <select
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="unpaid">לא שולם</option>
                <option value="partial">שולם חלקית</option>
                <option value="paid">שולם</option>
              </select>
              <p className="text-xs text-muted-foreground">
                אם מסמנים שולם או שולם חלקית, צריך להזין כאן גם את התשלומים בפועל עם אמצעי התשלום.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">הנחת הזמנה</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={orderDiscount}
                disabled={actionLocked}
                onChange={(e) => setOrderDiscount(e.target.value)}
                placeholder="הזן סכום הנחה"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">הערות</label>
              <Textarea
                value={notes}
                disabled={actionLocked}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="הערות להזמנה (אופציונלי)"
              />
            </div>

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
                      <Input
                        type="date"
                        value={payment.payment_date}
                        disabled={actionLocked}
                        onChange={(e) => updatePaymentDraft(index, { payment_date: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
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
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">מספר אסמכתא</label>
                      <Input
                        value={payment.reference_number}
                        disabled={actionLocked}
                        onChange={(e) => updatePaymentDraft(index, { reference_number: e.target.value })}
                        placeholder="אופציונלי"
                      />
                    </div>
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
              ))}

              <div className="grid gap-2 rounded-md bg-muted/30 p-3 text-sm sm:grid-cols-3">
                <div>
                  <div className="text-muted-foreground">שולם עד עכשיו</div>
                  <div className="font-medium">{formatCurrency(existingPaidTotal)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">תשלומים חדשים</div>
                  <div className="font-medium">{formatCurrency(newPaidTotal)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">יתרה אחרי שמירה</div>
                  <div className="font-medium">{formatCurrency(remainingBalance)}</div>
                </div>
              </div>
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

      <Dialog open={createCustomerOpen} onOpenChange={setCreateCustomerOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>הוספת לקוח חדש</DialogTitle>
            <DialogDescription>
              הלקוח לא נמצא? אפשר ליצור אותו ישירות כאן. שדות חובה: שם, אימייל, עיר וכתובת.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void createCustomer();
            }}
          >
            <div className="space-y-1">
              <label className="text-sm font-medium">שם לקוח *</label>
              <Input
                value={createCustomerName}
                onChange={(e) => setCreateCustomerName(e.target.value)}
                placeholder="שם מלא או שם חברה"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">טלפון</label>
              <Input
                value={createCustomerPhone}
                onChange={(e) => setCreateCustomerPhone(e.target.value)}
                placeholder="0501234567"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">אימייל *</label>
              <Input
                value={createCustomerEmail}
                onChange={(e) => setCreateCustomerEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">עיר *</label>
              <select
                value={createCustomerCity}
                onChange={(e) => setCreateCustomerCity(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">בחר עיר...</option>
                {CITY_OPTIONS.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
            </div>

            {createCustomerCity === "אחר" ? (
              <div className="space-y-1">
                <label className="text-sm font-medium">עיר (הקלדה חופשית) *</label>
                <Input
                  value={createCustomerCityOther}
                  onChange={(e) => setCreateCustomerCityOther(e.target.value)}
                  placeholder="הזן עיר"
                />
              </div>
            ) : null}

            <div className="space-y-1">
              <label className="text-sm font-medium">כתובת *</label>
              <Input
                value={createCustomerAddress}
                onChange={(e) => setCreateCustomerAddress(e.target.value)}
                placeholder="רחוב, מספר בית, דירה"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">הערות</label>
              <Textarea
                value={createCustomerNotes}
                onChange={(e) => setCreateCustomerNotes(e.target.value)}
                rows={3}
                placeholder="הערות על הלקוח (אופציונלי)"
              />
            </div>

            {createCustomerError ? (
              <p className="text-sm text-destructive">{createCustomerError}</p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setCreateCustomerOpen(false)}>
                ביטול
              </Button>
              <Button type="submit" disabled={createCustomerSubmitting}>
                {createCustomerSubmitting ? "שומר..." : "שמירת לקוח"}
              </Button>
            </DialogFooter>
            {createCustomerSubmitting ? (
              <p className="text-xs text-muted-foreground">יוצר לקוח חדש, נא להמתין...</p>
            ) : null}
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
