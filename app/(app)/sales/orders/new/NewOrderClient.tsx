"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  CreditCard,
  FileText,
  Minus,
  Pencil,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  User,
  UserPlus,
  X,
} from "lucide-react";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { cn } from "@/lib/utils";
import { toHebrewError } from "@/lib/error-messages";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DateInput } from "@/components/ui/date-input";
import AccountSelect from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Textarea } from "@/components/ui/textarea";
import { CustomerForm } from "@/components/customers/CustomerForm";
import type { CustomerRecord } from "@/components/customers/CustomerForm";
import { useCustomerSearchIndex } from "@/hooks/useCustomerSearchIndex";
import {
  ORDER_PAYMENT_METHOD_OPTIONS,
  derivePaymentStatus,
  paymentMethodLabel,
  paymentStatusLabel,
} from "@/lib/orders/paymentStatus";
import { CheckDetailsFields } from "@/components/payments/CheckDetailsFields";
import { uploadCheckPhotos } from "@/lib/payments/uploadCheckPhotos";
import { PAYMENT_TERMS_OPTIONS, computeDueDate } from "@/lib/paymentTerms";
import {
  type CustomerOption,
  type Step,
  ORDER_STATUS_OPTIONS,
  STEP_HEADINGS,
  SummaryRow,
  WizardStepper,
  extractCityFromAddress,
  formatCurrency,
  getNumber,
  getString,
  getTodayDate,
  mapCustomerSearchResult,
  termsLabel,
  toNonNegativeInt,
  toPositiveInt,
} from "./NewOrderClient.ui";
import { AddressLink } from "@/components/ui/address-link";
import { WazeIcon } from "@/components/ui/waze-icon";

type Row = Record<string, unknown>;

type OrderLine = {
  product_id: string;
  product_name: string;
  quantity_ordered: number;
  unit_price: number;
  discount_amount: number;
  notes: string;
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
  payment_terms?: string | null;
  due_date?: string | null;
  discount_amount: number;
  needs_invoice?: boolean | null;
  collect_payment_on_delivery?: boolean | null;
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
  account_id: string;
  due_date: string;
  reference_number: string;
  check_number: string;
  check_photo_files: File[];
  notes: string;
};


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

  const [step, setStep] = useState<Step>(1);
  const topRef = useRef<HTMLDivElement>(null);
  const customerDetailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const scrollable = el.closest<HTMLElement>('[role="dialog"]') ?? null;
    if (scrollable) {
      scrollable.scrollTo({ top: 0 });
    } else {
      window.scrollTo({ top: 0 });
    }
  }, [step]);
  const [customerId, setCustomerId] = useState(initialOrder?.customer_id ?? "");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerTab, setCustomerTab] = useState<"existing" | "new">("existing");
  const [editingCustomer, setEditingCustomer] = useState(false);
  // Mobile master→detail: after a customer is picked the results list collapses
  // so the detail/edit card isn't buried under a long list (lg shows both).
  const [mobileListCollapsed, setMobileListCollapsed] = useState(false);
  // The chosen customer is held independently of the search results, so searching to
  // switch shows pure results (the previously-selected one is not pinned into the list).
  const [pickedCustomer, setPickedCustomer] = useState<CustomerOption | null>(null);
  const [orderDate, setOrderDate] = useState(
    initialOrder?.order_date ?? new Date().toISOString().slice(0, 10)
  );
  const [orderStatus, setOrderStatus] = useState(
    initialStatusOverride ?? initialOrder?.status ?? "draft"
  );
  // New orders default to "שוטף" (eom); edits keep the stored term (null → immediate).
  const initialPaymentTerms = initialOrder?.payment_terms ?? (initialOrder ? "immediate" : "eom");
  const [paymentTerms, setPaymentTerms] = useState(initialPaymentTerms);
  const [dueDate, setDueDate] = useState(
    initialOrder?.due_date ??
      computeDueDate(initialOrder?.order_date ?? new Date().toISOString().slice(0, 10), initialPaymentTerms) ??
      ""
  );
  const [orderDiscount, setOrderDiscount] = useState(String(initialOrder?.discount_amount ?? 0));
  const [orderDiscountMode, setOrderDiscountMode] = useState<"amount" | "percent">("amount");
  // Single toggle: on = needs invoice, off (default) = doesn't.
  const [needsInvoice, setNeedsInvoice] = useState<boolean>(initialOrder?.needs_invoice ?? false);
  const [collectOnDelivery, setCollectOnDelivery] = useState<boolean>(
    initialOrder?.collect_payment_on_delivery ?? false
  );
  const [notes, setNotes] = useState(initialOrder?.notes ?? "");
  // Per-line discount input mode (₪ vs %); the stored value is always an absolute amount.
  const [lineDiscountModes, setLineDiscountModes] = useState<Record<string, "amount" | "percent">>({});

  // When the term or order date changes, refresh the suggested due date (still editable).
  function applyOrderDate(value: string) {
    setOrderDate(value);
    const computed = computeDueDate(value, paymentTerms);
    if (computed) setDueDate(computed);
  }
  function applyPaymentTerms(value: string) {
    setPaymentTerms(value);
    const computed = computeDueDate(orderDate, value);
    if (computed) setDueDate(computed);
  }

  const [productQuery, setProductQuery] = useState("");
  const [lines, setLines] = useState<OrderLine[]>(initialOrder?.items ?? []);
  const [newPayments, setNewPayments] = useState<PaymentDraft[]>([]);
  const [paymentAccountsList, setPaymentAccountsList] = useState<Account[]>([]);
  // Editable notes for already-saved payments (edit mode). Keyed by payment id,
  // seeded from the loaded values; changed entries are sent back on save.
  const [existingPaymentNotes, setExistingPaymentNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialPayments.map((payment) => [payment.id, payment.notes ?? ""]))
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
          whatsapp: getString(row, ["whatsapp"]),
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
  const { search: searchCustomerIndex, loading: customerIndexLoading } = useCustomerSearchIndex();

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
        setPickedCustomer(matchedInitial);
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
      setPickedCustomer(matched);
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
    setCustomerSearchError(null);
    // The index is still loading on first open — show the server-seeded list.
    if (customerIndexLoading) {
      setCustomerSearchLoading(true);
      if (!customerQuery.trim()) setCustomerOptions(initialCustomerOptions);
      return;
    }
    setCustomerSearchLoading(false);
    // Instant, in-memory filtering — no network round-trip per keystroke.
    const results = searchCustomerIndex(customerQuery, 50)
      .map((entry) => mapCustomerSearchResult(entry as Record<string, unknown>))
      .filter((row): row is CustomerOption => Boolean(row));
    setCustomerOptions(results.length === 0 && !customerQuery.trim() ? initialCustomerOptions : results);
  }, [customerQuery, searchCustomerIndex, customerIndexLoading, initialCustomerOptions]);

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
          if (!res.ok) throw new Error(toHebrewError(json.error, "שגיאת חיפוש מוצרים"));

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
          setProductSearchError(toHebrewError(error, "שגיאת חיפוש מוצרים"));
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
  // Total units across all lines (2 bags + 1 broom = 3), used for the cart count.
  const totalUnits = useMemo(() => lines.reduce((sum, line) => sum + line.quantity_ordered, 0), [lines]);
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

  const selectedCustomer =
    pickedCustomer && pickedCustomer.id === customerId
      ? pickedCustomer
      : customerOptions.find((c) => c.id === customerId) ?? null;

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

  // Apply a percentage discount to a line, storing the resulting absolute amount.
  function setLineDiscountPercent(index: number, line: OrderLine, percent: number) {
    const gross = line.quantity_ordered * line.unit_price;
    const pct = Number.isFinite(percent) ? Math.min(Math.max(percent, 0), 100) : 0;
    const amount = toNonNegativeInt(Math.min(gross, Math.round((gross * pct) / 100)));
    updateLine(index, { discount_amount: amount });
  }

  // Apply a percentage discount to the whole order, storing the resulting absolute amount.
  function setOrderDiscountPercent(percent: number) {
    const pct = Number.isFinite(percent) ? Math.min(Math.max(percent, 0), 100) : 0;
    const amount = toNonNegativeInt(Math.min(subtotal, Math.round((subtotal * pct) / 100)));
    setOrderDiscount(String(amount));
  }

  function addPaymentDraft() {
    setNewPayments((prev) => {
      const alreadyDrafted = prev.reduce((sum, draft) => {
        const value = Number(draft.amount_total || 0);
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0);
      const openBalance = Math.max(totalAmount - existingPaidTotal - alreadyDrafted, 0);
      const prefillAmount = openBalance > 0 ? openBalance.toFixed(2) : "";
      return [
        ...prev,
        {
          payment_date: getTodayDate(),
          amount_total: prefillAmount,
          payment_method: "",
          account_id: "",
          due_date: "",
          reference_number: "",
          check_number: "",
          check_photo_files: [],
          notes: "",
        },
      ];
    });
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

    // Always submit the payments the user entered; the term only drives the due date,
    // not whether payment rows are recorded. (Dropping them for "מיידי" silently lost
    // the payment and tripped the prepayment guard server-side.)
    const paymentsToSubmit = newPayments;

    const invalidPayment = paymentsToSubmit.find((payment) => {
      const amount = Number(payment.amount_total || 0);
      return (
        !Number.isFinite(amount) ||
        amount <= 0 ||
        !payment.payment_date ||
        !payment.payment_method
      );
    });

    const checkWithoutDueDate = paymentsToSubmit.find(
      (payment) => payment.payment_method === "check" && !payment.due_date.trim()
    );
    if (checkWithoutDueDate) {
      setSubmitError("יש להזין תאריך פירעון לכל צ'ק.");
      return;
    }

    if (invalidPayment) {
      setSubmitError("יש להשלים לכל תשלום חדש סכום, תאריך ואמצעי תשלום.");
      return;
    }

    const paymentWithoutAccount = paymentsToSubmit.find((payment) => !payment.account_id);
    if (paymentAccountsList.length > 0 && paymentWithoutAccount) {
      setSubmitError("יש לבחור חשבון לכל תשלום חדש.");
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
          payment_terms: paymentTerms,
          collect_payment_on_delivery: collectOnDelivery,
          due_date: dueDate || null,
          discount_amount: Number.isFinite(orderDiscountNumber) ? orderDiscountNumber : 0,
          needs_invoice: needsInvoice,
          notes: notes.trim() || null,
          payments: paymentsToSubmit.map((payment) => ({
            amount_total: Number(payment.amount_total || 0),
            payment_date: payment.payment_date,
            payment_method: payment.payment_method,
            account_id: payment.account_id || null,
            due_date: payment.due_date.trim() || null,
            reference_number: payment.reference_number.trim() || null,
            check_number:
              payment.payment_method === "check" && payment.check_number.trim()
                ? payment.check_number.trim()
                : null,
            notes: payment.notes.trim() || null,
          })),
          items: lines.map((line) => ({
            product_id: line.product_id,
            quantity_ordered: line.quantity_ordered,
            unit_price: line.unit_price,
            discount_amount: line.discount_amount,
            notes: line.notes.trim() || null,
          })),
          // Note-only edits to already-saved payments (only the ones that changed).
          existing_payment_notes: initialPayments
            .filter((payment) => (existingPaymentNotes[payment.id] ?? "") !== (payment.notes ?? ""))
            .map((payment) => ({ id: payment.id, notes: existingPaymentNotes[payment.id]?.trim() || null })),
        }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        order_id?: string;
        payment_ids?: string[];
      };

      if (!res.ok || !json.order_id) {
        setSubmitError(toHebrewError(json.error, (isEditMode ? "עדכון ההזמנה נכשל." : "יצירת ההזמנה נכשלה.")));
        return;
      }

      const insertedPaymentIds = Array.isArray(json.payment_ids) ? json.payment_ids : [];
      for (let i = 0; i < paymentsToSubmit.length; i++) {
        const payment = paymentsToSubmit[i];
        const paymentId = insertedPaymentIds[i];
        if (
          !paymentId ||
          payment.payment_method !== "check" ||
          payment.check_photo_files.length === 0
        ) {
          continue;
        }
        await uploadCheckPhotos(paymentId, payment.check_photo_files);
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
      const message = toHebrewError(error, "שגיאה לא ידועה");
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Step navigation / gating -------------------------------------------------

  // While the inline create/edit customer form is open the user must save or cancel
  // before they can advance — otherwise the in-progress customer edit would be abandoned.
  const customerFormOpen = step === 1 && (editingCustomer || customerTab === "new");

  // A step is "unlocked" only when every prerequisite up to it is satisfied.
  function stepUnlocked(n: Step) {
    if (n >= 2 && !customerId) return false;
    if (n >= 3 && lines.length === 0) return false;
    return true;
  }
  const canClickStep = (n: Step) => {
    if (customerFormOpen && n > step) return false;
    return n <= step || stepUnlocked(n);
  };

  function goToStep(n: Step) {
    if (!stepUnlocked(n)) return;
    setStep(n);
    setEditingCustomer(false);
  }
  function goNext() {
    if (step === 4) {
      void submitOrder();
      return;
    }
    goToStep((step + 1) as Step);
  }
  function goBack() {
    if (step === 1) return;
    setStep((step - 1) as Step);
    setEditingCustomer(false);
  }

  const heading = STEP_HEADINGS[step];
  const nextDisabled =
    actionLocked || customerFormOpen || (step < 4 ? !stepUnlocked((step + 1) as Step) : submitting);
  const nextLabel =
    step === 1
      ? "המשך למוצרים"
      : step === 2
        ? "המשך לתשלום"
        : step === 3
          ? "המשך לסקירה"
          : submitting
            ? isEditMode
              ? "שומר..."
              : "יוצר..."
            : isEditMode
              ? "שמירת שינויים"
              : "יצירת הזמנה";

  // Add or update a customer in the local list and select it (used by the inline create/edit form).
  function handleCustomerSaved(customer: CustomerRecord) {
    const option: CustomerOption = {
      id: customer.id,
      name: customer.name,
      nameForInvoice: customer.name_for_invoice ?? null,
      phone: customer.phone,
      whatsapp: customer.whatsapp,
      email: customer.email,
      address: customer.address,
      city: extractCityFromAddress(customer.address),
      requiresPrepayment: customer.requires_prepayment,
    };
    setCustomerOptions((prev) => {
      if (prev.some((c) => c.id === option.id)) {
        return prev.map((c) => (c.id === option.id ? { ...option, contacts: c.contacts } : c));
      }
      return [option, ...prev];
    });
    setPickedCustomer((prev) => (prev && prev.id === option.id ? { ...option, contacts: prev.contacts } : option));
    setCustomerId(option.id);
    setCustomerQuery(option.name);
    setEditingCustomer(false);
  }

  return (
    <div ref={topRef} className={cn("flex flex-col gap-5", !embedded && "pb-28 md:pb-0")}>
      <div
        className={cn(
          // Mobile: a flush, full-width bar that scrolls WITH the page (not pinned),
          // so content never tucks under it. md+: a pinned rounded card.
          "z-20 border-border/70 bg-background px-3 py-2.5 sm:px-4",
          embedded
            ? "sticky top-0 mb-1 rounded-2xl border shadow-lg"
            : "-mx-4 -mt-4 mb-1 border-b shadow-[0_2px_12px_rgb(0_0_0_/_0.06)] md:sticky md:top-16 md:mx-0 md:rounded-2xl md:border md:shadow-lg md:-mt-6 lg:-mt-8"
        )}
      >
        <WizardStepper current={step} canClick={canClickStep} onStepClick={goToStep} />
      </div>

      <div>
        <h2 className="text-lg font-semibold text-foreground sm:text-xl">{heading.title}</h2>
        {/* Subtitle is guidance only — hidden on mobile to free vertical room. */}
        <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">{heading.subtitle}</p>
      </div>

      {customersError ? <p className="text-sm text-destructive">שגיאת לקוחות: {customersError}</p> : null}
      {productsError ? <p className="text-sm text-destructive">שגיאת מוצרים: {productsError}</p> : null}
      {customerSearchError ? <p className="text-sm text-destructive">שגיאת חיפוש לקוחות: {customerSearchError}</p> : null}
      {productSearchError ? <p className="text-sm text-destructive">שגיאת חיפוש מוצרים: {productSearchError}</p> : null}

      {/* ---------------------------------------------------------------- STEP 1 */}
      {step === 1 ? (
        <div className="space-y-4">
          <div className="inline-flex rounded-2xl border border-border/60 bg-background/70 p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setCustomerTab("existing")}
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
                customerTab === "existing"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              לקוח קיים
            </button>
            <button
              type="button"
              onClick={() => setCustomerTab("new")}
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
                customerTab === "new"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              לקוח חדש
            </button>
          </div>

          {customerTab === "new" ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserPlus className="h-5 w-5 text-primary" /> לקוח חדש
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">בסיום הלקוח ייבחר אוטומטית להזמנה.</p>
              </CardHeader>
              <CardContent>
                <div className="mx-auto max-w-lg">
                  <CustomerForm
                    mode="create"
                    onCancel={() => setCustomerTab("existing")}
                    onSaved={({ customer }) => {
                      handleCustomerSaved(customer);
                      setCustomerTab("existing");
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">
              {/* Search + list */}
              <Card className="min-w-0">
                <CardContent className="space-y-3 pt-5">
                  <div className="relative">
                    {customerQuery ? (
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerQuery("");
                          setMobileListCollapsed(false);
                        }}
                        aria-label="ניקוי חיפוש"
                        className="absolute end-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : (
                      <Search className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    )}
                    <Input
                      value={customerQuery}
                      onChange={(e) => {
                        setCustomerQuery(e.target.value);
                        setMobileListCollapsed(false);
                      }}
                      onFocus={() => setMobileListCollapsed(false)}
                      placeholder="חיפוש..."
                      aria-label="חיפוש לקוח"
                      className="pe-9"
                    />
                  </div>
                  {customerSearchLoading ? (
                    <p className={cn("text-xs text-muted-foreground", mobileListCollapsed && "hidden lg:block")}>מחפש לקוחות...</p>
                  ) : null}

                  <div className={cn("space-y-2 pe-1 lg:max-h-[24rem] lg:overflow-auto", mobileListCollapsed && "hidden lg:block")}>
                    {filteredCustomers.map((customer) => {
                      const isSelected = customer.id === customerId;
                      return (
                        <button
                          key={customer.id}
                          type="button"
                          disabled={actionLocked}
                          onClick={() => {
                            setCustomerId(customer.id);
                            setPickedCustomer(customer);
                            setEditingCustomer(false);
                            // On mobile, collapse the list so the compact detail card
                            // takes its place. No programmatic scroll — that was the
                            // source of the jumpy/broken behavior; the page just gets
                            // short on its own. lg keeps both columns visible (no collapse).
                            if (typeof window !== "undefined" && window.innerWidth < 1024) {
                              setMobileListCollapsed(true);
                            }
                          }}
                          className={cn(
                            "flex w-full items-start gap-3 rounded-2xl border px-3 py-2.5 text-right transition-all duration-200",
                            isSelected
                              ? "border-primary bg-primary/5 shadow-sm"
                              : "border-border bg-background hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm"
                          )}
                        >
                          <span
                            className={cn(
                              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                              isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                            )}
                          >
                            {isSelected ? <Check className="h-3 w-3" /> : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-baseline gap-x-2">
                              <span className="font-medium text-foreground">{customer.name}</span>
                              {customer.requiresPrepayment ? (
                                <Badge variant="warning" className="px-1.5 py-0">תשלום מראש</Badge>
                              ) : null}
                            </span>
                            {customer.phone || customer.city ? (
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                {[customer.phone, customer.city].filter(Boolean).join(" · ")}
                              </span>
                            ) : null}
                            {customer.nameForInvoice && customer.nameForInvoice !== customer.name ? (
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                שם לחשבונית: {customer.nameForInvoice}
                              </span>
                            ) : null}
                            {(customer.contacts ?? []).length > 0 ? (
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                איש קשר: {customer.contacts![0].full_name}
                                {customer.contacts![0].phone ? ` · ${customer.contacts![0].phone}` : ""}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}

                    {filteredCustomers.length === 0 ? (
                      <div className="space-y-2 rounded-xl border border-dashed p-4 text-sm">
                        <p className="text-muted-foreground">לא נמצאו לקוחות לחיפוש הזה.</p>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setCustomerTab("new")}
                          disabled={actionLocked}
                        >
                          <UserPlus className="h-4 w-4" /> הוספת לקוח חדש
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>

              {/* Selected customer detail — scroll target when a customer is picked */}
              <div ref={customerDetailRef} className="min-w-0 scroll-mt-28">
              <Card className="min-w-0">
                <CardContent className="min-w-0 pt-5">
                  {selectedCustomer ? (
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-lg font-semibold text-foreground">
                            {selectedCustomer.name}
                          </h3>
                          {selectedCustomer.contacts?.[0]?.full_name ? (
                            <p className="mt-0.5 truncate text-sm text-muted-foreground">
                              {selectedCustomer.contacts[0].full_name}
                              {selectedCustomer.email ? ` · ${selectedCustomer.email}` : ""}
                            </p>
                          ) : selectedCustomer.email ? (
                            <p className="mt-0.5 truncate text-sm text-muted-foreground">{selectedCustomer.email}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <Badge variant="success">נבחר</Badge>
                          {selectedCustomer.requiresPrepayment ? (
                            <Badge variant="warning">תשלום מראש</Badge>
                          ) : null}
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => setEditingCustomer((v) => !v)}
                            disabled={actionLocked}
                          >
                            <Pencil className="h-3.5 w-3.5" /> {editingCustomer ? "סגירה" : "עריכה"}
                          </Button>
                        </div>
                      </div>

                      {editingCustomer ? (
                        <CustomerForm
                          key={selectedCustomer.id}
                          mode="edit"
                          initial={{ id: selectedCustomer.id }}
                          onCancel={() => setEditingCustomer(false)}
                          onSaved={({ customer }) => handleCustomerSaved(customer)}
                        />
                      ) : (
                        /* All fields shown (even empty); empty ones show a dash
                           rather than calling out "missing". */
                        <div className="space-y-1 rounded-lg border border-border/60 px-3 py-2 text-sm">
                          {[
                            { label: "טלפון", value: selectedCustomer.phone, ltr: true },
                            { label: "וואטסאפ", value: selectedCustomer.whatsapp, ltr: true },
                            { label: "אימייל", value: selectedCustomer.email, ltr: true },
                            { label: "כתובת", value: selectedCustomer.address || selectedCustomer.city, ltr: false, isAddress: true },
                            { label: "שם לחשבונית", value: selectedCustomer.nameForInvoice, ltr: false },
                            { label: "אופן תשלום", value: selectedCustomer.requiresPrepayment ? "תשלום מראש" : "רגיל", ltr: false },
                          ].map((row) => (
                            <p key={row.label} className="break-words leading-5">
                              <span className="text-muted-foreground">{row.label}: </span>
                              {row.value ? (
                                row.isAddress ? (
                                  <AddressLink
                                    address={row.value}
                                    className="inline-flex items-center gap-1 font-medium text-foreground"
                                  >
                                    <WazeIcon className="h-3.5 w-3.5 shrink-0" />
                                    {row.value}
                                  </AddressLink>
                                ) : (
                                  <span
                                    dir={row.ltr ? "ltr" : undefined}
                                    className="font-medium text-foreground"
                                  >
                                    {/* LRI…PDI forces LTR ordering for emails/phones in the RTL line */}
                                    {row.ltr ? `⁦${row.value}⁩` : row.value}
                                  </span>
                                )
                              ) : (
                                <span className="font-medium text-muted-foreground">—</span>
                              )}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-2 text-center">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <User className="h-6 w-6" />
                      </span>
                      <p className="text-sm font-medium text-foreground">בחרו לקוח מהרשימה</p>
                      <p className="text-sm text-muted-foreground">פרטי הלקוח יוצגו כאן וניתן יהיה לערוך אותם.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- STEP 2 */}
      {step === 2 ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
          {/* Product picker */}
          <Card>
            <CardContent className="space-y-3 pt-5">
              <div className="relative">
                <Search className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  placeholder="חיפוש..."
                  aria-label="חיפוש מוצר"
                  className="pe-9"
                />
              </div>
              {productSearchLoading ? <p className="text-xs text-muted-foreground">מחפש מוצרים...</p> : null}

              <div className="rounded-xl border border-border/70 bg-muted/10 p-2.5 lg:max-h-[28rem] lg:overflow-auto">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {filteredProducts.map((product) => {
                    const selected = selectedLineByProductId.get(product.id);
                    return (
                      <button
                        key={product.id}
                        type="button"
                        disabled={actionLocked}
                        onClick={() => addProduct(product.id)}
                        className={cn(
                          "group min-h-[8rem] rounded-xl border p-2.5 text-right transition-colors",
                          selected
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-border/70 bg-background active:bg-primary/5 md:hover:border-primary/40 md:hover:bg-primary/5",
                          actionLocked && "cursor-not-allowed opacity-70"
                        )}
                      >
                        <div className="flex h-full flex-col justify-between gap-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="line-clamp-3 break-words text-sm font-semibold leading-5">
                              {product.name}
                            </div>
                            {selected ? (
                              <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                                {selected.line.quantity_ordered}
                              </span>
                            ) : null}
                          </div>

                          <div className="space-y-0.5 text-xs text-muted-foreground">
                            {product.code ? <div className="truncate">מק״ט: {product.code}</div> : null}
                            {product.stock !== null ? <div className="truncate">מלאי: {product.stock}</div> : null}
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-foreground">
                              {formatCurrency(product.unitPrice)}
                            </span>
                            <span
                              className={cn(
                                "inline-flex items-center justify-center rounded-lg p-1.5",
                                selected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
                              )}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {filteredProducts.length === 0 ? (
                  <p className="p-4 text-center text-sm text-muted-foreground">לא נמצאו מוצרים.</p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {/* Order items cart — fills its grid cell so its height matches the product picker; the product column stays its natural size and the cart scrolls once it reaches that height */}
          <div className={cn(lines.length > 0 && "lg:relative")}>
            <div className={cn(lines.length > 0 && "lg:absolute lg:inset-0")}>
            <Card
              className={cn(
                lines.length > 0 && "lg:flex lg:h-full lg:flex-col"
              )}
            >
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 lg:shrink-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShoppingCart className="h-5 w-5 text-primary" /> פריטי הזמנה
              </CardTitle>
              <Badge variant="info">{totalUnits}</Badge>
            </CardHeader>
            <CardContent className={cn("space-y-3", lines.length > 0 && "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col")}>
              {lines.length === 0 ? (
                <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                  עדיין לא נוספו מוצרים. הקליקו על מוצר כדי להוסיף.
                </p>
              ) : (
                <div className="space-y-3 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
                  {/* Items scroll on their own so the discount + totals stay visible */}
                  <div className="-me-1 space-y-3 pe-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                  {lines.map((line, index) => {
                    const gross = line.quantity_ordered * line.unit_price;
                    const lineTotal = gross - line.discount_amount;
                    const mode = lineDiscountModes[line.product_id] ?? "amount";
                    const percentValue = gross > 0 ? Math.round((line.discount_amount / gross) * 100) : 0;
                    return (
                      <div key={`${line.product_id}-${index}`} className="space-y-2 border-b border-border/60 pb-3 last:border-0 last:pb-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="min-w-0 truncate text-sm font-medium text-foreground">{line.product_name}</p>
                          <span className="shrink-0 text-sm font-semibold text-foreground">{formatCurrency(lineTotal)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 transition hover:bg-muted disabled:opacity-50"
                              onClick={() => decrementLine(index)}
                              disabled={actionLocked || line.quantity_ordered <= 1}
                              aria-label={`הפחתת כמות של ${line.product_name}`}
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="min-w-8 text-center text-sm font-semibold">{line.quantity_ordered}</span>
                            <button
                              type="button"
                              className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 transition hover:bg-muted"
                              onClick={() => incrementLine(index)}
                              disabled={actionLocked}
                              aria-label={`הגדלת כמות של ${line.product_name}`}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <button
                            type="button"
                            className="text-muted-foreground transition hover:text-destructive"
                            onClick={() => removeLine(index)}
                            disabled={actionLocked}
                            aria-label={`הסרת ${line.product_name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>

                        <details open={Boolean(line.discount_amount || line.notes)}>
                          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">פרטים נוספים</summary>
                          <div className="mt-2 space-y-2">
                            <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5">
                              <label className="text-xs text-muted-foreground">מחיר יחידה</label>
                              <CurrencyInput
                                type="number"
                                min="0"
                                step="1"
                                value={line.unit_price}
                                disabled={actionLocked}
                                onChange={(e) =>
                                  updateLine(index, { unit_price: toNonNegativeInt(Number(e.target.value || 0)) })
                                }
                                className="h-8"
                                placeholder="מחיר"
                              />
                              <label className="text-xs text-muted-foreground">הנחה</label>
                              <div className="flex items-stretch gap-1.5">
                                <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-input">
                                  <button
                                    type="button"
                                    onClick={() => setLineDiscountModes((prev) => ({ ...prev, [line.product_id]: "percent" }))}
                                    className={cn(
                                      "px-2 text-xs font-medium transition-colors",
                                      mode === "percent" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"
                                    )}
                                  >
                                    %
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setLineDiscountModes((prev) => ({ ...prev, [line.product_id]: "amount" }))}
                                    className={cn(
                                      "px-2 text-xs font-medium transition-colors",
                                      mode === "amount" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"
                                    )}
                                  >
                                    ₪
                                  </button>
                                </div>
                                {mode === "percent" ? (
                                  <Input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="1"
                                    value={percentValue || ""}
                                    disabled={actionLocked}
                                    onChange={(e) => setLineDiscountPercent(index, line, Number(e.target.value || 0))}
                                    className="h-8"
                                    placeholder="0"
                                  />
                                ) : (
                                  <CurrencyInput
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={line.discount_amount}
                                    disabled={actionLocked}
                                    onChange={(e) =>
                                      updateLine(index, { discount_amount: toNonNegativeInt(Number(e.target.value || 0)) })
                                    }
                                    className="h-8"
                                    placeholder="0"
                                  />
                                )}
                              </div>
                              <label className="text-xs text-muted-foreground">הערה</label>
                              <Input
                                value={line.notes}
                                disabled={actionLocked}
                                onChange={(e) => updateLine(index, { notes: e.target.value })}
                                placeholder="אופציונלי"
                                className="h-8"
                              />
                            </div>
                          </div>
                        </details>
                      </div>
                    );
                  })}
                  </div>

                  {/* Whole-order discount */}
                  <div className="space-y-1.5 border-t border-border/70 pt-3 lg:shrink-0">
                    <label className="text-xs font-medium text-muted-foreground">הנחת הזמנה</label>
                    <div className="flex items-stretch gap-1.5">
                      <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-input">
                        <button
                          type="button"
                          onClick={() => setOrderDiscountMode("percent")}
                          className={cn(
                            "px-2.5 text-xs font-medium transition-colors",
                            orderDiscountMode === "percent" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"
                          )}
                        >
                          %
                        </button>
                        <button
                          type="button"
                          onClick={() => setOrderDiscountMode("amount")}
                          className={cn(
                            "px-2.5 text-xs font-medium transition-colors",
                            orderDiscountMode === "amount" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"
                          )}
                        >
                          ₪
                        </button>
                      </div>
                      {orderDiscountMode === "percent" ? (
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          value={subtotal > 0 ? Math.round((effectiveOrderDiscount / subtotal) * 100) || "" : ""}
                          disabled={actionLocked}
                          onChange={(e) => setOrderDiscountPercent(Number(e.target.value || 0))}
                          className="h-8"
                          placeholder="0"
                        />
                      ) : (
                        <CurrencyInput
                          type="number"
                          min="0"
                          step="1"
                          value={orderDiscount}
                          disabled={actionLocked}
                          onChange={(e) => setOrderDiscount(String(toNonNegativeInt(Number(e.target.value || 0))))}
                          className="h-8"
                          placeholder="0"
                        />
                      )}
                    </div>
                  </div>

                  {/* Totals */}
                  <div className="space-y-1 border-t border-border/70 pt-3 lg:shrink-0">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">סכום ביניים</span>
                      <span className="font-medium text-foreground">{formatCurrency(subtotal)}</span>
                    </div>
                    {effectiveOrderDiscount > 0 ? (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">הנחת הזמנה</span>
                        <span className="font-medium text-foreground">-{formatCurrency(effectiveOrderDiscount)}</span>
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-sm font-semibold text-foreground">סה״כ</span>
                      <span className="text-lg font-bold text-foreground">{formatCurrency(totalAmount)}</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
            </Card>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- STEP 3 */}
      {step === 3 ? (
        <div className="space-y-4">
          {/* Payment — invoice, terms, due date and the payments themselves */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="h-5 w-5 text-primary" /> תשלום
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">חשבונית, אופן התשלום והתשלומים בפועל.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Invoice toggle + payment terms — one compact row */}
              <div className="flex flex-wrap items-end gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={needsInvoice}
                  disabled={actionLocked}
                  onClick={() => setNeedsInvoice((v) => !v)}
                  className="inline-flex h-10 items-center gap-2.5 rounded-xl border border-input bg-background px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/40 disabled:opacity-50"
                >
                  <span
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
                      needsInvoice ? "bg-primary" : "bg-muted-foreground/30"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute left-0.5 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow transition-transform",
                        needsInvoice ? "translate-x-0" : "translate-x-4"
                      )}
                    />
                  </span>
                  <span>{needsInvoice ? "צריך חשבונית" : "לא צריך חשבונית"}</span>
                </button>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">גבייה</label>
                  <div className="flex h-10 overflow-hidden rounded-xl border border-input shadow-sm">
                    <button
                      type="button"
                      disabled={actionLocked}
                      onClick={() => setCollectOnDelivery(false)}
                      className={cn(
                        "px-3 text-sm font-medium transition-colors disabled:opacity-50",
                        !collectOnDelivery
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-foreground hover:bg-muted/40"
                      )}
                    >
                      תשלום למשרד
                    </button>
                    <button
                      type="button"
                      disabled={actionLocked}
                      onClick={() => setCollectOnDelivery(true)}
                      className={cn(
                        "border-r border-input px-3 text-sm font-medium transition-colors disabled:opacity-50",
                        collectOnDelivery
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-foreground hover:bg-muted/40"
                      )}
                    >
                      הנהג גובה תשלום
                    </button>
                  </div>
                </div>

                <div className="w-full space-y-1 sm:w-44">
                  <label className="text-xs font-medium text-muted-foreground">צורת תשלום</label>
                  <select
                    value={paymentTerms}
                    onChange={(e) => applyPaymentTerms(e.target.value)}
                    disabled={actionLocked}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {PAYMENT_TERMS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {paymentTerms !== "immediate" ? (
                  <div className="w-full space-y-1 sm:w-44">
                    <label className="text-xs font-medium text-muted-foreground">תאריך פירעון</label>
                    <DateInput value={dueDate} onChange={(e) => setDueDate(e.target.value)} placeholder="מחושב מצורת התשלום" />
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-4">
                <div>
                  <p className="text-sm font-medium text-foreground">תשלומים</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">אפשר לפצל לכמה תשלומים ובכמה אמצעים שונים.</p>
                </div>
                <Button type="button" variant="secondary" size="sm" onClick={addPaymentDraft} disabled={actionLocked}>
                  <Plus className="h-4 w-4" /> תשלום
                </Button>
              </div>

              {initialPayments.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">תשלומים קיימים</p>
                  {initialPayments.map((payment) => (
                    <div key={payment.id} className="space-y-2 rounded-xl border bg-muted/20 p-3 text-sm">
                      <div className="grid gap-2 sm:grid-cols-4">
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
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">הערות</label>
                        <Input
                          value={existingPaymentNotes[payment.id] ?? ""}
                          disabled={actionLocked}
                          onChange={(e) =>
                            setExistingPaymentNotes((prev) => ({ ...prev, [payment.id]: e.target.value }))
                          }
                          placeholder="אופציונלי"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {newPayments.length === 0 ? (
                <div className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
                  עדיין לא הוזנו תשלומים חדשים.
                </div>
              ) : null}

              {newPayments.map((payment, index) => (
                <div key={index} className="space-y-3 rounded-xl border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">תשלום חדש #{index + 1}</p>
                    <Button type="button" size="sm" variant="secondary" onClick={() => removePaymentDraft(index)} disabled={actionLocked}>
                      הסר
                    </Button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">סכום *</label>
                      <CurrencyInput
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

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">אמצעי תשלום *</label>
                      <select
                        value={payment.payment_method}
                        disabled={actionLocked}
                        onChange={(e) => {
                          const m = e.target.value;
                          updatePaymentDraft(index, {
                            payment_method: m,
                            account_id: payment.account_id || defaultAccountForMethod(paymentAccountsList, m),
                          });
                        }}
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
                    <AccountSelect
                      required
                      value={payment.account_id}
                      disabled={actionLocked}
                      onChange={(accountId) => updatePaymentDraft(index, { account_id: accountId })}
                      onLoaded={(list) => {
                        setPaymentAccountsList(list);
                        if (!payment.account_id) {
                          updatePaymentDraft(index, { account_id: defaultAccountForMethod(list, payment.payment_method) });
                        }
                      }}
                    />
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">
                        {payment.payment_method === "check" ? "תאריך פירעון *" : "תאריך פירעון צפוי (אופציונלי)"}
                      </label>
                      <DateInput
                        value={payment.due_date}
                        disabled={actionLocked}
                        onChange={(e) => updatePaymentDraft(index, { due_date: e.target.value })}
                      />
                      {payment.payment_method !== "check" ? (
                        <p className="text-[11px] text-muted-foreground">
                          לתשלומים עתידיים (למשל שוטף+30) — נרשמים כממתינים עד התאריך הזה.
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {payment.payment_method === "check" ? (
                    <CheckDetailsFields
                      checkNumber={payment.check_number}
                      onCheckNumberChange={(value) => updatePaymentDraft(index, { check_number: value })}
                      photoFiles={payment.check_photo_files}
                      onPhotoFilesChange={(files) => updatePaymentDraft(index, { check_photo_files: files })}
                      disabled={actionLocked}
                    />
                  ) : null}

                  <details className="rounded-xl border border-dashed p-3" open={Boolean(payment.reference_number || payment.notes)}>
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground">פרטי תשלום נוספים</summary>
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

{selectedCustomer?.requiresPrepayment ? (
                <div className="rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground">
                  לקוח זה מסומן לתשלום מראש, ולכן אי אפשר לשמור את ההזמנה כל עוד נשארת יתרה פתוחה.
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- STEP 4 */}
      {step === 4 ? (
        <div className="space-y-4">
          <div className="space-y-4 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">
            {/* Customer */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <User className="h-5 w-5 text-primary" /> לקוח
                </CardTitle>
                <Button type="button" size="sm" variant="secondary" onClick={() => goToStep(1)} disabled={actionLocked}>
                  <Pencil className="h-3.5 w-3.5" /> עריכה
                </Button>
              </CardHeader>
              <CardContent className="space-y-1">
                <SummaryRow label="שם" value={selectedCustomer?.name || "-"} />
                {selectedCustomer?.contacts?.[0]?.full_name ? (
                  <SummaryRow label="איש קשר" value={selectedCustomer.contacts[0].full_name} />
                ) : null}
                <SummaryRow label="טלפון" value={selectedCustomer?.phone || "-"} />
                {selectedCustomer?.email ? <SummaryRow label="אימייל" value={selectedCustomer.email} /> : null}
                <SummaryRow
                  label="כתובת"
                  value={
                    selectedCustomer?.address || selectedCustomer?.city ? (
                      <AddressLink
                        address={selectedCustomer?.address || selectedCustomer?.city}
                        className="inline-flex items-center gap-1"
                      >
                        <WazeIcon className="h-3.5 w-3.5 shrink-0" />
                        {selectedCustomer?.address || selectedCustomer?.city}
                      </AddressLink>
                    ) : (
                      "-"
                    )
                  }
                />
                {selectedCustomer?.requiresPrepayment ? (
                  <div className="pt-1">
                    <Badge variant="warning">תשלום מראש</Badge>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {/* Items */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShoppingCart className="h-5 w-5 text-primary" /> פריטים ({lines.length})
                </CardTitle>
                <Button type="button" size="sm" variant="secondary" onClick={() => goToStep(2)} disabled={actionLocked}>
                  <Pencil className="h-3.5 w-3.5" /> עריכה
                </Button>
              </CardHeader>
              <CardContent className="space-y-1">
                {lines.map((line, index) => {
                  const lineTotal = line.quantity_ordered * line.unit_price - line.discount_amount;
                  return (
                    <SummaryRow
                      key={`${line.product_id}-${index}`}
                      label={`${line.quantity_ordered}× ${line.product_name}`}
                      value={formatCurrency(lineTotal)}
                    />
                  );
                })}
                <div className="mt-2 space-y-1 border-t border-border/70 pt-2">
                  <SummaryRow label="סכום ביניים" value={formatCurrency(subtotal)} />
                  {effectiveOrderDiscount > 0 ? (
                    <SummaryRow label="הנחת הזמנה" value={`-${formatCurrency(effectiveOrderDiscount)}`} />
                  ) : null}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-sm font-semibold text-foreground">סה״כ</span>
                    <span className="text-lg font-bold text-foreground">{formatCurrency(totalAmount)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">
            {/* Order details — editable inline here, sensible defaults */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-5 w-5 text-primary" /> פרטי הזמנה
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">תאריך הזמנה *</label>
                    <DateInput value={orderDate} onChange={(e) => applyOrderDate(e.target.value)} placeholder="בחר תאריך הזמנה" />
                  </div>
                  <div className="space-y-1">
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
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">הערות להזמנה</label>
                  <Textarea
                    value={notes}
                    disabled={actionLocked}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="הערות להזמנה (אופציונלי)"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Payment summary — read-only; edit jumps back to the payment step */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CreditCard className="h-5 w-5 text-primary" /> תשלום
                </CardTitle>
                <Button type="button" size="sm" variant="secondary" onClick={() => goToStep(3)} disabled={actionLocked}>
                  <Pencil className="h-3.5 w-3.5" /> עריכה
                </Button>
              </CardHeader>
              <CardContent className="space-y-1">
                <SummaryRow label="חשבונית" value={needsInvoice ? "צריך חשבונית" : "לא צריך חשבונית"} />
                <SummaryRow label="גבייה" value={collectOnDelivery ? "הנהג גובה תשלום במסירה" : "תשלום למשרד"} />
                <SummaryRow label="צורת תשלום" value={termsLabel(paymentTerms)} />
                {paymentTerms !== "immediate" ? <SummaryRow label="תאריך פירעון" value={dueDate || "-"} /> : null}
                <SummaryRow label="סטטוס תשלום" value={paymentStatusLabel(paymentStatus)} />
                <SummaryRow label="שולם / יוזן" value={formatCurrency(combinedPaidTotal)} />
                <SummaryRow label="יתרה אחרי שמירה" value={formatCurrency(remainingBalance)} />
              </CardContent>
            </Card>
          </div>

          {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
          {submitting ? (
            <p className="text-xs text-muted-foreground">
              {isEditMode ? "ההזמנה מתעדכנת כעת, נא להמתין..." : "ההזמנה נוצרת כעת, נא להמתין..."}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Inline submit error for steps before review */}
      {submitError && step !== 4 ? <p className="text-sm text-destructive">{submitError}</p> : null}

      {/* ---------------------------------------------------------------- FOOTER */}
      <div className={cn(
        // Action bar. On mobile it's an edge-to-edge bar flush above the bottom
        // nav (no floating card overlapping content); a rounded card on md+.
        "border-border/70 bg-background/95 px-3 py-3 backdrop-blur sm:px-4",
        embedded
          ? "sticky bottom-0 z-10 mt-1 rounded-2xl border shadow-lg"
          : "fixed inset-x-0 bottom-[58px] z-40 border-t shadow-[0_-2px_12px_rgb(0_0_0_/_0.06)] md:sticky md:inset-x-auto md:bottom-0 md:z-10 md:mt-1 md:rounded-2xl md:border md:shadow-lg"
      )}>
        {/* Wraps when cramped: total drops to its own row above the buttons on
            narrow screens (me-auto on the back button keeps cancel⇄next spread),
            and sits inline between them when there's room (sm+). */}
        <div className="flex flex-wrap items-center gap-2">
          {step === 1 ? (
            embedded ? (
              <Button type="button" variant="secondary" onClick={onCancel} disabled={actionLocked} className="me-auto">
                ביטול
              </Button>
            ) : (
              <Button type="button" variant="secondary" asChild disabled={actionLocked} className="me-auto">
                <Link href={cancelHref}>ביטול</Link>
              </Button>
            )
          ) : (
            <Button type="button" variant="secondary" onClick={goBack} disabled={actionLocked} className="me-auto">
              חזרה
            </Button>
          )}

          {lines.length > 0 ? (
            <div className="order-first w-full text-center leading-tight sm:order-none sm:w-auto sm:text-end">
              <div className="whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {effectiveOrderDiscount > 0 ? "סכום לתשלום" : "סכום ביניים"}
              </div>
              <div className="whitespace-nowrap text-base font-bold text-foreground">
                {formatCurrency(totalAmount)}
              </div>
            </div>
          ) : null}

          <Button type="button" onClick={goNext} disabled={nextDisabled} className="shrink-0">
            {step === 4 ? <Check className="h-4 w-4" /> : null}
            {nextLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
