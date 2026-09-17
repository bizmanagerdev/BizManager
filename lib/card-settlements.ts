// Has a credit-card clearing deposit (Grow) actually landed?
//
// A deposit is a batch: every card payment that lands in one account on one
// settlement date (see cardSettlementDate — the 10th of the next month). The
// user confirms it on צפי תזרים; until then it has not arrived, however far
// past its date it is. The confirmation is its own
// record (card_settlement_confirmations) rather than the payments' status —
// a card payment is `cleared` because the customer has paid, which is a
// different event from the clearing company depositing the month's total.
//
// Everything that decides whether a batch has arrived reads it through here:
// the account register (lib/accounts.ts) and the board (lib/receivables-*).
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextMonthTenth } from "@/lib/payments";

/**
 * The day a card payment reaches the bank. Every card payment taken in a month
 * is deposited together on the 10th of the next month — whether or not anyone
 * filled in a due date, so older payments follow the same rule. A due date
 * set LATER than that is kept (the user said it lands later); an earlier or
 * stale one is not, since card money never lands before the month's deposit.
 *
 * Null for anything that is not an incoming card payment: a refund leaves on
 * its own day, and every other method keeps its own dating.
 */
export function cardSettlementDate(row: {
  paymentMethod: string | null | undefined;
  paymentDate: string | null | undefined;
  dueDate: string | null | undefined;
  amount: number;
}): string | null {
  if ((row.paymentMethod ?? "").trim().toLowerCase() !== "credit_card") return null;
  if (!(row.amount > 0)) return null;
  const paid = (row.paymentDate ?? "").slice(0, 10);
  const tenth = nextMonthTenth(paid);
  if (!tenth) return null;
  const due = (row.dueDate ?? "").slice(0, 10);
  return due && due > tenth ? due : tenth;
}

/**
 * The earliest payment_date whose card payments can land on or after `iso`:
 * the first of the previous month. A scan windowed on dates must reach back
 * this far, or last month's card payments — due in this window — are missed.
 */
export function cardScanSince(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return iso;
  let year = Number(m[1]);
  let month = Number(m[2]) - 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** How a batch is identified everywhere: its account and its settlement day. */
export function settlementKey(accountId: string | null | undefined, settlementDate: string): string {
  return `${accountId ?? ""}|${settlementDate.slice(0, 10)}`;
}

/** The Grow row in קבועות, as stored in outflow_source_settings. */
export const SETTLEMENT_SOURCE = { kind: "settlement", key: "grow" } as const;

export type SettlementConfirmations = {
  /**
   * False when the table isn't there yet (the migration hasn't been run). The
   * app then keeps its old behaviour — a batch counts as arrived on its date —
   * so nothing disappears before the migration, and nothing breaks.
   */
  available: boolean;
  confirmed: ReadonlySet<string>;
  /**
   * The account every card deposit lands in, chosen on the Grow row in קבועות.
   * When set it wins over each payment's own account (see settlementAccountFor).
   */
  depositAccountId?: string | null;
};

export const NO_CONFIRMATIONS: SettlementConfirmations = { available: false, confirmed: new Set() };

/** Which account a card payment's deposit lands in: the Grow row's, else the payment's own. */
export function settlementAccountFor(
  paymentAccountId: string | null | undefined,
  confirmations: SettlementConfirmations
): string | null {
  return confirmations.depositAccountId || paymentAccountId || null;
}

/** Pure: has this batch arrived? */
export function isSettlementArrived(
  batch: { accountId: string | null; settlementDate: string },
  confirmations: SettlementConfirmations,
  todayIso: string
): boolean {
  // No table yet, or a payment with no account (older rows) — there is nothing
  // to confirm against, so it counts as arrived on its day.
  if (!confirmations.available || !batch.accountId) return batch.settlementDate.slice(0, 10) <= todayIso;
  return confirmations.confirmed.has(settlementKey(batch.accountId, batch.settlementDate));
}

/** The account chosen on the Grow row, or null (none chosen / unreadable). */
export async function loadSettlementAccountId(supabase: SupabaseClient): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("outflow_source_settings")
      .select("account_id")
      .eq("source_kind", SETTLEMENT_SOURCE.kind)
      .eq("source_key", SETTLEMENT_SOURCE.key)
      .limit(1);
    if (error) return null;
    const id = ((data ?? []) as Array<{ account_id?: unknown }>)[0]?.account_id;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

/**
 * Every confirmed deposit, plus the account deposits land in. Best-effort: an
 * unreadable confirmations table falls back to the date rule.
 */
export async function loadSettlementConfirmations(supabase: SupabaseClient): Promise<SettlementConfirmations> {
  const [depositAccountId, confirmations] = await Promise.all([
    loadSettlementAccountId(supabase),
    (async (): Promise<SettlementConfirmations> => {
      try {
        const { data, error } = await supabase
          .from("card_settlement_confirmations")
          .select("account_id,settlement_date");
        // Not migrated yet, or unreadable for any other reason: fall back to the
        // date rule. Failing the other way would make every deposit vanish from
        // its account, which is worse than showing one a little early.
        if (error) return NO_CONFIRMATIONS;
        const confirmed = new Set<string>();
        for (const row of (data ?? []) as Array<{ account_id?: string | null; settlement_date?: string | null }>) {
          if (row.settlement_date) confirmed.add(settlementKey(row.account_id, row.settlement_date));
        }
        return { available: true, confirmed };
      } catch {
        return NO_CONFIRMATIONS;
      }
    })(),
  ]);
  return { ...confirmations, depositAccountId };
}

/** A card payment as depositDaysToConfirm needs it. */
export type CardPaymentAccountRow = {
  accountId: string | null;
  paymentDate: string | null;
  dueDate: string | null;
  amount: number;
};

/**
 * Choosing (or changing) the Grow row's account re-files every deposit under
 * that account, and a confirmation is kept per account. So that a deposit that
 * had already arrived doesn't turn up late in its new account, this returns
 * the deposit days to confirm there: every day on which all the deposits, as
 * they were filed before the change, had arrived. Pure.
 */
export function depositDaysToConfirm({
  payments,
  confirmations,
  todayIso,
}: {
  payments: CardPaymentAccountRow[];
  /** As loaded BEFORE the change — depositAccountId is the previous choice. */
  confirmations: SettlementConfirmations;
  todayIso: string;
}): string[] {
  const arrivedByDay = new Map<string, boolean>();
  for (const p of payments) {
    const day = cardSettlementDate({ paymentMethod: "credit_card", paymentDate: p.paymentDate, dueDate: p.dueDate, amount: p.amount });
    if (!day) continue;
    const arrived = isSettlementArrived(
      { accountId: settlementAccountFor(p.accountId, confirmations), settlementDate: day },
      confirmations,
      todayIso
    );
    arrivedByDay.set(day, (arrivedByDay.get(day) ?? true) && arrived);
  }
  return [...arrivedByDay.entries()].filter(([, arrived]) => arrived).map(([day]) => day).sort();
}

/** One card payment inside a deposit, as a person reads it. */
export type SettlementPayment = {
  id: string;
  /** The day the customer paid. */
  date: string;
  amount: number;
  /** Who it was from: the customer's name, else the payment's note. */
  label: string;
};

type RawCardPayment = {
  id: string;
  paymentDate: string;
  amount: number;
  orderId: string | null;
  projectId: string | null;
  notes: string | null;
};

/**
 * Put a customer's name on each card payment. A card payment is attached to an
 * order or a project, and the customer lives on that — so this reads the
 * orders/projects it needs, then the customers, in three small `in()` reads.
 * Best-effort: without names every row still shows its note or "תקבול אשראי".
 */
export async function labelSettlementPayments(
  supabase: SupabaseClient,
  rows: RawCardPayment[]
): Promise<SettlementPayment[]> {
  const orderIds = Array.from(new Set(rows.map((r) => r.orderId).filter((v): v is string => Boolean(v))));
  const projectIds = Array.from(new Set(rows.map((r) => r.projectId).filter((v): v is string => Boolean(v))));
  const customerOf = new Map<string, string>(); // order/project id → customer id
  const names = new Map<string, string>(); // customer id → name

  try {
    const [orders, projects] = await Promise.all([
      orderIds.length ? supabase.from("orders").select("id,customer_id").in("id", orderIds) : Promise.resolve({ data: [] }),
      projectIds.length ? supabase.from("projects").select("id,customer_id").in("id", projectIds) : Promise.resolve({ data: [] }),
    ]);
    for (const row of [...((orders.data ?? []) as Array<Record<string, unknown>>), ...((projects.data ?? []) as Array<Record<string, unknown>>)]) {
      if (typeof row.id === "string" && typeof row.customer_id === "string") customerOf.set(row.id, row.customer_id);
    }
    const customerIds = Array.from(new Set(customerOf.values()));
    if (customerIds.length) {
      const { data } = await supabase.from("customers").select("id,name").in("id", customerIds);
      for (const c of (data ?? []) as Array<Record<string, unknown>>) {
        if (typeof c.id === "string" && typeof c.name === "string" && c.name.trim()) names.set(c.id, c.name.trim());
      }
    }
  } catch {
    // Names are a nicety; the list is still correct without them.
  }

  return rows
    .map((r) => {
      const customerId = (r.orderId && customerOf.get(r.orderId)) || (r.projectId && customerOf.get(r.projectId)) || null;
      const label = (customerId && names.get(customerId)) || r.notes?.trim() || "תקבול אשראי";
      return { id: r.id, date: r.paymentDate, amount: r.amount, label };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
