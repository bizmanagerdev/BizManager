"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AddIcon, AddUserIcon, AiIcon, CardIcon, CheckIcon, CloseIcon, DocumentIcon, EditIcon, OrderIcon, RemoveIcon, SearchIcon, UserIcon, WazeIcon } from "@/components/ui/icons";
import { DeleteButton } from "@/components/ui/icon-button";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { cn } from "@/lib/utils";
import { toHebrewError } from "@/lib/error-messages";
import { EmptyState } from "@/components/ui/empty-state";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { omitUnknownPlace } from "@/lib/ui/cities";
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
import { PREPAYMENT_WIZARD_WARNING } from "@/lib/orders/prepayment";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CheckDetailsFields } from "@/components/payments/CheckDetailsFields";
import { uploadCheckPhotos } from "@/lib/payments/uploadCheckPhotos";
import { PAYMENT_TERMS_OPTIONS, computeDueDate } from "@/lib/paymentTerms";
import { SummaryRow, SummarySection } from "@/components/ui/summary";
import { StepWizard } from "@/components/ui/step-wizard";
import {
  type CustomerOption,
  type Step,
  ORDER_STATUS_OPTIONS,
  WIZARD_STEPS,
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

type Row = Record<string, unknown>;

type OrderLine = {
  /** Empty for an off-catalog ("custom") line — that line's name is `description`. */
  product_id: string;
  product_name: string;
  /** Free-text name for a custom line (empty for catalog products). */
  description?: string;
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
  // Embedded (dialog) mode is a fixed-height column: the step bar and the action
  // bar are pinned and only this middle section scrolls, so a step change resets
  // *it* rather than the dialog/page.
  const bodyRef = useRef<HTMLDivElement>(null);
  const customerDetailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (embedded) {
      bodyRef.current?.scrollTo({ top: 0 });
      return;
    }
    const el = topRef.current;
    if (!el) return;
    const scrollable = el.closest<HTMLElement>('[role="dialog"]') ?? null;
    if (scrollable) {
      scrollable.scrollTo({ top: 0 });
    } else {
      window.scrollTo({ top: 0 });
    }
  }, [step, embedded]);
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
  // Off-catalog lines arrive from the server with an empty product_id; give each a
  // synthetic `custom:<uuid>` id so they don't collide on "" (discount mode, keys).
  const [lines, setLines] = useState<OrderLine[]>(() =>
    (initialOrder?.items ?? []).map((line) =>
      !line.product_id
        ? {
            ...line,
            product_id: `custom:${crypto.randomUUID()}`,
            description: line.description || line.product_name,
          }
        : line
    )
  );
  const [newPayments, setNewPayments] = useState<PaymentDraft[]>([]);
  const [paymentAccountsList, setPaymentAccountsList] = useState<Account[]>([]);
  // Editable notes for already-saved payments (edit mode). Keyed by payment id,
  // seeded from the loaded values; changed entries are sent back on save.
  const [existingPaymentNotes, setExistingPaymentNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialPayments.map((payment) => [payment.id, payment.notes ?? ""]))
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Pay-ahead reminder shown at save when the customer requires prepayment and a
  // balance remains — the user acknowledges it to create the order anyway.
  const [prepaymentConfirmOpen, setPrepaymentConfirmOpen] = useState(false);

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
              const stock = getNumber(row, ["available_quantity", "stock", "quantity", "in_stock"]);
              return { id, name, code, unitPrice, stock };
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

  // product_id → available stock (on-hand − reserved), for the shortfall warning.
  // null means "untracked" (no inventory row) — we never warn on those.
  const availableByProductId = useMemo(
    () => new Map(productOptions.map((p) => [p.id, p.stock])),
    [productOptions]
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
  // Floor at 0 — a discount larger than the goods must never show a negative total.
  const totalAmount = Math.max(0, subtotal - effectiveOrderDiscount);
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

  // Off-catalog ("custom") line: a one-off charge like "משלוח" with a free-text
  // name and price, no product_id (so it never touches stock). Uses a synthetic
  // `custom:<uuid>` id for stable React keys / per-line discount mode.
  function addCustomLine() {
    setLines((prev) => [
      ...prev,
      {
        product_id: `custom:${crypto.randomUUID()}`,
        product_name: "",
        description: "",
        quantity_ordered: 1,
        unit_price: 0,
        discount_amount: 0,
        notes: "",
      },
    ]);
  }

  function updateLine(index: number, patch: Partial<OrderLine>) {
    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const next = { ...line, ...patch };
        const quantity = toPositiveInt(next.quantity_ordered);
        const unitPrice = toNonNegativeInt(next.unit_price);
        // Clamp the ₪ discount to the line's gross so a too-large discount can't
        // drive the line (and the order subtotal) negative.
        const discount = Math.min(toNonNegativeInt(next.discount_amount), quantity * unitPrice);
        return {
          ...next,
          quantity_ordered: quantity,
          unit_price: unitPrice,
          discount_amount: discount,
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

  async function submitOrder(confirmedPrepayment = false) {
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
        // Off-catalog line must have a name.
        (line.product_id.startsWith("custom:") && !line.product_name.trim()) ||
        !Number.isFinite(line.quantity_ordered) ||
        line.quantity_ordered <= 0 ||
        !Number.isFinite(line.unit_price)
    );

    if (invalidLine) {
      setSubmitError(
        invalidLine.product_id.startsWith("custom:") && !invalidLine.product_name.trim()
          ? "יש להזין שם לכל שורה חופשית."
          : "אחת משורות ההזמנה אינה תקינה."
      );
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

    // Pay-ahead customers are NOT blocked at save — losing the sale is worse than
    // the risk. But before saving with an open balance we surface a reminder the
    // user must acknowledge ("create anyway"); the order is then flagged red in
    // the lists/deliveries queue until it's paid.
    if (!confirmedPrepayment && selectedCustomer?.requiresPrepayment && remainingBalance > 0.009) {
      setPrepaymentConfirmOpen(true);
      return;
    }

    setSubmitting(true);
    try {
      // Idempotency-Key: lets the server dedupe a network retry of a create so a
      // flaky connection can't produce two orders (the server caches the first
      // response and returns it for any replay of the same key).
      const idempotencyHeaders: Record<string, string> = { "content-type": "application/json" };
      if (!isEditMode) idempotencyHeaders["Idempotency-Key"] = crypto.randomUUID();
      const res = await fetch(isEditMode ? "/api/orders/update" : "/api/orders/create", {
        method: "POST",
        headers: idempotencyHeaders,
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
          items: lines.map((line) => {
            const isCustom = line.product_id.startsWith("custom:");
            return {
              // Custom lines send no product_id; their name rides in `description`.
              product_id: isCustom ? "" : line.product_id,
              description: isCustom ? line.product_name.trim() : "",
              quantity_ordered: line.quantity_ordered,
              unit_price: line.unit_price,
              discount_amount: line.discount_amount,
              notes: line.notes.trim() || null,
            };
          }),
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

  const nextDisabled =
    actionLocked || customerFormOpen || (step < 4 ? !stepUnlocked((step + 1) as Step) : submitting);
  // Only the final action is spelled out here — the wizard labels the
  // intermediate steps from the step list itself.
  const nextLabel =
    step === 4
      ? submitting
        ? isEditMode
          ? "שומר..."
          : "יוצר..."
        : isEditMode
          ? "שמירת שינויים"
          : "יצירת הזמנה"
      : undefined;

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
    <>
      <ConfirmDialog
        open={prepaymentConfirmOpen}
        onOpenChange={setPrepaymentConfirmOpen}
        destructive
        title="לקוח בתשלום מראש"
        description={`${selectedCustomer?.name ?? "הלקוח"} מסומן לתשלום מראש ונשארה יתרה לתשלום. ההזמנה תיווצר ותסומן באדום עד לגבייה — אין לספק לפני התשלום. ליצור בכל זאת?`}
        confirmLabel="צור בכל זאת"
        cancelLabel="חזרה לתשלום"
        loading={submitting}
        onConfirm={() => {
          setPrepaymentConfirmOpen(false);
          void submitOrder(true);
        }}
      />
      <StepWizard
        variant={embedded ? "dialog" : "page"}
        rootRef={topRef}
        bodyRef={bodyRef}
        steps={WIZARD_STEPS}
        current={step}
        canClickStep={canClickStep}
        onStepClick={goToStep}
        // Embedded, the X in the step bar is the single way out. Standalone there
        // is no X, so the action bar keeps an explicit cancel link instead.
        onClose={embedded ? onCancel : undefined}
        closeDisabled={actionLocked}
        onBack={step > 1 ? goBack : undefined}
        backDisabled={actionLocked}
        onNext={goNext}
        nextLabel={nextLabel}
        nextDisabled={nextDisabled}
        isLastStep={step === 4}
        footerStart={
          embedded ? undefined : (
            <Button type="button" variant="secondary" asChild disabled={actionLocked} className="me-auto">
              <Link href={cancelHref}>ביטול</Link>
            </Button>
          )
        }
        footerCenter={
          lines.length > 0 ? (
            <div className="order-first w-full text-center leading-tight sm:order-none sm:w-auto sm:text-end">
              <div className="whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {effectiveOrderDiscount > 0 ? "סכום לתשלום" : "סכום ביניים"}
              </div>
              <div className="whitespace-nowrap text-base font-bold text-foreground">
                {formatCurrency(totalAmount)}
              </div>
            </div>
          ) : null
        }
      >
      {/* No step heading here — the stepper above already names the step, and on
          a phone the heading was two lines of vertical room saying it twice. */}
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
            <div className="space-y-3">
              <div className="space-y-1">
                <h3 className="flex items-center gap-2 text-base font-semibold">
                  <AddUserIcon className="h-5 w-5 text-primary" /> לקוח חדש
                </h3>
                <p className="text-xs text-muted-foreground">בסיום הלקוח ייבחר אוטומטית להזמנה.</p>
              </div>
              <div>
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
              </div>
            </div>
          ) : (
            <div className="space-y-4 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">
              {/* Search + list — no Card: the results are already boxed rows. */}
              <div className="min-w-0 space-y-3">
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
                        <CloseIcon className="h-4 w-4" />
                      </button>
                    ) : (
                      <SearchIcon className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
                            {isSelected ? <CheckIcon className="h-3 w-3" /> : null}
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
                          <AddUserIcon className="h-4 w-4" /> הוספת לקוח חדש
                        </Button>
                      </div>
                    ) : null}
                  </div>
              </div>

              {/* Selected customer detail — scroll target when a customer is picked */}
              <div ref={customerDetailRef} className="min-w-0 scroll-mt-28">
              <div className="min-w-0">
                  {selectedCustomer ? (
                    <div className="space-y-4 rounded-xl border border-border/70 bg-background p-3">
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
                            size="icon"
                            variant="secondary"
                            className="h-8 w-8"
                            onClick={() => setEditingCustomer((v) => !v)}
                            disabled={actionLocked}
                            aria-label={editingCustomer ? "סגירת העריכה" : "עריכת פרטי הלקוח"}
                            title={editingCustomer ? "סגירת העריכה" : "עריכת פרטי הלקוח"}
                          >
                            {editingCustomer ? <CloseIcon className="h-4 w-4" /> : <EditIcon className="h-4 w-4" />}
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
                        <div className="space-y-1 border-t border-border/60 pt-2 text-sm">
                          {[
                            { label: "טלפון", value: selectedCustomer.phone, ltr: true },
                            { label: "וואטסאפ", value: selectedCustomer.whatsapp, ltr: true },
                            { label: "אימייל", value: selectedCustomer.email, ltr: true },
                            { label: "כתובת", value: omitUnknownPlace(selectedCustomer.address || selectedCustomer.city), ltr: false, isAddress: true },
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
                        <UserIcon className="h-6 w-6" />
                      </span>
                      <p className="text-sm font-medium text-foreground">בחרו לקוח מהרשימה</p>
                      <p className="text-sm text-muted-foreground">פרטי הלקוח יוצגו כאן וניתן יהיה לערוך אותם.</p>
                    </div>
                  )}
              </div>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- STEP 2 */}
      {step === 2 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_24rem]">
          {/* Product picker — deliberately NOT wrapped in a Card. The products
              are cards themselves, and a card-in-a-card cost ~70px of width on a
              phone: the search box and every product card are that much wider. */}
          <div className="space-y-3">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  placeholder="חיפוש..."
                  aria-label="חיפוש מוצר"
                  className="pe-9"
                />
              </div>
              {productSearchLoading ? <p className="text-xs text-muted-foreground">מחפש מוצרים...</p> : null}

              <div className="lg:max-h-[28rem] lg:overflow-auto">
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
                          "group min-w-0 min-h-[8rem] rounded-xl border p-2.5 text-right transition-colors",
                          selected
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-border/70 bg-background active:bg-primary/5 md:hover:border-primary/40 md:hover:bg-primary/5",
                          actionLocked && "cursor-not-allowed opacity-70"
                        )}
                      >
                        <div className="flex h-full min-w-0 flex-col justify-between gap-2">
                          <div className="flex min-w-0 items-start justify-between gap-2">
                            <div className="min-w-0 line-clamp-3 break-words text-sm font-semibold leading-5">
                              {product.name}
                            </div>
                            {selected ? (
                              <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                                {selected.line.quantity_ordered}
                              </span>
                            ) : null}
                          </div>

                          <div className="min-w-0 space-y-0.5 text-xs text-muted-foreground">
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
                              <AddIcon className="h-3.5 w-3.5" />
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
          </div>

          {/* Order items cart — fills its grid cell so its height matches the product picker; the product column stays its natural size and the cart scrolls once it reaches that height */}
          <div className={cn(lines.length > 0 && "lg:relative")}>
            <div className={cn(lines.length > 0 && "lg:absolute lg:inset-0")}>
            {/* Above the cart card, not inside it — adding a free line is an
                action on the cart, not one of its rows. */}
            <div className="mb-3 lg:shrink-0">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={addCustomLine}
                disabled={actionLocked}
                className="w-full sm:w-auto"
              >
                <AddIcon className="me-1 h-3.5 w-3.5" /> שורה חופשית
              </Button>
            </div>

            {/* The cart IS a card: it's a distinct panel beside the picker, not a
                wrapper around cards. */}
            <div
              className={cn(
                "space-y-3 rounded-xl border border-border/70 bg-background p-3",
                lines.length > 0 && "lg:flex lg:h-full lg:flex-col"
              )}
            >
            <div className="flex flex-row items-center justify-between gap-2 lg:shrink-0">
              <h3 className="flex items-center gap-2 text-base font-semibold">
                <OrderIcon className="h-5 w-5 text-primary" /> פריטי הזמנה
              </h3>
              <Badge variant="info">{totalUnits}</Badge>
            </div>
            <div className={cn("space-y-3", lines.length > 0 && "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col")}>
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
                    const available = availableByProductId.get(line.product_id);
                    const shortfall =
                      typeof available === "number" && line.quantity_ordered > available;
                    const isCustom = line.product_id.startsWith("custom:");
                    return (
                      <div key={`${line.product_id}-${index}`} className="space-y-2 border-b border-border/60 pb-3 last:border-0 last:pb-0">
                        <div className="flex items-center justify-between gap-2">
                          {isCustom ? (
                            <Input
                              value={line.product_name}
                              disabled={actionLocked}
                              onChange={(e) =>
                                updateLine(index, { product_name: e.target.value, description: e.target.value })
                              }
                              placeholder="שם השורה (למשל: משלוח)"
                              className="h-8 min-w-0"
                            />
                          ) : (
                            <p className="min-w-0 truncate text-sm font-medium text-foreground">{line.product_name}</p>
                          )}
                          <span className="shrink-0 text-sm font-semibold text-foreground">{formatCurrency(lineTotal)}</span>
                        </div>
                        {shortfall ? (
                          <p className="text-xs font-medium text-destructive-soft-foreground">
                            חסר במלאי — במלאי {available}, הוזמנו {line.quantity_ordered}
                          </p>
                        ) : null}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 transition hover:bg-muted disabled:opacity-50"
                              onClick={() => decrementLine(index)}
                              disabled={actionLocked || line.quantity_ordered <= 1}
                              aria-label={`הפחתת כמות של ${line.product_name}`}
                            >
                              <RemoveIcon className="h-3.5 w-3.5" />
                            </button>
                            <span className="min-w-8 text-center text-sm font-semibold">{line.quantity_ordered}</span>
                            <button
                              type="button"
                              className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 transition hover:bg-muted"
                              onClick={() => incrementLine(index)}
                              disabled={actionLocked}
                              aria-label={`הגדלת כמות של ${line.product_name}`}
                            >
                              <AddIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <DeleteButton
                            onClick={() => removeLine(index)}
                            disabled={actionLocked}
                            label={`הסרת ${line.product_name}`}
                          />
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
                          onChange={(e) =>
                            setOrderDiscount(
                              String(Math.min(toNonNegativeInt(Number(e.target.value || 0)), Math.max(subtotal, 0)))
                            )
                          }
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
            </div>
            </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- STEP 3 */}
      {step === 3 ? (
        <div className="space-y-4">
          {/* Payment — invoice, terms, due date and the payments themselves.
              No Card wrapper: its padding cost width the fields needed. */}
          <div className="space-y-3">
            <div className="space-y-4">
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
                  <NativeSelect
                    value={paymentTerms}
                    onChange={(e) => applyPaymentTerms(e.target.value)}
                    disabled={actionLocked}
                  >
                    {PAYMENT_TERMS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </NativeSelect>
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
                  <AddIcon className="h-4 w-4" /> תשלום
                </Button>
              </div>

              {initialPayments.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">תשלומים קיימים</p>
                  {initialPayments.map((payment) => (
                    <div key={payment.id} className="space-y-2 rounded-xl border bg-muted/20 p-3 text-sm">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
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
                <EmptyState dense>
                  עדיין לא הוזנו תשלומים חדשים.
                </EmptyState>
              ) : null}

              {newPayments.map((payment, index) => (
                <div key={index} className="space-y-3 rounded-xl border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">תשלום חדש #{index + 1}</p>
                    <DeleteButton onClick={() => removePaymentDraft(index)} disabled={actionLocked} label="הסרת תשלום" />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">אמצעי תשלום *</label>
                      <NativeSelect
                        value={payment.payment_method}
                        disabled={actionLocked}
                        onChange={(e) => {
                          const m = e.target.value;
                          updatePaymentDraft(index, {
                            payment_method: m,
                            account_id: payment.account_id || defaultAccountForMethod(paymentAccountsList, m),
                          });
                        }}
                      >
                        <option value="">בחר אמצעי תשלום...</option>
                        {ORDER_PAYMENT_METHOD_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </NativeSelect>
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
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                <div className="rounded-xl border border-destructive bg-destructive-soft p-3 text-sm text-destructive-soft-foreground">
                  {PREPAYMENT_WIZARD_WARNING}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- STEP 4 */}
      {step === 4 ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-md border border-secondary/35 bg-secondary/10 px-3 py-2.5 text-sm text-foreground">
            <AiIcon className="h-4 w-4 shrink-0 text-secondary" />
            <span>
              בדקו שהכל תקין ולחצו <span className="font-semibold">{isEditMode ? "שמירת שינויים" : "יצירת הזמנה"}</span>.
            </span>
          </div>

          <div className="space-y-4 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">
            {/* Customer */}
            <SummarySection
              icon={<UserIcon className="h-4 w-4" />}
              title="לקוח"
              onEdit={() => goToStep(1)}
              editDisabled={actionLocked}
            >
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
              
            </SummarySection>

            {/* Items */}
            <SummarySection
              icon={<OrderIcon className="h-4 w-4" />}
              title={`פריטים (${lines.length})`}
              onEdit={() => goToStep(2)}
              editDisabled={actionLocked}
            >
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
              
            </SummarySection>
          </div>

          <div className="space-y-4 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">
            {/* Not a SummarySection: these fields are editable right here, so
                there is nothing to send you back a step for. Same heading and
                same bordered box as the summary sections beside it. */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="text-muted-foreground">
                  <DocumentIcon className="h-4 w-4" />
                </span>
                פרטי הזמנה
              </div>
              <div className="space-y-3 rounded-xl border p-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">תאריך הזמנה *</label>
                    <DateInput value={orderDate} onChange={(e) => applyOrderDate(e.target.value)} placeholder="בחר תאריך הזמנה" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">סטטוס הזמנה</label>
                    <NativeSelect
                      value={orderStatus}
                      onChange={(e) => setOrderStatus(e.target.value)}
                      disabled={actionLocked}
                    >
                      {ORDER_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </NativeSelect>
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
              </div>
            </div>

            {/* Payment summary — read-only; edit jumps back to the payment step */}
            <SummarySection
              icon={<CardIcon className="h-4 w-4" />}
              title="תשלום"
              onEdit={() => goToStep(3)}
              editDisabled={actionLocked}
            >
                <SummaryRow label="חשבונית" value={needsInvoice ? "צריך חשבונית" : "לא צריך חשבונית"} />
                <SummaryRow label="גבייה" value={collectOnDelivery ? "הנהג גובה תשלום במסירה" : "תשלום למשרד"} />
                <SummaryRow label="צורת תשלום" value={termsLabel(paymentTerms)} />
                {paymentTerms !== "immediate" ? <SummaryRow label="תאריך פירעון" value={dueDate || "-"} /> : null}
                <SummaryRow label="סטטוס תשלום" value={paymentStatusLabel(paymentStatus)} />
                <SummaryRow label="שולם / יוזן" value={formatCurrency(combinedPaidTotal)} />
                <SummaryRow label="יתרה אחרי שמירה" value={formatCurrency(remainingBalance)} />
              
            </SummarySection>
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
      </StepWizard>
    </>
  );
}
