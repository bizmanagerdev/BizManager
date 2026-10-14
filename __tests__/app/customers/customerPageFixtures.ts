import {
  summarizeCustomerMoney,
  type CustomerDocumentsResult,
  type CustomerHistory,
  type CustomerOrderRow,
  type CustomerPageTop,
  type CustomerPaymentRow,
  type CustomerPaymentsResult,
  type CustomerProfile,
  type CustomerProjectRow,
} from "@/app/(app)/customers/[id]/customerPageModel";

// Fixtures for the customer page's tests: the server's reading of one customer
// (CustomerPageTop) and the parts that come after the page, as already-settled
// promises — React reads a settled one at once, as it does the server's stream.

/** A promise React's use() reads without suspending (the server stream's own kind). */
export function settled<T>(value: T): Promise<T> {
  return Object.assign(Promise.resolve(value), { status: "fulfilled", value });
}

export const CUSTOMER: CustomerProfile = {
  id: "c1",
  name: "חברת אלון",
  invoiceName: null,
  registrationNumber: null,
  phone: "050-1234567",
  whatsapp: null,
  email: "office@alon.co.il",
  address: "הרצל 5, חיפה",
  deliveryInstructions: null,
  deliveryPin: null,
  notes: null,
  active: true,
  requiresPrepayment: false,
  linkedUserId: null,
  morningClientId: null,
  morningMatchStatus: null,
  morningSyncedAt: null,
  morningLastSyncError: null,
};

export function order(id: string, overrides: Partial<CustomerOrderRow> = {}): CustomerOrderRow {
  return {
    id,
    date: "2026-09-01",
    status: "delivered",
    total: 1000,
    collected: 1000,
    pending: 0,
    overdue: 0,
    remaining: 0,
    paymentCount: 1,
    ...overrides,
  };
}

export function project(id: string, overrides: Partial<CustomerProjectRow> = {}): CustomerProjectRow {
  return {
    id,
    name: `פרויקט ${id}`,
    status: "active",
    startDate: "2026-08-01",
    totalPrice: 5000,
    collected: 5000,
    pending: 0,
    overdue: 0,
    ...overrides,
  };
}

export function paymentRow(id: string, overrides: Partial<CustomerPaymentRow> = {}): CustomerPaymentRow {
  return {
    id,
    date: "2026-09-10",
    method: "bank_transfer",
    status: "cleared",
    dueDate: null,
    checkNumber: null,
    amount: 100,
    source: { type: "order", id: "o1", label: "" },
    ...overrides,
  };
}

export function makeTop(
  overrides: Omit<Partial<CustomerPageTop>, "customer"> & { customer?: Partial<CustomerProfile> } = {}
): CustomerPageTop {
  const { customer, ...rest } = overrides;
  const orders = rest.orders ?? [];
  const projects = rest.projects ?? [];
  const receivables = rest.collection?.receivables ?? [];
  return {
    orders,
    projects,
    leases: [],
    money: summarizeCustomerMoney({ orders, projects, receivables }),
    balance: null,
    linkedWorker: null,
    contacts: [],
    branches: [],
    tags: [],
    morningDocuments: [],
    tasks: [],
    taskUsers: [{ id: "u1", label: "דנה", color: null }],
    collection: { logs: [], reminders: [], receivables },
    promises: [],
    errors: { orders: null, projects: null },
    ...rest,
    customer: { ...CUSTOMER, ...customer },
  };
}

export const NO_PAYMENTS: CustomerPaymentsResult = { payments: [], lastPaymentAt: null, error: null };
export const NO_DOCUMENTS: CustomerDocumentsResult = { documents: [], total: 0, error: null };
export const NO_HISTORY: CustomerHistory = { items: [], error: null };
