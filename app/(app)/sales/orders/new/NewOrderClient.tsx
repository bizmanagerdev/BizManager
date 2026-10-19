"use client";

import Link from "next/link";
import { pinFrom } from "@/lib/delivery-location";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AddIcon, AddUserIcon, AiIcon, CardIcon, CheckIcon, CloseIcon, DocumentIcon, OrderIcon, RemoveIcon, SearchIcon, UserIcon, WarningIcon, WazeIcon } from "@/components/ui/icons";
import { DeleteButton, EditButton, IconButton } from "@/components/ui/icon-button";
import { Field } from "@/components/ui/field";
import { SECTION_ICON_CLASS, SectionCount } from "@/components/ui/section-card";
import { MetaRow } from "@/components/ui/meta-row";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { cn } from "@/lib/utils";
import { toHebrewError } from "@/lib/error-messages";
import { saveDraft, loadDraft, clearDraft } from "@/lib/offline-queue";
import { registerReversibleCreate } from "@/lib/undo-engine";
import { EmptyState } from "@/components/ui/empty-state";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { SEGMENT, SEGMENTED_GROUP, TOGGLE_OFF, TOGGLE_ON } from "@/components/ui/filter-chip";
import { addressQuality, omitUnknownPlace, orderCity, plainAddress } from "@/lib/ui/cities";
import { getOrderStatusLabel } from "@/lib/ui/status-colors";
import { Badge } from "@/components/ui/badge";
import { DateInput } from "@/components/ui/date-input";
import AccountSelect from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import { nextMonthTenth, parseInstallments, splitCardInstallments } from "@/lib/payments";
import { CardInstallmentsField } from "@/components/financial/CardInstallmentsField";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { CustomerForm } from "@/components/customers/CustomerForm";
import type { CustomerRecord } from "@/components/customers/CustomerForm";
import { useCustomerPicker } from "@/hooks/useCustomerPicker";
import {
  ORDER_PAYMENT_METHOD_OPTIONS,
  derivePaymentStatus,
  paymentMethodLabel,
  paymentStatusLabel,
} from "@/lib/orders/paymentStatus";
import { PREPAYMENT_WIZARD_WARNING } from "@/lib/orders/prepayment";
import { searchProducts } from "@/lib/orders/searchProducts";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CheckDetailsFields } from "@/components/payments/CheckDetailsFields";
import { uploadCheckPhotosForPayments } from "@/lib/payments/uploadCheckPhotos";
import { PAYMENT_TERMS_OPTIONS, computeDueDate } from "@/lib/paymentTerms";
import { SummaryRow, SummarySection } from "@/components/ui/summary";
import { StepWizard, WizardTitle, useStepFlow } from "@/components/ui/step-wizard";
import { OptionRow, StepHeading } from "@/components/ui/option-row";
import {
  type CustomerOption,
  type Step,
  ORDER_STATUS_OPTIONS,
  STEP_LABEL,
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
import { whenDeviceSavesSent } from "@/lib/powersync/store";
import { formatShortDate } from "@/lib/date";
import { ORDER_NOT_SENT_YET, deviceOrderSaves } from "@/lib/orders/device-order-saves";
import { addressNotFound, addressPoint, addressVerified, structuredPoint } from "@/lib/address/columns";
import { useCustomerSearchIndex } from "@/hooks/useCustomerSearchIndex";
import { isFullAddress } from "@/lib/address/structured";
import { addressHelpPrompt, customerAddressHelp } from "@/lib/address/address-help";

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
  branch_id?: string | null;
  order_date: string;
  status: string;
  payment_status: string;
  payment_terms?: string | null;
  due_date?: string | null;
  requested_delivery_date?: string | null;
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
  /** Card only: saved as this many payments, a month apart. Absent on older saved drafts. */
  installments?: string;
};

/** Serialisable in-progress form, persisted to localStorage so a create draft
 *  survives going offline / leaving the app / a reload (check photos excluded
 *  — File objects can't be serialised and must be re-attached). */
type OrderDraft = {
  step: Step;
  customerId: string;
  branchId: string;
  orderDate: string;
  orderStatus: string;
  paymentTerms: string;
  dueDate: string;
  requestedDeliveryDate: string;
  orderDiscount: string;
  orderDiscountMode: "amount" | "percent";
  needsInvoice: boolean;
  collectOnDelivery: boolean;
  notes: string;
  lineDiscountModes: Record<string, "amount" | "percent">;
  lines: OrderLine[];
  newPayments: Omit<PaymentDraft, "check_photo_files">[];
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
  onDirtyChange,
  initialStatusOverride,
  bodyRef: externalBodyRef,
  dialogTitle,
  dialogDescription,
  draftKey,
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
  /** Reports "the wizard has moved past its first step" — the embedding
   *  dialog's own outside-click discard guard uses this, since a lot of this
   *  wizard's own progress (tapping a customer card, an option row) fires no
   *  native input/change event for a generic dirty-detector to see. */
  onDirtyChange?: (dirty: boolean) => void;
  initialStatusOverride?: string;
  allowOrderStatusEdit?: boolean;
  /** The embedding dialog's own ref to the scrollable body — so IT can gate a
   *  swipe-to-dismiss on "scrolled to top" too. Falls back to an internal ref
   *  when standalone (no wrapper dialog to coordinate with). */
  bodyRef?: { current: HTMLDivElement | null };
  /** Visible title above the stepper, embedded only — the standalone page
   *  callers don't pass this (they have their own page-level heading, and a
   *  second one inside the wizard's sticky header would duplicate it). */
  dialogTitle?: string;
  dialogDescription?: string;
  /** Create mode: persist the in-progress form under this localStorage key so
   *  it survives going offline / leaving the app / a reload. Omit to disable. */
  draftKey?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const searchParams = useSearchParams();
  const prefillHandled = useRef(false);
  const isEditMode = mode === "edit" && initialOrder !== null;
  // An edit is one open form — every step's fields at once, Save always there
  // (owner, 2026-10-09: "edit forms one form"); a new order goes step by step.
  const oneForm = isEditMode;
  const cancelHref = isEditMode ? `/sales/orders/${initialOrder.id}` : "/sales";

  // Restore an in-progress create draft (offline / app-left / reload). Loaded
  // once on mount; never in edit mode (a stale draft must not clobber the row).
  const canDraft = Boolean(draftKey) && !isEditMode;
  const [restoredDraft] = useState<OrderDraft | null>(() =>
    canDraft ? loadDraft<OrderDraft>(draftKey!) : null
  );

  const [step, setStep] = useState<Step>(restoredDraft?.step ?? "customer");
  const topRef = useRef<HTMLDivElement>(null);
  // Embedded (dialog) mode is a fixed-height column: the step bar and the action
  // bar are pinned and only this middle section scrolls, so a step change resets
  // *it* rather than the dialog/page.
  const internalBodyRef = useRef<HTMLDivElement>(null);
  const bodyRef = externalBodyRef ?? internalBodyRef;
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
  }, [step, embedded, bodyRef]);
  const [orderDate, setOrderDate] = useState(
    initialOrder?.order_date ?? restoredDraft?.orderDate ?? getTodayDate()
  );
  const [orderStatus, setOrderStatus] = useState(
    initialStatusOverride ?? initialOrder?.status ?? restoredDraft?.orderStatus ?? "draft"
  );
  // New orders default to "שוטף" (eom); edits keep the stored term (null → immediate).
  const initialPaymentTerms =
    initialOrder?.payment_terms ?? restoredDraft?.paymentTerms ?? (initialOrder ? "immediate" : "eom");
  const [paymentTerms, setPaymentTerms] = useState(initialPaymentTerms);
  const [dueDate, setDueDate] = useState(
    initialOrder?.due_date ??
      restoredDraft?.dueDate ??
      computeDueDate(initialOrder?.order_date ?? getTodayDate(), initialPaymentTerms) ??
      ""
  );
  // No default and no computed fallback (unlike dueDate) — blank means "no
  // specific date requested," which is the normal case.
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState(
    initialOrder?.requested_delivery_date ?? restoredDraft?.requestedDeliveryDate ?? ""
  );
  const [orderDiscount, setOrderDiscount] = useState(
    String(initialOrder?.discount_amount ?? restoredDraft?.orderDiscount ?? 0)
  );
  const [orderDiscountMode, setOrderDiscountMode] = useState<"amount" | "percent">(
    restoredDraft?.orderDiscountMode ?? "amount"
  );
  // Single toggle: on (default for a new order) = needs invoice, off = doesn't.
  const [needsInvoice, setNeedsInvoice] = useState<boolean>(
    initialOrder?.needs_invoice ?? restoredDraft?.needsInvoice ?? true
  );
  const [collectOnDelivery, setCollectOnDelivery] = useState<boolean>(
    initialOrder?.collect_payment_on_delivery ?? restoredDraft?.collectOnDelivery ?? false
  );
  const [notes, setNotes] = useState(initialOrder?.notes ?? restoredDraft?.notes ?? "");
  // Per-line discount input mode (₪ vs %); the stored value is always an absolute amount.
  const [lineDiscountModes, setLineDiscountModes] = useState<Record<string, "amount" | "percent">>(
    restoredDraft?.lineDiscountModes ?? {}
  );

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
  const [lines, setLines] = useState<OrderLine[]>(() => {
    if (initialOrder) {
      return initialOrder.items.map((line) =>
        !line.product_id
          ? {
              ...line,
              product_id: `custom:${crypto.randomUUID()}`,
              description: line.description || line.product_name,
            }
          : line
      );
    }
    return restoredDraft?.lines ?? [];
  });
  // Restored payment drafts never carry check photos (Files can't be
  // serialised) — the user re-attaches those if the draft had any.
  const [newPayments, setNewPayments] = useState<PaymentDraft[]>(() =>
    (restoredDraft?.newPayments ?? []).map((payment) => ({ ...payment, check_photo_files: [] }))
  );
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
  // The customer just picked, when their address isn't one Waze can use.
  const [addressPromptFor, setAddressPromptFor] = useState<CustomerOption | null>(null);

  const actionLocked = submitting;

  useEffect(() => {
    onActionLockedChange?.(actionLocked);
  }, [actionLocked, onActionLockedChange]);

  // The + menu's first page of customers comes without the saved point and
  // Google's fields; the customer index (loaded for the search anyway) has
  // them for everyone, so only those are taken from it.
  const { entries: customerIndexEntries } = useCustomerSearchIndex();
  const initialCustomerOptions = useMemo(() => {
    const indexed = new Map(customerIndexEntries.map((entry) => [entry.id, entry]));
    return customers
      .map((source) => {
        const id = getString(source, ["id", "customer_id"]) ?? "";
        const entry = source.addr_city === undefined ? indexed.get(id) : undefined;
        const row: Row = entry
          ? {
              ...source,
              delivery_lat: entry.delivery_lat,
              delivery_lng: entry.delivery_lng,
              addr_city: entry.addr_city,
              addr_street: entry.addr_street,
              addr_house_number: entry.addr_house_number,
              addr_lat: entry.addr_lat,
              addr_lng: entry.addr_lng,
              addr_place_id: entry.addr_place_id,
            }
          : source;
        return {
          id,
          name: getString(row, ["name", "customer_name", "name_for_invoice", "email", "phone"]) ?? "לקוח",
          nameForInvoice: getString(row, ["name_for_invoice"]),
          phone: getString(row, ["phone", "mobile", "tel"]),
          whatsapp: getString(row, ["whatsapp"]),
          email: getString(row, ["email"]),
          address: getString(row, ["address"]),
          city: extractCityFromAddress(getString(row, ["address"])),
          requiresPrepayment: row.requires_prepayment === true,
          pin: pinFrom(row.delivery_lat, row.delivery_lng),
          addressNotFound: addressNotFound(row),
          addressVerified: addressVerified(row),
          addressPoint: addressPoint(row),
        };
      })
      .filter((row) => row.id);
  }, [customers, customerIndexEntries]);

  const {
    customerId,
    setCustomerId,
    customerQuery,
    setCustomerQuery,
    customerTab,
    setCustomerTab,
    editingCustomer,
    setEditingCustomer,
    mobileListCollapsed,
    setMobileListCollapsed,
    setPickedCustomer,
    customerSearchError,
    customerSearchLoading,
    filteredCustomers,
    selectedCustomer,
    mergeSavedCustomer,
  } = useCustomerPicker<CustomerOption>({
    initial: initialCustomerOptions,
    preselectedId: initialOrder?.customer_id ?? restoredDraft?.customerId ?? "",
    startListCollapsed: oneForm,
    mapSearchResult: (entry) => mapCustomerSearchResult(entry as Record<string, unknown>),
  });

  // Which of the customer's branches this order is for — only asked about when
  // the customer actually has more than one (see the "branch" step gating below).
  const [branchId, setBranchId] = useState(initialOrder?.branch_id ?? restoredDraft?.branchId ?? "");
  // Where the order goes: the branch's address when it's for a branch that has
  // one, in the branch's city (lib/ui/cities.ts orderCity), else the customer's.
  const orderBranch = branchId ? selectedCustomer?.branches?.find((b) => b.id === branchId) : undefined;
  const orderAddress = orderBranch?.address?.trim()
    ? orderBranch.address
    : selectedCustomer?.address || selectedCustomer?.city || null;
  const orderAddressCity = orderBranch?.address?.trim()
    ? orderCity({
        branchAddress: orderBranch.address,
        customerAddress: selectedCustomer?.address,
        customerCity: selectedCustomer?.city,
      })
    : selectedCustomer?.city ?? null;
  // The customer's saved point — not for a branch that has its own address.
  const orderPin = orderBranch?.address?.trim() ? null : selectedCustomer?.pin ?? selectedCustomer?.addressPoint ?? null;
  const orderAddressNotFound = !orderBranch?.address?.trim() && selectedCustomer?.addressNotFound === true;

  useEffect(() => {
    if (prefillHandled.current && !isEditMode) return;

    const selectedId = initialOrder?.customer_id ?? "";
    if (selectedId) {
      const matchedInitial = initialCustomerOptions.find((row) => row.id === selectedId) ?? null;
      if (matchedInitial) {
        setCustomerId(matchedInitial.id);
        setCustomerQuery(matchedInitial.name);
        setPickedCustomer(matchedInitial);
        if (!isEditMode && customerAddressHelp(matchedInitial)) setAddressPromptFor(matchedInitial);
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
      setStep("items");
      // Started from the customer's page, so the pick happened there: asked now.
      if (customerAddressHelp(matched)) setAddressPromptFor(matched);
    }

    prefillHandled.current = true;
    // setCustomerId/setCustomerQuery/setPickedCustomer are stable setters from
    // useCustomerPicker — omitted deliberately, not missed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCustomerOptions, initialOrder?.customer_id, isEditMode, searchParams]);

  // Autosave the in-progress create form so it survives offline / leaving the app
  // / a reload. Runs on every change; the wizard only mounts while its dialog is
  // open, so there's no "is open" guard to add.
  useEffect(() => {
    if (!canDraft) return;
    saveDraft(draftKey!, {
      step,
      customerId,
      branchId,
      orderDate,
      orderStatus,
      paymentTerms,
      dueDate,
      requestedDeliveryDate,
      orderDiscount,
      orderDiscountMode,
      needsInvoice,
      collectOnDelivery,
      notes,
      lineDiscountModes,
      lines,
      newPayments: newPayments.map(({ check_photo_files: _checkPhotoFiles, ...rest }) => rest),
    } satisfies OrderDraft);
  }, [
    canDraft,
    draftKey,
    step,
    customerId,
    branchId,
    orderDate,
    orderStatus,
    paymentTerms,
    dueDate,
    requestedDeliveryDate,
    orderDiscount,
    orderDiscountMode,
    needsInvoice,
    collectOnDelivery,
    notes,
    lineDiscountModes,
    lines,
    newPayments,
  ]);

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

      void searchProducts(productQuery, 50, controller.signal)
        .then((products) => {
          const remoteProducts = (products as Row[])
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
  const hasStockShortfall = useMemo(
    () =>
      lines.some((line) => {
        const available = availableByProductId.get(line.product_id);
        return typeof available === "number" && line.quantity_ordered > available;
      }),
    [lines, availableByProductId]
  );

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

  // Same id every time so repeated clicks on the same product replace the
  // toast instead of stacking a new one per click.
  function warnIfShortfall(productId: string, productName: string, nextQuantity: number) {
    const available = availableByProductId.get(productId);
    if (typeof available !== "number" || nextQuantity <= available) return;
    toast.warning(
      available > 0 ? `נשארו רק ${available} במלאי מ${productName}` : `אין מלאי זמין מ${productName}`,
      { id: `stock-shortfall-${productId}` }
    );
  }

  function addProduct(productId: string) {
    const product = productOptions.find((p) => p.id === productId);
    if (!product) return;

    const existingLine = lines.find((line) => line.product_id === productId);
    warnIfShortfall(productId, product.name, (existingLine?.quantity_ordered ?? 0) + 1);

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
    const line = lines[index];
    if (line) warnIfShortfall(line.product_id, line.product_name, line.quantity_ordered + 1);
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, quantity_ordered: l.quantity_ordered + 1 } : l))
    );
  }

  function decrementLine(index: number) {
    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const quantity = Math.max(1, line.quantity_ordered - 1);
        // updateLine's cap too: a ₪ discount larger than the smaller line drove
        // it below zero (₪200 off 2×₪120, then − → −₪80; found by the tests).
        return {
          ...line,
          quantity_ordered: quantity,
          discount_amount: Math.min(line.discount_amount, quantity * line.unit_price),
        };
      })
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

    const badInstallments = paymentsToSubmit.find(
      (payment) => payment.payment_method === "credit_card" && parseInstallments(payment.installments ?? "1") === null
    );
    if (badInstallments) {
      setSubmitError("מספר התשלומים צריך להיות בין 1 ל-36.");
      return;
    }
    // A card payment in installments goes in as that many payments, a month
    // apart — what used to be typed in by hand, one row each.
    const expandedPayments = paymentsToSubmit.flatMap((payment) =>
      payment.payment_method === "credit_card"
        ? splitCardInstallments({
            amount: Number(payment.amount_total || 0),
            paymentDate: payment.payment_date,
            count: parseInstallments(payment.installments ?? "1") ?? 1,
            notes: payment.notes,
          }).map((part) => ({
            ...payment,
            amount_total: String(part.amount),
            payment_date: part.paymentDate,
            due_date: part.dueDate,
            notes: part.notes ?? "",
          }))
        : [payment]
    );

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
      const requestBody: Record<string, unknown> = {
        order_id: initialOrder?.id,
        customer_id: customerId,
        branch_id: branchId || null,
        order_date: orderDate,
        status: orderStatus,
        payment_status: paymentStatus,
        payment_terms: paymentTerms,
        collect_payment_on_delivery: collectOnDelivery,
        due_date: dueDate || null,
        requested_delivery_date: requestedDeliveryDate || null,
        discount_amount: Number.isFinite(orderDiscountNumber) ? orderDiscountNumber : 0,
        needs_invoice: needsInvoice,
        notes: notes.trim() || null,
        payments: expandedPayments.map((payment) => ({
          amount_total: Number(payment.amount_total || 0),
          payment_date: payment.payment_date,
          payment_method: payment.payment_method,
          account_id: payment.account_id || null,
          // A card payment lands with the month's deposit — the 10th of the
          // next month (lib/card-settlements.ts).
          due_date:
            payment.payment_method === "credit_card"
              ? nextMonthTenth(payment.payment_date) || null
              : payment.due_date.trim() || null,
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
      };

      // Saved on the phone first (lib/orders/device-order-saves.ts): the form
      // closes at once and the order is on the device's pages, with no
      // connection too — unless a check comes with photos: they go up with
      // its payment, which needs the order on the server first.
      const withCheckPhotos = expandedPayments.some(
        (payment) => payment.payment_method === "check" && payment.check_photo_files.length > 0
      );
      const device = withCheckPhotos ? null : deviceOrderSaves();
      let savedOrderId: string | null = null;
      if (device) {
        if (isEditMode) {
          if (await device.update(initialOrder!.id, requestBody)) savedOrderId = initialOrder!.id;
        } else {
          // The form as it stands (its autosaved draft) comes back if the server refuses the order.
          savedOrderId = await device.create(requestBody, canDraft ? { key: draftKey!, draft: loadDraft(draftKey!) } : null);
        }
      }

      if (!savedOrderId) {
        // Idempotency-Key: lets the server dedupe a network retry of a create so a
        // flaky connection can't produce two orders (the server caches the first
        // response and returns it for any replay of the same key).
        const idempotencyHeaders: Record<string, string> = { "content-type": "application/json" };
        if (!isEditMode) idempotencyHeaders["Idempotency-Key"] = crypto.randomUUID();
        // A customer just made on the phone may still be on its way to the
        // server — the order must not get there first.
        if (!isEditMode) await whenDeviceSavesSent();
        const res = await fetch(isEditMode ? "/api/orders/update" : "/api/orders/create", {
          method: "POST",
          headers: idempotencyHeaders,
          body: JSON.stringify(requestBody),
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
        // Every check's photos go up in one shared pool, not check after check.
        await uploadCheckPhotosForPayments(
          expandedPayments.flatMap((payment, i) => {
            const paymentId = insertedPaymentIds[i];
            return paymentId && payment.payment_method === "check" && payment.check_photo_files.length > 0
              ? [{ paymentId, files: payment.check_photo_files }]
              : [];
          })
        );
        savedOrderId = json.order_id;
      }

      if (canDraft) clearDraft(draftKey!);
      // Backorders are allowed by design (no hard block here) — just a heads-up
      // that the order was saved with a shortfall, without naming which line.
      if (hasStockShortfall) toast.warning("שימו לב: קיים חוסר במלאי בהזמנה זו.");
      const newOrderId = savedOrderId;
      if (embedded) {
        onSubmitted?.(newOrderId);
        startTransition(() => {
          router.refresh();
        });
      } else {
        emitNavigationStart();
        router.push("/sales");
        startTransition(() => {
          router.refresh();
        });
      }
      if (!isEditMode) {
        // Undo = a real reverse delete (not a deferred commit) — items/payments/
        // check-photo uploads already went through and needed the real order id,
        // same reasoning as ExpenseDialog's create-undo. Reuses the exact same
        // cascade-safe delete route DeleteOrderButton uses.
        registerReversibleCreate({
          scope: "order",
          id: newOrderId,
          message: "ההזמנה נוצרה",
          onUndo: async () => {
            // Made on the phone: it has to reach the server before it can be deleted there.
            if (!(await whenDeviceSavesSent())) return { ok: false, error: ORDER_NOT_SENT_YET };
            const delRes = await fetch("/api/orders/delete", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ order_id: newOrderId }),
            });
            const delJson = await delRes.json().catch(() => ({}));
            if (!delRes.ok || !(delJson as { ok?: boolean })?.ok) {
              return { ok: false, error: toHebrewError((delJson as { error?: string })?.error, "ביטול נכשל.") };
            }
            if (!embedded) router.push("/sales");
            startTransition(() => {
              router.refresh();
            });
            return { ok: true };
          },
        });
      }
    } catch (error: unknown) {
      const message = toHebrewError(error, "שגיאה לא ידועה");
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Step navigation / gating -------------------------------------------------

  const stepIds = useMemo<Step[]>(() => {
    const ids: Step[] = ["customer"];
    if ((selectedCustomer?.branches?.length ?? 0) > 0) ids.push("branch");
    ids.push("items", "invoice", "collection", "paymentTerms");
    if (paymentTerms !== "immediate") ids.push("dueDate");
    ids.push("payments", "orderDate", "orderStatus", "deliveryDate", "notes", "summary");
    return ids;
  }, [paymentTerms, selectedCustomer?.branches?.length]);
  const wizardSteps = useMemo(() => stepIds.map((id) => ({ n: id, label: STEP_LABEL[id] })), [stepIds]);

  // A step is "unlocked" only when every prerequisite up to it is satisfied.
  function isSatisfied(id: Step): boolean {
    if (id === "customer") return Boolean(customerId);
    if (id === "branch") return true; // "" (main/no branch) is itself a valid, pre-selected default
    if (id === "items") return lines.length > 0;
    return true;
  }
  const {
    stepIndex,
    isLastStep,
    stepUnlocked,
    canClickStep: canClickStepUnblocked,
    advanceTo,
  } = useStepFlow<Step>({ stepId: step, setStepId: setStep, steps: stepIds, isSatisfied });

  // The current step's fields — or, in one form, every step's (the summary
  // aside: the whole order is already on screen).
  const show = (id: Step) => (oneForm ? id !== "summary" && stepIds.includes(id) : step === id);
  // A pick moves a step form on; in one form it just sets the field.
  const advance = (id: Step) => {
    if (!oneForm) advanceTo(id);
  };

  // Changed? (closing then asks first.) A new order: once past its first step.
  // An edit: once a field differs from what the order had.
  const formSnapshot = oneForm
    ? JSON.stringify([
        customerId,
        branchId,
        orderDate,
        orderStatus,
        paymentTerms,
        dueDate,
        requestedDeliveryDate,
        orderDiscount,
        orderDiscountMode,
        needsInvoice,
        collectOnDelivery,
        notes,
        lines,
        newPayments,
        existingPaymentNotes,
      ])
    : "";
  const [initialSnapshot] = useState(formSnapshot);
  const dirty = oneForm ? formSnapshot !== initialSnapshot : stepIndex(step) > 0;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // While the inline create/edit customer form is open the user must save or cancel
  // before they can advance — otherwise the in-progress customer edit would be abandoned.
  // Wrapped externally (reads `step`, which doesn't exist yet at the point
  // useStepFlow is called — same reasoning as NewProjectClient's own version).
  const customerFormOpen = step === "customer" && (editingCustomer || customerTab === "new");
  function canClickStep(id: Step) {
    if (customerFormOpen && stepIndex(id) > stepIndex(step)) return false;
    return canClickStepUnblocked(id);
  }

  function goToStep(id: Step) {
    if (!stepUnlocked(id)) return;
    setStep(id);
    setEditingCustomer(false);
  }
  function goNext() {
    if (isLastStep) {
      void submitOrder();
      return;
    }
    const next = stepIds[stepIndex(step) + 1];
    if (next) goToStep(next);
  }
  function goBack() {
    const prev = stepIds[stepIndex(step) - 1];
    if (!prev) return;
    setStep(prev);
    setEditingCustomer(false);
  }

  const nextDisabled = oneForm
    ? actionLocked || customerFormOpen || !customerId || lines.length === 0
    : isLastStep
      ? submitting
      : actionLocked || customerFormOpen || !isSatisfied(step);
  // Only the final action is spelled out here — the wizard labels the
  // intermediate steps from the step list itself.
  const nextLabel = oneForm || isLastStep
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
    mergeSavedCustomer({
      id: customer.id,
      name: customer.name,
      nameForInvoice: customer.name_for_invoice ?? null,
      phone: customer.phone,
      whatsapp: customer.whatsapp,
      email: customer.email,
      address: customer.address,
      city: extractCityFromAddress(customer.address),
      requiresPrepayment: customer.requires_prepayment,
      pin: selectedCustomer?.id === customer.id ? selectedCustomer.pin ?? null : null,
      addressNotFound: customer.address_not_found === true,
      addressVerified: customer.structured_address === undefined ? undefined : isFullAddress(customer.structured_address),
      addressPoint:
        customer.structured_address === undefined
          ? selectedCustomer?.id === customer.id
            ? selectedCustomer.addressPoint ?? null
            : null
          : structuredPoint(customer.structured_address),
    });
    setCustomerQuery(customer.name);
  }

  // Explicit dismiss (the X / the standalone page's cancel link) discards the
  // saved draft so reopening starts fresh. Passively leaving the app (reload /
  // navigate away / background) keeps it — that's what the autosave is for.
  function handleCancel() {
    if (canDraft) clearDraft(draftKey!);
    onCancel?.();
  }

  return (
    <>
      <ConfirmDialog
        open={prepaymentConfirmOpen}
        onOpenChange={setPrepaymentConfirmOpen}
        destructive
        title="לקוח בתשלום מראש"
        description={`${selectedCustomer?.name ?? "הלקוח"} מסומן לתשלום מראש ונשארה יתרה לתשלום. ההזמנה תיווצר ותסומן באדום עד לגבייה — אין לספק לפני התשלום. ליצור בכל זאת?`}
        confirmLabel="יצירה בכל זאת"
        cancelLabel="חזרה לתשלום"
        loading={submitting}
        onConfirm={() => {
          setPrepaymentConfirmOpen(false);
          void submitOrder(true);
        }}
      />
      {/* Asked the moment the customer is picked, while they're still on the
          phone (owner, 2026-10-16: "when I click a customer that doesn't have
          a real address … it should say you gotta save the address"). */}
      <ConfirmDialog
        open={addressPromptFor !== null}
        onOpenChange={(open) => {
          if (!open) setAddressPromptFor(null);
        }}
        title={addressHelpPrompt(addressPromptFor, "order").title}
        description={addressHelpPrompt(addressPromptFor, "order").description}
        confirmLabel="עדכון הכתובת"
        cancelLabel="המשך בלי"
        onConfirm={() => {
          setAddressPromptFor(null);
          setEditingCustomer(true);
          // Asked on arrival from the customer's page, the wizard is past this step.
          setStep("customer");
        }}
      />
      <StepWizard
        variant={embedded ? "dialog" : "page"}
        rootRef={topRef}
        bodyRef={bodyRef}
        title={
          dialogTitle ? <WizardTitle title={dialogTitle} description={dialogDescription ?? dialogTitle} /> : undefined
        }
        progressVariant={oneForm ? "none" : "bar"}
        showStepCounter={!oneForm}
        steps={wizardSteps}
        current={step}
        canClickStep={canClickStep}
        onStepClick={goToStep}
        // Embedded, the X in the step bar is the single way out. Standalone there
        // is no X, so the action bar keeps an explicit cancel link instead.
        onClose={embedded ? handleCancel : undefined}
        // Embedded is always a full-page mobile dialog now (see QuickCreateDialogs
        // / OrderEditDialog) — the grab-bar affordance for its swipe-to-dismiss.
        grabber={embedded}
        closeDisabled={actionLocked}
        onBack={!oneForm && stepIndex(step) > 0 ? goBack : undefined}
        backDisabled={actionLocked}
        onNext={oneForm ? () => void submitOrder() : goNext}
        nextLabel={nextLabel}
        nextDisabled={nextDisabled}
        isLastStep={oneForm || isLastStep}
        // Enter in a field moves a new order on, like the Next button.
        nextOnEnter={!oneForm}
        // One form has no summary step to show a refusal in — it shows by Save.
        error={oneForm ? (submitError ?? undefined) : undefined}
        footerStart={
          embedded ? undefined : (
            // Grey: a cancel never wears the save's look (owner, 2026-10-11).
            // OrderFormSkeleton draws the same button.
            <Button type="button" variant="muted" asChild disabled={actionLocked} className="me-auto" onClick={handleCancel}>
              <Link href={cancelHref}>ביטול</Link>
            </Button>
          )
        }
        footerCenter={
          lines.length > 0 ? (
            <div className="order-first w-full text-center leading-tight sm:order-none sm:w-auto sm:text-end">
              <div className="whitespace-nowrap text-[0.647rem] font-medium uppercase tracking-wide text-muted-foreground">
                {effectiveOrderDiscount > 0 ? "סכום לתשלום" : "סכום ביניים"}
              </div>
              <div className="whitespace-nowrap text-base font-bold text-foreground">
                {formatCurrency(totalAmount)}
              </div>
            </div>
          ) : null
        }
      >
      {/* Every step opens with a StepHeading now — bar mode (progressVariant="bar",
          matching every other converged wizard) shows "שלב X מתוך Y" instead of
          named circles, so the old "the stepper already names it" reasoning for
          skipping a heading no longer holds now that the step names aren't visible. */}
      {customersError ? <p className="text-sm text-destructive">שגיאת לקוחות: {customersError}</p> : null}
      {productsError ? <p className="text-sm text-destructive">שגיאת מוצרים: {productsError}</p> : null}
      {customerSearchError ? <p className="text-sm text-destructive">שגיאת חיפוש לקוחות: {customerSearchError}</p> : null}
      {productSearchError ? <p className="text-sm text-destructive">שגיאת חיפוש מוצרים: {productSearchError}</p> : null}

      {/* --------------------------------------------------------------- CUSTOMER */}
      {show("customer") ? (
        <div className="space-y-4">
          <StepHeading compact={oneForm} title="איזה לקוח?" className="mt-0 border-t-0 pt-0" />
          {/* The app's one segmented toggle (filter-chip.tsx), blue when on. */}
          <div className={SEGMENTED_GROUP}>
            <button
              type="button"
              aria-pressed={customerTab === "existing"}
              onClick={() => setCustomerTab("existing")}
              className={cn(SEGMENT, customerTab === "existing" ? TOGGLE_ON : TOGGLE_OFF)}
            >
              לקוח קיים
            </button>
            <button
              type="button"
              aria-pressed={customerTab === "new"}
              onClick={() => setCustomerTab("new")}
              className={cn(SEGMENT, customerTab === "new" ? TOGGLE_ON : TOGGLE_OFF)}
            >
              לקוח חדש
            </button>
          </div>

          {customerTab === "new" ? (
            <div className="space-y-3">
              <div>
                <div className="mx-auto max-w-lg">
                  <CustomerForm
                    mode="create"
                    initialName={customerQuery.trim()}
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
                    {/* The search glyph on the start side, as every search
                        (owner, 2026-10-11: it sat at the end here); the ✕ that
                        clears it at the end. */}
                    <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
                    ) : null}
                    <Input
                      value={customerQuery}
                      onChange={(e) => {
                        setCustomerQuery(e.target.value);
                        setMobileListCollapsed(false);
                      }}
                      onFocus={() => setMobileListCollapsed(false)}
                      placeholder="חיפוש..."
                      aria-label="חיפוש לקוח"
                      data-no-enter-next
                      className="ps-9 pe-9"
                    />
                  </div>
                  {customerSearchLoading ? (
                    <p className={cn("text-xs text-muted-foreground", mobileListCollapsed && (oneForm ? "hidden" : "hidden lg:block"))}>מחפש לקוחות...</p>
                  ) : null}

                  <div className={cn("space-y-2 pe-1 lg:max-h-[24rem] lg:overflow-auto", mobileListCollapsed && (oneForm ? "hidden" : "hidden lg:block"))}>
                    {filteredCustomers.map((customer) => {
                      const isSelected = customer.id === customerId;
                      return (
                        <button
                          key={customer.id}
                          type="button"
                          disabled={actionLocked}
                          onClick={() => {
                            if (customer.id !== customerId) {
                              setBranchId("");
                              if (customerAddressHelp(customer)) setAddressPromptFor(customer);
                            }
                            setCustomerId(customer.id);
                            setPickedCustomer(customer);
                            setEditingCustomer(false);
                            // On mobile, collapse the list so the compact detail card
                            // takes its place. No programmatic scroll — that was the
                            // source of the jumpy/broken behavior; the page just gets
                            // short on its own. lg keeps both columns visible (no collapse).
                            // One form folds it on every screen: the chosen customer is what's shown.
                            if (oneForm || (typeof window !== "undefined" && window.innerWidth < 1024)) {
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
                              <MetaRow
                                as="span"
                                className="mt-0.5 text-xs text-muted-foreground"
                                items={[customer.phone, customer.city]}
                              />
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

                    {/* The app's one empty look, with its obvious next step
                        (owner, 2026-10-11). */}
                    {filteredCustomers.length === 0 ? (
                      <EmptyState
                        dense
                        action={
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setCustomerTab("new")}
                            disabled={actionLocked}
                          >
                            <AddUserIcon className="h-4 w-4" /> הוספת לקוח חדש
                          </Button>
                        }
                      >
                        לא נמצאו לקוחות לחיפוש הזה.
                      </EmptyState>
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
                          <h3 className="text-lg font-semibold text-foreground">
                            {selectedCustomer.name}
                          </h3>
                          {selectedCustomer.contacts?.[0]?.full_name ? (
                            <p className="mt-0.5 text-sm text-muted-foreground">
                              {selectedCustomer.contacts[0].full_name}
                              {selectedCustomer.email ? ` · ${selectedCustomer.email}` : ""}
                            </p>
                          ) : selectedCustomer.email ? (
                            <p className="mt-0.5 text-sm text-muted-foreground">{selectedCustomer.email}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <Badge variant="success">נבחר</Badge>
                          {selectedCustomer.requiresPrepayment ? (
                            <Badge variant="warning">תשלום מראש</Badge>
                          ) : null}
                          {/* The app's one outline pencil (owner, 2026-10-11: it
                              was a filled sky square). Open, it closes the form
                              without saving — a grey ✕ then, like every cancel,
                              the same square so nothing shifts. */}
                          {editingCustomer ? (
                            <IconButton
                              icon={CloseIcon}
                              variant="muted"
                              label="סגירת העריכה"
                              onClick={() => setEditingCustomer(false)}
                              disabled={actionLocked}
                            />
                          ) : (
                            <EditButton
                              label="עריכת פרטי הלקוח"
                              onClick={() => setEditingCustomer(true)}
                              disabled={actionLocked}
                            />
                          )}
                        </div>
                      </div>

                      {/* Stays after the pop-up, while the customer's on the phone
                          (owner, 2026-10-15: "when you choose that customer, say
                          there's no address here … please add address"). */}
                      {!editingCustomer && customerAddressHelp(selectedCustomer) ? (
                        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground">
                          <WarningIcon className="h-4 w-4 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold">
                              {customerAddressHelp(selectedCustomer) === "not_found"
                                ? "הכתובת של הלקוח לא נמצאה ב-Google Maps"
                                : customerAddressHelp(selectedCustomer) === "no_city"
                                  ? "חסרה עיר ללקוח הזה"
                                  : "אין כתובת מלאה ללקוח הזה"}
                            </p>
                            <p>
                              {customerAddressHelp(selectedCustomer) === "no_city"
                                ? "בחרו לפחות את העיר מהרשימה."
                                : "אם ההזמנה למשלוח, בקשו מהלקוח רחוב ומספר בית ושמרו אותם."}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingCustomer(true)}
                            disabled={actionLocked}
                          >
                            הוספת כתובת
                          </Button>
                        </div>
                      ) : null}

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
                            {
                              label: "כתובת",
                              // A saved point with no address line is still somewhere to go.
                              value: omitUnknownPlace(selectedCustomer.address || selectedCustomer.city) || (selectedCustomer.pin ? "נקודה שמורה" : null),
                              ltr: false,
                              isAddress: true,
                            },
                            { label: "שם לחשבונית", value: selectedCustomer.nameForInvoice, ltr: false },
                            { label: "אופן תשלום", value: selectedCustomer.requiresPrepayment ? "תשלום מראש" : "רגיל", ltr: false },
                          ].map((row) => (
                            <p key={row.label} className="leading-5">
                              <span className="text-muted-foreground">{row.label}: </span>
                              {row.value ? (
                                row.isAddress ? (
                                  <AddressLink
                                    address={row.value}
                                    pin={selectedCustomer.pin ?? selectedCustomer.addressPoint ?? null}
                                    notFound={selectedCustomer.addressNotFound}
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

      {/* ------------------------------------------------------------------ BRANCH */}
      {show("branch") ? (
        <div className="space-y-4">
          <StepHeading compact={oneForm} title="לאיזה סניף?" sub={`ל${selectedCustomer?.name ?? "הלקוח"} יש סניפים — לאיזה מהם ההזמנה?`} />
          <div className="space-y-2">
            <OptionRow
              label="ראשי"
              sub={selectedCustomer?.address ?? undefined}
              selected={branchId === ""}
              onClick={() => {
                setBranchId("");
                advance("items");
              }}
            />
            {(selectedCustomer?.branches ?? []).map((branch) => (
              <OptionRow
                key={branch.id}
                label={branch.name}
                sub={branch.address ?? undefined}
                selected={branchId === branch.id}
                onClick={() => {
                  setBranchId(branch.id);
                  advance("items");
                }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ ITEMS */}
      {show("items") ? (
        <div className="space-y-4">
        <StepHeading compact={oneForm} title="אילו מוצרים?" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_24rem]">
          {/* Product picker — deliberately NOT wrapped in a Card. The products
              are cards themselves, and a card-in-a-card cost ~70px of width on a
              phone: the search box and every product card are that much wider. */}
          <div className="space-y-3">
              <div className="relative">
                {/* On the start side, as every search (owner, 2026-10-11). */}
                <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  placeholder="חיפוש..."
                  aria-label="חיפוש מוצר"
                  data-no-enter-next
                  className="ps-9"
                />
              </div>
              {productSearchLoading ? <p className="text-xs text-muted-foreground">מחפש מוצרים...</p> : null}

              {/* One form: the catalog scrolls in its own box on a phone too, so the
                  sections after it aren't a long scroll away. */}
              <div
                className={
                  oneForm
                    ? "max-h-[22rem] overflow-auto overscroll-contain lg:max-h-[28rem]"
                    : "lg:max-h-[28rem] lg:overflow-auto"
                }
              >
                {/* Up to three across, none narrower than 6.5rem (rem, so a bigger
                    text size means fewer, wider cards): three fixed columns were
                    137px wide at the biggest size and a name was cut inside them. */}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(max(6.5rem,calc((100%-1rem)/3)),1fr))] gap-2">
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
                            <div className="min-w-0 line-clamp-3 text-sm font-semibold leading-5">
                              {product.name}
                            </div>
                            {selected ? (
                              <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[0.647rem] font-semibold text-primary-foreground">
                                {selected.line.quantity_ordered}
                              </span>
                            ) : null}
                          </div>

                          <div className="min-w-0 space-y-0.5 text-xs text-muted-foreground">
                            {product.code ? <div>מק״ט: {product.code}</div> : null}
                            {product.stock !== null ? <div>מלאי: {product.stock}</div> : null}
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
                {filteredProducts.length === 0 ? <EmptyState dense>לא נמצאו מוצרים.</EmptyState> : null}
              </div>
          </div>

          {/* Order items cart — fills its grid cell so its height matches the product picker; the product column stays its natural size and the cart scrolls once it reaches that height */}
          {/* One form on a phone: the order's own lines first, the catalog under them. */}
          <div className={cn(lines.length > 0 && "lg:relative", oneForm && "order-first lg:order-none")}>
            <div className={cn(lines.length > 0 && "lg:absolute lg:inset-0")}>
            {/* Above the cart card, not inside it — adding a free line is an
                action on the cart, not one of its rows. */}
            {/* An add button, less important than the step's own move: the
                soft style (owner, 2026-10-11). */}
            <div className="mb-3 lg:shrink-0">
              <Button
                type="button"
                size="sm"
                variant="soft"
                onClick={addCustomLine}
                disabled={actionLocked}
                className="w-full sm:w-auto"
              >
                <AddIcon /> שורה חופשית
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
            {/* A section header: its icon grey and its count the grey pill, as
                on every page (owner, 2026-10-11). */}
            <div className="flex flex-row items-center justify-between gap-2 lg:shrink-0">
              <h3 className="flex items-center gap-2 text-base font-semibold">
                <OrderIcon className={SECTION_ICON_CLASS} /> פריטי הזמנה
              </h3>
              <SectionCount count={totalUnits} />
            </div>
            <div className={cn("space-y-3", lines.length > 0 && "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col")}>
              {lines.length === 0 ? (
                <EmptyState dense>עדיין לא נוספו מוצרים. הקליקו על מוצר כדי להוסיף.</EmptyState>
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
                            <p className="min-w-0 text-sm font-medium text-foreground">{line.product_name}</p>
                          )}
                          <span className="shrink-0 text-sm font-semibold text-foreground">{formatCurrency(lineTotal)}</span>
                        </div>
                        {shortfall ? (
                          <p className="text-xs font-medium text-destructive-soft-foreground">
                            חסר במלאי — במלאי {available}, הוזמנו {line.quantity_ordered}
                          </p>
                        ) : null}
                        <div className="flex items-center justify-between gap-2">
                          {/* 28px to look at, 44px to tap: the ::before reaches
                              8px past each edge, as the call button does
                              (contact-link.tsx; owner, 2026-10-11). */}
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              className="relative flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 transition before:absolute before:-inset-2 before:content-[''] hover:bg-muted disabled:opacity-50"
                              onClick={() => decrementLine(index)}
                              disabled={actionLocked || line.quantity_ordered <= 1}
                              aria-label={`הפחתת כמות של ${line.product_name}`}
                            >
                              <RemoveIcon className="h-3.5 w-3.5" />
                            </button>
                            <span className="min-w-8 text-center text-sm font-semibold">{line.quantity_ordered}</span>
                            <button
                              type="button"
                              className="relative flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 transition before:absolute before:-inset-2 before:content-[''] hover:bg-muted"
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
                                <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-input bg-background">
                                  <button
                                    type="button"
                                    aria-pressed={mode === "percent"}
                                    onClick={() => setLineDiscountModes((prev) => ({ ...prev, [line.product_id]: "percent" }))}
                                    className={cn(
                                      "px-2 text-xs font-medium transition-colors",
                                      mode === "percent" ? TOGGLE_ON : TOGGLE_OFF
                                    )}
                                  >
                                    %
                                  </button>
                                  <button
                                    type="button"
                                    aria-pressed={mode === "amount"}
                                    onClick={() => setLineDiscountModes((prev) => ({ ...prev, [line.product_id]: "amount" }))}
                                    className={cn(
                                      "px-2 text-xs font-medium transition-colors",
                                      mode === "amount" ? TOGGLE_ON : TOGGLE_OFF
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
                      <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-input bg-background">
                        <button
                          type="button"
                          aria-pressed={orderDiscountMode === "percent"}
                          onClick={() => setOrderDiscountMode("percent")}
                          className={cn(
                            "px-2.5 text-xs font-medium transition-colors",
                            orderDiscountMode === "percent" ? TOGGLE_ON : TOGGLE_OFF
                          )}
                        >
                          %
                        </button>
                        <button
                          type="button"
                          aria-pressed={orderDiscountMode === "amount"}
                          onClick={() => setOrderDiscountMode("amount")}
                          className={cn(
                            "px-2.5 text-xs font-medium transition-colors",
                            orderDiscountMode === "amount" ? TOGGLE_ON : TOGGLE_OFF
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
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- INVOICE */}
      {show("invoice") ? (
        <>
          <StepHeading compact={oneForm} title="צריך חשבונית?" />
          <div className="grid grid-cols-2 gap-2">
            <OptionRow
              label="צריך חשבונית"
              selected={needsInvoice}
              onClick={() => {
                setNeedsInvoice(true);
                advance("collection");
              }}
            />
            <OptionRow
              label="לא צריך חשבונית"
              selected={!needsInvoice}
              onClick={() => {
                setNeedsInvoice(false);
                advance("collection");
              }}
            />
          </div>
        </>
      ) : null}
      {show("collection") ? (
        <>
          <StepHeading compact={oneForm} title="איך נגבה התשלום?" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <OptionRow
              label="תשלום למשרד"
              selected={!collectOnDelivery}
              onClick={() => {
                setCollectOnDelivery(false);
                advance("paymentTerms");
              }}
            />
            <OptionRow
              label="הנהג גובה תשלום במסירה"
              selected={collectOnDelivery}
              onClick={() => {
                setCollectOnDelivery(true);
                advance("paymentTerms");
              }}
            />
          </div>
        </>
      ) : null}
      {show("paymentTerms") ? (
        <>
          <StepHeading compact={oneForm} title="מהי צורת התשלום?" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PAYMENT_TERMS_OPTIONS.map((option) => (
              <OptionRow
                key={option.value}
                label={option.label}
                selected={paymentTerms === option.value}
                onClick={() => {
                  applyPaymentTerms(option.value);
                  advance(option.value === "immediate" ? "payments" : "dueDate");
                }}
              />
            ))}
          </div>
        </>
      ) : null}
      {show("dueDate") ? (
        <>
          <StepHeading compact={oneForm} title="תאריך פירעון?" />
          <DateInput value={dueDate} onChange={(e) => setDueDate(e.target.value)} placeholder="מחושב מצורת התשלום" />
        </>
      ) : null}
      {show("payments") ? (
        <>
          <StepHeading compact={oneForm} title="תשלומים" sub="אפשר לפצל לכמה תשלומים ובכמה אמצעים שונים" />
          <div className="space-y-4">
            {/* "+ תשלום" in the soft style (dashed outline), the order page's button too (owner,
                2026-10-11: it was a filled sky button here). */}
            <div className="flex justify-end">
              <Button type="button" variant="soft" size="sm" onClick={addPaymentDraft} disabled={actionLocked}>
                <AddIcon /> תשלום
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
                        <div>{formatShortDate(payment.payment_date)}</div>
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
                        <div>{payment.reference_number || "—"}</div>
                      </div>
                    </div>
                    <Field label="הערות">
                      <Input
                        value={existingPaymentNotes[payment.id] ?? ""}
                        disabled={actionLocked}
                        onChange={(e) =>
                          setExistingPaymentNotes((prev) => ({ ...prev, [payment.id]: e.target.value }))
                        }
                        placeholder="אופציונלי"
                      />
                    </Field>
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

                {/* Field, the size of the payment dialogs' (owner, 2026-10-11:
                    these were small grey labels here), the required ones with
                    its red "*". */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="סכום" required>
                    <CurrencyInput
                      type="number"
                      min="0"
                      step="0.01"
                      value={payment.amount_total}
                      disabled={actionLocked}
                      onChange={(e) => updatePaymentDraft(index, { amount_total: e.target.value })}
                      placeholder="0.00"
                    />
                  </Field>
                  <Field label="תאריך" required>
                    <DateInput
                      value={payment.payment_date}
                      disabled={actionLocked}
                      onChange={(e) => updatePaymentDraft(index, { payment_date: e.target.value })}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="אמצעי תשלום" required>
                    <NativeSelect
                      value={payment.payment_method}
                      disabled={actionLocked}
                      onChange={(e) => {
                        const m = e.target.value;
                        updatePaymentDraft(index, {
                          payment_method: m,
                          account_id: payment.account_id || defaultAccountForMethod(paymentAccountsList, m),
                          due_date: payment.due_date,
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
                  </Field>
                  <AccountSelect
                    required
                    value={payment.account_id}
                    disabled={actionLocked}
                    onChange={(accountId) => updatePaymentDraft(index, { account_id: accountId })}
                    onLoaded={(list) => {
                      setPaymentAccountsList(list);
                      // The payment as it is NOW: the picker calls this once, with
                      // the callback from its first render — a method chosen while
                      // the accounts loaded never got its account, and the save was
                      // refused (found by the tests, 2026-10-11).
                      setNewPayments((prev) =>
                        prev.map((draft, i) =>
                          i === index && !draft.account_id
                            ? { ...draft, account_id: defaultAccountForMethod(list, draft.payment_method) }
                            : draft
                        )
                      );
                    }}
                  />
                  {payment.payment_method === "credit_card" ? (
                    <CardInstallmentsField
                      value={payment.installments ?? "1"}
                      onChange={(value) => updatePaymentDraft(index, { installments: value })}
                      amount={Number(payment.amount_total) || 0}
                      paymentDate={payment.payment_date}
                      disabled={actionLocked}
                    />
                  ) : (
                  <Field
                    label={payment.payment_method === "check" ? "תאריך פירעון" : "תאריך פירעון צפוי (אופציונלי)"}
                    required={payment.payment_method === "check"}
                  >
                    <DateInput
                      value={payment.due_date}
                      disabled={actionLocked}
                      onChange={(e) => updatePaymentDraft(index, { due_date: e.target.value })}
                    />
                    {payment.payment_method !== "check" ? (
                      <p className="text-[0.647rem] text-muted-foreground">
                        לתשלומים עתידיים (למשל שוטף+30) — נרשמים כממתינים עד התאריך הזה.
                      </p>
                    ) : null}
                  </Field>
                  )}
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
                    <Field label="מספר אסמכתא">
                      <Input
                        value={payment.reference_number}
                        disabled={actionLocked}
                        onChange={(e) => updatePaymentDraft(index, { reference_number: e.target.value })}
                        placeholder="אופציונלי"
                      />
                    </Field>
                    <Field label="הערות לתשלום">
                      <Input
                        value={payment.notes}
                        disabled={actionLocked}
                        onChange={(e) => updatePaymentDraft(index, { notes: e.target.value })}
                        placeholder="אופציונלי"
                      />
                    </Field>
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
        </>
      ) : null}
      {show("orderDate") ? (
        <>
          <StepHeading compact={oneForm} title="מתי בוצעה ההזמנה?" />
          <DateInput value={orderDate} onChange={(e) => applyOrderDate(e.target.value)} placeholder="בחר תאריך הזמנה" />
        </>
      ) : null}
      {show("orderStatus") ? (
        <>
          <StepHeading compact={oneForm} title="מה סטטוס ההזמנה?" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {/* An order already in another status (an old one, edited) keeps
                it on offer, so editing never changes it unasked. */}
            {(ORDER_STATUS_OPTIONS.some((o) => o.value === orderStatus) || !orderStatus
              ? ORDER_STATUS_OPTIONS
              : [...ORDER_STATUS_OPTIONS, { value: orderStatus, label: getOrderStatusLabel(orderStatus) }]
            ).map((option) => (
              <OptionRow
                key={option.value}
                label={option.label}
                selected={orderStatus === option.value}
                onClick={() => {
                  setOrderStatus(option.value);
                  advance("deliveryDate");
                }}
              />
            ))}
          </div>
        </>
      ) : null}
      {show("deliveryDate") ? (
        <>
          <StepHeading compact={oneForm} title="תאריך אספקה מבוקש?" sub="רק אם הלקוח ביקש תאריך מסוים — לא חובה" />
          <DateInput
            value={requestedDeliveryDate}
            onChange={(e) => setRequestedDeliveryDate(e.target.value)}
            disabled={actionLocked}
          />
        </>
      ) : null}
      {show("notes") ? (
        <>
          <StepHeading compact={oneForm} title="הערות להזמנה?" sub="לא חובה" />
          <div className="relative">
            <Textarea
              value={notes}
              disabled={actionLocked}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              autoFocus={!oneForm}
              className="pe-11"
            />
            <DictateButton
              onTranscript={(text) => setNotes((prev) => appendDictatedText(prev, text))}
              disabled={actionLocked}
              className="absolute bottom-1 end-1 h-8 w-8"
            />
          </div>
        </>
      ) : null}

      {/* -------------------------------------------------------------- SUMMARY */}
      {step === "summary" ? (
        <div className="space-y-4">
          <StepHeading title="לאשר ולשמור?" />
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
              onEdit={() => goToStep("customer")}
              editDisabled={actionLocked}
            >
                {/* A missing value is "—", as everywhere (owner, 2026-10-11). */}
                <SummaryRow label="שם" value={selectedCustomer?.name || "—"} />
                {branchId && selectedCustomer?.branches?.find((b) => b.id === branchId) ? (
                  <SummaryRow label="סניף" value={selectedCustomer.branches.find((b) => b.id === branchId)!.name} />
                ) : null}
                {selectedCustomer?.contacts?.[0]?.full_name ? (
                  <SummaryRow label="איש קשר" value={selectedCustomer.contacts[0].full_name} />
                ) : null}
                <SummaryRow label="טלפון" value={selectedCustomer?.phone || "—"} />
                {selectedCustomer?.email ? <SummaryRow label="אימייל" value={selectedCustomer.email} /> : null}
                <SummaryRow
                  label={orderBranch?.address?.trim() ? "כתובת הסניף" : "כתובת"}
                  value={
                    orderAddress ? (
                      <AddressLink address={orderAddress} city={orderAddressCity} pin={orderPin} notFound={orderAddressNotFound} className="inline-flex items-center gap-1">
                        <WazeIcon className="h-3.5 w-3.5 shrink-0" />
                        {plainAddress({ address: orderAddress, city: orderAddressCity }) || orderAddress}
                      </AddressLink>
                    ) : (
                      "—"
                    )
                  }
                />
                {selectedCustomer &&
                (orderBranch?.address?.trim()
                  ? addressQuality({ address: orderAddress, city: orderAddressCity }) !== "clear"
                  : customerAddressHelp(selectedCustomer)) ? (
                  <p className="flex items-center gap-1.5 text-xs text-warning-soft-foreground">
                    <WarningIcon className="h-3.5 w-3.5 shrink-0" />
                    אין כתובת מלאה: במשלוח Waze לא יוכל לנווט.
                  </p>
                ) : null}
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
              onEdit={() => goToStep("items")}
              editDisabled={actionLocked}
            >
                {lines.map((line, index) => {
                  const lineTotal = line.quantity_ordered * line.unit_price - line.discount_amount;
                  const available = availableByProductId.get(line.product_id);
                  const shortfall = typeof available === "number" && line.quantity_ordered > available;
                  return (
                    <SummaryRow
                      key={`${line.product_id}-${index}`}
                      label={
                        <span>
                          {/* "×2", the order page's way (owner, 2026-10-11). */}
                          {`×${line.quantity_ordered} ${line.product_name}`}
                          {shortfall ? (
                            <span className="mt-0.5 block text-xs font-medium text-destructive-soft-foreground">
                              חסר במלאי — במלאי {available}
                            </span>
                          ) : null}
                        </span>
                      }
                      value={formatCurrency(lineTotal)}
                    />
                  );
                })}
                {hasStockShortfall ? (
                  <div className="flex items-start gap-1.5 border-t border-border/70 bg-destructive-soft/60 px-3 py-2 text-xs text-destructive-soft-foreground">
                    <WarningIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>יש חוסר במלאי בהזמנה זו. אפשר לשמור בכל זאת — ההזמנה תסומן כחוסר במלאי.</span>
                  </div>
                ) : null}
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
            {/* Order details — now real steps of their own (orderDate/orderStatus/
                deliveryDate/notes), so this is read-only like every other summary
                section here, not live-editable in place as it used to be. */}
            <SummarySection
              icon={<DocumentIcon className="h-4 w-4" />}
              title="פרטי הזמנה"
              onEdit={() => goToStep("orderDate")}
              editDisabled={actionLocked}
            >
                <SummaryRow label="תאריך הזמנה" value={orderDate} />
                <SummaryRow label="סטטוס הזמנה" value={ORDER_STATUS_OPTIONS.find((o) => o.value === orderStatus)?.label ?? getOrderStatusLabel(orderStatus)} />
                {requestedDeliveryDate ? <SummaryRow label="תאריך אספקה מבוקש" value={requestedDeliveryDate} /> : null}
                {notes.trim() ? <SummaryRow label="הערות" value={notes.trim()} /> : null}
            </SummarySection>

            {/* Payment summary — read-only; edit jumps back to the payment step */}
            <SummarySection
              icon={<CardIcon className="h-4 w-4" />}
              title="תשלום"
              onEdit={() => goToStep("invoice")}
              editDisabled={actionLocked}
            >
                <SummaryRow label="חשבונית" value={needsInvoice ? "צריך חשבונית" : "לא צריך חשבונית"} />
                <SummaryRow label="גבייה" value={collectOnDelivery ? "הנהג גובה תשלום במסירה" : "תשלום למשרד"} />
                <SummaryRow label="צורת תשלום" value={termsLabel(paymentTerms)} />
                {paymentTerms !== "immediate" ? <SummaryRow label="תאריך פירעון" value={dueDate || "—"} /> : null}
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
      {submitError && !oneForm && step !== "summary" ? <p className="text-sm text-destructive">{submitError}</p> : null}
      </StepWizard>
    </>
  );
}
