import { normalizePhone } from "@/lib/search/customerMatch";

/**
 * "עובד שהוא גם לקוח" — the `customers.linked_user_id` link.
 *
 * A worker who also buys from the business needs his own `customers` row (every
 * order/project/loan FK points at `customers.id`, never at `users.id`). This
 * column only records that the two rows are the same human, so the UI can badge
 * it, cross-link the two pages, and show one combined balance — while the money
 * itself stays on its own side: receivables on the customer, payroll on the user.
 *
 * See supabase/migrations/20260807000000_customer_worker_link.sql.
 */

/** The customer columns every caller already selected before the link existed. */
export const CUSTOMER_CORE_SELECT =
  "id,name,name_for_invoice,registration_number,phone,whatsapp,email,address,active,notes,requires_prepayment";

/** The shape of a PostgREST error, narrowed to what these helpers look at. */
export type QueryError = { code?: string; message?: string } | null;

/** Postgres "column does not exist" — the migration hasn't been applied yet. */
export function isMissingLinkColumn(error: QueryError | undefined): boolean {
  if (!error) return false;
  if (error.code === "42703") return true;
  return typeof error.message === "string" && error.message.includes("linked_user_id");
}

/**
 * Run a customer query that wants `linked_user_id`, falling back to the same
 * query without it when the migration hasn't run yet. Keeps the app working on
 * a database that is one migration behind instead of 400-ing every customer read.
 *
 * `run` takes the select string because the two attempts differ only by it. The
 * result is cast: supabase-js parses select strings at the type level and can't
 * do that for a runtime-built one, so the row type is the caller's to declare.
 */
export async function withLinkColumn<T = Record<string, unknown>>(
  baseSelect: string,
  run: (select: string) => PromiseLike<{ data: unknown; error: QueryError }>
): Promise<{ data: T | null; error: QueryError; linkColumnMissing: boolean }> {
  const first = await run(`${baseSelect},linked_user_id`);
  if (!isMissingLinkColumn(first.error)) {
    return { data: (first.data ?? null) as T | null, error: first.error, linkColumnMissing: false };
  }
  const fallback = await run(baseSelect);
  return { data: (fallback.data ?? null) as T | null, error: fallback.error, linkColumnMissing: true };
}

/** Staff row as the customer form's worker picker consumes it. */
export type WorkerOption = {
  id: string;
  label: string;
  phone: string | null;
  /** Set when this worker is already linked to a different customer. */
  linkedCustomerId: string | null;
  linkedCustomerName: string | null;
};

/**
 * The worker whose phone is the one being typed into the new-customer form —
 * the "this phone belongs to עובד ___" suggestion. Already-linked workers are
 * skipped: suggesting them would push the user toward a second customer row for
 * a worker who has one, which the unique index rejects anyway.
 */
export function matchWorkerByPhone(
  workers: WorkerOption[],
  ...phones: (string | null | undefined)[]
): WorkerOption | null {
  const wanted = phones.map(normalizePhone).filter((p) => p.length >= 7);
  if (wanted.length === 0) return null;
  return (
    workers.find((worker) => {
      if (worker.linkedCustomerId) return false;
      const workerPhone = normalizePhone(worker.phone);
      return workerPhone.length >= 7 && wanted.includes(workerPhone);
    }) ?? null
  );
}

// The two-sided balance itself lives in lib/customers/counterpartyBalance.ts —
// it spans loans and payroll too, not just the link.
