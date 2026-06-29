import type { SupabaseClient } from "@supabase/supabase-js";
import { isCollectedPayment } from "@/lib/orders/paymentStatus";
import { fetchAllPagedResult } from "@/lib/supabase/paginate";

// ════════════════════════════════════════════════════════════════════════════
// Accounts layer (חשבונות) — real money containers with a running balance.
//
//   running balance = opening_balance + Σ(posted inflows) − Σ(posted outflows)
//
// for rows dated on/after the account's opening_date (everything before is
// assumed already inside the opening figure → never double-counted).
//
// "Posted" = money that actually moved/cleared, mirroring the financial engine's
// stage model: a collected payment, a paid expense, a recorded worker payment, a
// loan principal in/out, a loan repayment. Money that is still expected (pending
// check, not-yet-paid expense) is reported SEPARATELY as pendingIn / pendingOut
// and never folded into the live balance.
// ════════════════════════════════════════════════════════════════════════════

export const ACCOUNT_KINDS = [
  { value: "bank", label: "בנק" },
  { value: "cash", label: "מזומן" },
  { value: "card", label: "כרטיס אשראי" }, // reserved — nothing assigns to it yet
] as const;

export type AccountKind = (typeof ACCOUNT_KINDS)[number]["value"];

export function getAccountKindLabel(kind: string | null | undefined): string {
  return ACCOUNT_KINDS.find((k) => k.value === kind)?.label ?? "חשבון";
}

export type Account = {
  id: string;
  name: string;
  kind: AccountKind;
  openingBalance: number;
  openingDate: string; // YYYY-MM-DD
  isActive: boolean;
  sortOrder: number;
  notes: string | null;
};

/**
 * Which account kind a payment method lands in. cash → cash box; transfers,
 * checks and bit move through a bank account; credit_card → a card account.
 */
export function accountKindForMethod(method: string | null | undefined): AccountKind | null {
  const raw = (method ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "cash" || raw.includes("מזומן")) return "cash";
  if (raw === "credit_card" || raw.includes("אשראי") || raw.includes("כרטיס")) return "card";
  if (
    raw === "bank_transfer" ||
    raw === "bank transfer" ||
    raw === "check" ||
    raw === "cheque" ||
    raw === "bit" ||
    raw.includes("העברה") ||
    raw.includes("צ'ק") ||
    raw.includes("ביט")
  ) {
    return "bank";
  }
  return null;
}

/**
 * Auto-select rule (product decision: "default to the single bank/cash"): if the
 * method maps to a kind that has EXACTLY ONE active account, return that account's
 * id; otherwise "" (ambiguous or unknown → let the user pick). Pure, client-safe.
 */
export function defaultAccountForMethod(
  accounts: Array<Pick<Account, "id" | "kind" | "isActive">>,
  method: string | null | undefined
): string {
  const kind = accountKindForMethod(method);
  if (!kind) return "";
  const matches = accounts.filter((a) => a.isActive && a.kind === kind);
  return matches.length === 1 ? matches[0].id : "";
}

export type AccountBalance = Account & {
  postedIn: number; // collected payments since opening_date
  postedOut: number; // paid expenses + worker payments since opening_date
  currentBalance: number; // openingBalance + postedIn − postedOut
  pendingIn: number; // expected-but-not-cleared inflows (e.g. uncashed checks)
  pendingOut: number; // recorded-but-not-yet-paid outflows
};

// One line in an account's register (bank-statement style).
export type AccountLedgerEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  label: string;
  type: "in" | "out";
  amount: number;
  posted: boolean; // false = still expected (uncleared check / unpaid expense)
  runningBalance: number | null; // posted-only running balance; null for pending rows
};

export type AccountWithLedger = AccountBalance & { ledger: AccountLedgerEntry[] };

type Row = Record<string, unknown>;

function num(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function str(value: unknown) {
  return typeof value === "string" ? value : null;
}

function mapAccount(row: Row): Account {
  const kind = str(row.kind);
  return {
    id: str(row.id) ?? "",
    name: str(row.name)?.trim() || "חשבון",
    kind: (kind === "cash" || kind === "card" ? kind : "bank") as AccountKind,
    openingBalance: num(row.opening_balance),
    openingDate: str(row.opening_date) ?? "1970-01-01",
    isActive: row.is_active !== false,
    sortOrder: num(row.sort_order),
    notes: str(row.notes),
  };
}

const ACCOUNT_COLUMNS =
  "id,name,kind,opening_balance,opening_date,is_active,sort_order,notes";

/** All accounts, active first then by sort_order then name. */
export async function loadAccounts(
  supabase: SupabaseClient,
  { includeInactive = true }: { includeInactive?: boolean } = {}
): Promise<Account[]> {
  let query = supabase.from("accounts").select(ACCOUNT_COLUMNS);
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) {
    // Table not deployed yet / permission denied → treat as "no accounts" so the
    // rest of the financial UI keeps working.
    return [];
  }
  return ((data ?? []) as Row[])
    .map(mapAccount)
    .sort(
      (a, b) =>
        Number(b.isActive) - Number(a.isActive) ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name, "he")
    );
}

type RawLedgerEntry = {
  id: string;
  date: string;
  label: string;
  type: "in" | "out";
  amount: number;
  posted: boolean;
};

/**
 * Core scan: reads the money tables once (only rows assigned to an account, since
 * the earliest opening_date) and produces, per account, the posted/pending buckets
 * AND the raw ledger rows — bucketed with the same semantics as the cash-flow
 * engine (a collected payment / paid expense / recorded wage is "posted"; an
 * uncleared check or unpaid expense is "pending" and shown but not in the balance).
 */
async function scanAccountActivity(supabase: SupabaseClient, accounts: Account[]) {
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const earliestOpening = accounts.reduce(
    (min, a) => (a.openingDate < min ? a.openingDate : min),
    accounts[0].openingDate
  );

  // Each money table is scanned independently and degrades to "no rows" if its
  // query fails — most importantly when a table is missing its account_id column
  // (Postgres 42703) because create_accounts.sql hasn't been (fully) run yet.
  // A single missing column must NOT take down the whole חשבונות page; the
  // balances are computed from whatever tables ARE available, mirroring how
  // loadAccounts() already swallows its own error.
  const scan = async (table: string, page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>) => {
    const { data, error } = await fetchAllPagedResult<Row>(page);
    if (error) {
      console.warn(`[accounts] skipped "${table}" in balance scan: ${error.message}`);
      return [] as Row[];
    }
    return data;
  };

  const [paymentRows, expenseRows, workerPaymentRows, loanRows, loanRepaymentRows] =
    await Promise.all([
      scan("payments", (from, to) =>
        supabase
          .from("payments")
          .select("id,account_id,payment_date,due_date,amount_total,payment_status,notes")
          .not("account_id", "is", null)
          .gte("payment_date", earliestOpening)
          .range(from, to)
      ),
      scan("expenses", (from, to) =>
        supabase
          .from("expenses")
          .select("id,account_id,expense_date,paid_date,amount,paid_amount,payment_status,description,category")
          .not("account_id", "is", null)
          .gte("expense_date", earliestOpening)
          .range(from, to)
      ),
      scan("worker_payments", (from, to) =>
        supabase
          .from("worker_payments")
          .select("id,account_id,payment_date,amount,notes")
          .not("account_id", "is", null)
          .gte("payment_date", earliestOpening)
          .range(from, to)
      ),
      // Loans: principal lands in (taken) / leaves (given) a real account.
      scan("loans", (from, to) =>
        supabase
          .from("loans")
          .select("id,account_id,direction,loan_date,amount")
          .not("account_id", "is", null)
          .gte("loan_date", earliestOpening)
          .range(from, to)
      ),
      // Repayments: full cash moved (principal + interest), opposite direction.
      // direction is resolved from the parent loan below.
      scan("loan_repayments", (from, to) =>
        supabase
          .from("loan_repayments")
          .select("id,account_id,loan_id,repayment_date,amount")
          .not("account_id", "is", null)
          .gte("repayment_date", earliestOpening)
          .range(from, to)
      ),
    ]);

  const buckets = new Map<
    string,
    { postedIn: number; postedOut: number; pendingIn: number; pendingOut: number; rows: RawLedgerEntry[] }
  >(accounts.map((a) => [a.id, { postedIn: 0, postedOut: 0, pendingIn: 0, pendingOut: 0, rows: [] }]));

  // ── Payments: inflows, EXCEPT refunds (negative amount_total = money out) ────
  for (const row of paymentRows) {
    const account = byId.get(str(row.account_id) ?? "");
    if (!account) continue;
    const b = buckets.get(account.id)!;
    const date = str(row.payment_date);
    if (!date || date < account.openingDate) continue; // before go-live → in opening
    const signed = num(row.amount_total);
    const amount = Math.abs(signed);
    if (!amount) continue;
    const status = str(row.payment_status)?.trim().toLowerCase() ?? "";
    if (status === "rejected") continue; // bounced — moved nothing
    const posted = isCollectedPayment(status);
    const isRefund = signed < 0; // a refund leaves the account
    if (isRefund) {
      if (posted) b.postedOut += amount;
      else b.pendingOut += amount;
    } else if (posted) {
      b.postedIn += amount;
    } else {
      b.pendingIn += amount;
    }
    b.rows.push({
      id: `p:${str(row.id) ?? ""}`,
      date,
      label: str(row.notes)?.trim() || (isRefund ? "החזר ללקוח" : "תקבול"),
      type: isRefund ? "out" : "in",
      amount,
      posted,
    });
  }

  // ── Outflows: expenses ─────────────────────────────────────────────────────
  for (const row of expenseRows) {
    const account = byId.get(str(row.account_id) ?? "");
    if (!account) continue;
    const b = buckets.get(account.id)!;
    const date = str(row.paid_date) || str(row.expense_date);
    if (!date || date < account.openingDate) continue;
    const status = str(row.payment_status)?.trim().toLowerCase() ?? "";
    const total = Math.abs(num(row.amount));
    const paid = Math.abs(num(row.paid_amount));
    const label = str(row.description)?.trim() || str(row.category)?.trim() || "תשלום";
    let postedAmount = 0;
    let pendingAmount = 0;
    if (status === "paid" || status === "collected" || status === "completed") {
      postedAmount = total || paid;
    } else if (status === "partial") {
      postedAmount = paid;
      pendingAmount = Math.max(0, total - paid);
    } else if (!status) {
      // Legacy rows with no status are treated as paid (a recorded expense is a real outflow).
      postedAmount = total;
    } else if (status === "not_paid" || status === "pending") {
      pendingAmount = total;
    } else {
      postedAmount = total;
    }
    if (postedAmount > 0) {
      b.postedOut += postedAmount;
      b.rows.push({ id: `e:${str(row.id) ?? ""}`, date, label, type: "out", amount: postedAmount, posted: true });
    }
    if (pendingAmount > 0) {
      b.pendingOut += pendingAmount;
      b.rows.push({ id: `e:${str(row.id) ?? ""}:p`, date, label, type: "out", amount: pendingAmount, posted: false });
    }
  }

  // ── Outflows: worker payments (always money that actually moved) ────────────
  for (const row of workerPaymentRows) {
    const account = byId.get(str(row.account_id) ?? "");
    if (!account) continue;
    const b = buckets.get(account.id)!;
    const date = str(row.payment_date);
    if (!date || date < account.openingDate) continue;
    const amount = Math.abs(num(row.amount));
    if (!amount) continue;
    b.postedOut += amount;
    b.rows.push({
      id: `w:${str(row.id) ?? ""}`,
      date,
      label: str(row.notes)?.trim() || "תשלום שכר",
      type: "out",
      amount,
      posted: true,
    });
  }

  // Resolve loan direction for every repayment's parent loan (the repayment's own
  // loan may be older than the scan window / unassigned, so fetch directions by id).
  const loanDirectionById = new Map<string, string>();
  for (const row of loanRows) {
    const id = str(row.id);
    if (id) loanDirectionById.set(id, str(row.direction) ?? "taken");
  }
  const repayLoanIds = Array.from(
    new Set(
      (loanRepaymentRows)
        .map((r) => str(r.loan_id))
        .filter((id): id is string => Boolean(id))
        .filter((id) => !loanDirectionById.has(id))
    )
  );
  if (repayLoanIds.length > 0) {
    const { data: extraLoans } = await supabase
      .from("loans")
      .select("id,direction")
      .in("id", repayLoanIds);
    for (const row of (extraLoans ?? []) as Row[]) {
      const id = str(row.id);
      if (id) loanDirectionById.set(id, str(row.direction) ?? "taken");
    }
  }

  // ── Loan principal: taken = cash IN, given = cash OUT ───────────────────────
  for (const row of loanRows) {
    const account = byId.get(str(row.account_id) ?? "");
    if (!account) continue;
    const b = buckets.get(account.id)!;
    const date = str(row.loan_date);
    if (!date || date < account.openingDate) continue;
    const amount = Math.abs(num(row.amount));
    if (!amount) continue;
    const taken = (str(row.direction) ?? "taken") === "taken";
    if (taken) b.postedIn += amount;
    else b.postedOut += amount;
    b.rows.push({
      id: `l:${str(row.id) ?? ""}`,
      date,
      label: taken ? "הלוואה שהתקבלה" : "הלוואה שניתנה",
      type: taken ? "in" : "out",
      amount,
      posted: true,
    });
  }

  // ── Loan repayments: opposite of the loan (taken = OUT, given = IN). Full cash
  //    moved (principal + interest) — that is what actually hit the account. ─────
  for (const row of loanRepaymentRows) {
    const account = byId.get(str(row.account_id) ?? "");
    if (!account) continue;
    const b = buckets.get(account.id)!;
    const date = str(row.repayment_date);
    if (!date || date < account.openingDate) continue;
    const amount = Math.abs(num(row.amount));
    if (!amount) continue;
    const taken = (loanDirectionById.get(str(row.loan_id) ?? "") ?? "taken") === "taken";
    // taken loan → we repay (cash out); given loan → we get repaid (cash in).
    if (taken) b.postedOut += amount;
    else b.postedIn += amount;
    b.rows.push({
      id: `lr:${str(row.id) ?? ""}`,
      date,
      label: taken ? "החזר הלוואה" : "החזר שהתקבל",
      type: taken ? "out" : "in",
      amount,
      posted: true,
    });
  }

  return buckets;
}

/** Per-account live balances (no ledger rows) — the cheap overview. */
export async function loadAccountBalances(supabase: SupabaseClient): Promise<AccountBalance[]> {
  const accounts = await loadAccounts(supabase);
  if (accounts.length === 0) return [];
  const buckets = await scanAccountActivity(supabase, accounts);
  return accounts.map((a) => {
    const b = buckets.get(a.id)!;
    return {
      ...a,
      postedIn: b.postedIn,
      postedOut: b.postedOut,
      currentBalance: a.openingBalance + b.postedIn - b.postedOut,
      pendingIn: b.pendingIn,
      pendingOut: b.pendingOut,
    };
  });
}

/**
 * Full overview for the חשבונות page: each account's balances PLUS its register
 * (statement). The running balance is computed chronologically over POSTED rows
 * only (opening → newest); pending rows appear in the list with a null running
 * balance. Ledger is returned newest-first for display.
 */
export async function loadAccountsOverview(supabase: SupabaseClient): Promise<AccountWithLedger[]> {
  const accounts = await loadAccounts(supabase);
  if (accounts.length === 0) return [];
  const buckets = await scanAccountActivity(supabase, accounts);

  return accounts.map((a) => {
    const b = buckets.get(a.id)!;
    // Oldest-first to roll the running balance forward from the opening figure.
    const chronological = [...b.rows].sort(
      (l, r) => l.date.localeCompare(r.date) || l.id.localeCompare(r.id)
    );
    let running = a.openingBalance;
    const withRunning: AccountLedgerEntry[] = chronological.map((row) => {
      if (!row.posted) return { ...row, runningBalance: null };
      running += row.type === "in" ? row.amount : -row.amount;
      return { ...row, runningBalance: running };
    });
    return {
      ...a,
      postedIn: b.postedIn,
      postedOut: b.postedOut,
      currentBalance: a.openingBalance + b.postedIn - b.postedOut,
      pendingIn: b.pendingIn,
      pendingOut: b.pendingOut,
      ledger: withRunning.reverse(), // newest-first for display
    };
  });
}
