import { readyDeviceSaves } from "@/lib/powersync/store";
import {
  addExpenseOnDevice,
  addIncomeOnDevice,
  deleteRowOnDevice,
  setLedgerCheckOnDevice,
  type RegisterTable,
  type SentKind,
} from "@/lib/powersync/local-writes";
import { expenseDomainFrom, expenseFieldsFrom, expenseRowFrom, type ExpenseBody } from "@/lib/expenses/expense-input";
import { paymentFieldsFrom, paymentRowFrom, type PaymentBody } from "@/lib/payments/payment-input";
import { mapProjectTypeToExpenseDomain, type ExpenseBusinessDomain } from "@/lib/expenses";
import { currencyPricingAt, type MoneyCurrencyBody } from "@/lib/fx/money-input";
import { normalizeVatRate } from "@/lib/settings/vat";
import type { AccountDeleteRef } from "@/lib/accounts";

// The accounts page's saves on the phone first (owner, 2026-10-27: "go on with
// the offline saves for the accounts page"): the quick line's expenses and
// income, the "נבדק מול הבנק" ticks, and a register row of any kind deleted
// are written into the device copy — the balances and the register, drawn
// from it, show them at once, with no connection too — and go to the server
// in the background through the same routes (lib/powersync/local-writes.ts).
// For the people whose accounts page is drawn from the copy (LocalBankPage);
// null for everyone else and while the copy isn't ready — they save on the
// server as before.

type Db = NonNullable<ReturnType<typeof readyDeviceSaves>>["db"];

/** A register row to delete, as the register knows it (a transfer: by its id). */
export type DeviceDeleteRef = AccountDeleteRef | { kind: "transfer"; id: string };

export type DeviceBankSaves = {
  /**
   * The quick line's expense, from its request. `rate`: the rate the line
   * shows, for US$ / C$. Its id — or null when the phone doesn't have what
   * it's linked to (save on the server). Throws the reason it isn't valid.
   */
  addExpense: (body: ExpenseBody & MoneyCurrencyBody, rate: number | null) => Promise<string | null>;
  /** The quick line's income, the same way. */
  addIncome: (body: PaymentBody & MoneyCurrencyBody, rate: number | null) => Promise<string | null>;
  /** A register line ticked or unticked; `amount` signed (in +, out −), `date` its day. */
  setCheck: (check: { accountId: string; entryKey: string; amount: number; date: string; checked: boolean }) => Promise<void>;
  /** A register row deleted; false when the phone doesn't have it (delete on the server). */
  deleteRow: (ref: DeviceDeleteRef) => Promise<boolean>;
};

/** Is what the row is linked to on the phone — and a project's type, for its domain. */
async function linkOnDevice(
  db: Db,
  link: { projectId: string; orderId: string; propertyId: string }
): Promise<{ found: false } | { found: true; projectType: string | null }> {
  const [table, id] = link.projectId
    ? ["projects", link.projectId]
    : link.orderId
      ? ["orders", link.orderId]
      : link.propertyId
        ? ["properties", link.propertyId]
        : [null, ""];
  if (!table) return { found: true, projectType: null };
  const row = await db.getOptional<{ project_type?: string | null }>(
    table === "projects" ? "SELECT project_type FROM projects WHERE id = ?" : `SELECT id FROM ${table} WHERE id = ?`,
    [id]
  );
  return row ? { found: true, projectType: row.project_type ?? null } : { found: false };
}

/** What deleting a register row is on the phone: its table, its request, and what goes with it. */
function removalFor(ref: DeviceDeleteRef): Parameters<typeof deleteRowOnDevice>[1] {
  const removal = (table: RegisterTable, kind: SentKind, body: Record<string, unknown>) => ({ table, id: ref.id, kind, body });
  switch (ref.kind) {
    case "payment":
      return ref.orderId
        ? removal("payments", "order-payment-delete", { id: ref.id, order_id: ref.orderId })
        : removal("payments", "payment-delete", { id: ref.id, project_id: ref.projectId || undefined });
    case "expense":
      return {
        ...removal("expenses", "expense-delete", {
          id: ref.id,
          project_id: ref.projectId || undefined,
          order_id: ref.orderId || undefined,
          property_id: ref.propertyId || undefined,
        }),
        alsoDelete: { table: "project_expenses", column: "expense_id" },
      };
    case "worker_payment":
      return removal("worker_payments", "worker-payment-delete", { payment_id: ref.id, user_id: ref.userId || undefined });
    case "loan":
      // Its repayments go with it (the database's cascade).
      return {
        ...removal("loans", "loan-delete", { kind: "loan", id: ref.id }),
        alsoDelete: { table: "loan_repayments", column: "loan_id" },
      };
    case "loan_repayment":
      return removal("loan_repayments", "repayment-delete", { kind: "loan_repayment", id: ref.id, loan_id: ref.loanId });
    case "card_charge":
      return removal("card_statement_charges", "card-charge-delete", { kind: "card_charge", id: ref.id });
    case "transfer":
      return removal("account_transfers", "transfer-delete", { kind: "transfer", id: ref.id });
  }
}

export function deviceBankSaves(): DeviceBankSaves | null {
  const ready = readyDeviceSaves("bank");
  if (!ready) return null;
  const { db, viewerId } = ready;
  return {
    async addExpense(body, rate) {
      const fields = expenseFieldsFrom(body);
      if ("error" in fields) throw new Error(fields.error);
      const link = await linkOnDevice(db, fields);
      if (!link.found) return null;
      const domain = expenseDomainFrom(
        fields.businessDomain || (fields.projectId ? mapProjectTypeToExpenseDomain(link.projectType) : ""),
        fields
      );
      if ("error" in domain) throw new Error(domain.error);
      const pricing = currencyPricingAt(body, { amount: fields.amount, rate });
      if ("error" in pricing) throw new Error(pricing.error);
      const id = crypto.randomUUID();
      await addExpenseOnDevice(db, {
        id,
        row: expenseRowFrom(fields, { businessDomain: domain.domain, recordedBy: viewerId, pricing }),
        link: fields.projectId
          ? {
              project_id: fields.projectId,
              included_in_base_price: fields.includedInBasePrice,
              billed_to_customer: fields.billedToCustomer,
              notes: fields.projectExpenseNotes,
            }
          : null,
        body: body as Record<string, unknown>,
      });
      return id;
    },
    async addIncome(body, rate) {
      const typed = paymentFieldsFrom(body);
      if ("error" in typed) throw new Error(typed.error);
      const pricing = currencyPricingAt(body, { amount: typed.amount, rate });
      if ("error" in pricing) throw new Error(pricing.error);
      const fields = { ...typed, amount: pricing.toShekels(typed.amount) };
      const link = await linkOnDevice(db, fields);
      if (!link.found) return null;
      // As the route works it out when the form doesn't say.
      const businessDomain: ExpenseBusinessDomain | null =
        fields.businessDomain ??
        (fields.projectId
          ? mapProjectTypeToExpenseDomain(link.projectType)
          : fields.orderId
            ? "sales"
            : fields.propertyId
              ? "property_management"
              : null);
      if (!businessDomain) throw new Error("Missing or invalid business_domain");
      const settings = fields.requiresSplit
        ? await db.getOptional<{ vat_rate: unknown }>("SELECT vat_rate FROM business_settings LIMIT 1")
        : null;
      const id = crypto.randomUUID();
      await addIncomeOnDevice(db, {
        id,
        row: {
          ...paymentRowFrom(fields, {
            businessDomain,
            vatRate: fields.requiresSplit ? normalizeVatRate(settings?.vat_rate) : undefined,
            recordedBy: viewerId,
          }),
          ...(pricing.columns ?? {}),
        },
        body: body as Record<string, unknown>,
      });
      return id;
    },
    setCheck: (check) => setLedgerCheckOnDevice(db, { ...check, userId: viewerId }),
    deleteRow: (ref) => deleteRowOnDevice(db, removalFor(ref)),
  };
}
