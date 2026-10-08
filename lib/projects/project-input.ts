import { computeDueDate, normalizePaymentTerms } from "@/lib/paymentTerms";

// A project's row as the project forms send it — built the SAME way on the
// server (app/api/projects/create, app/api/projects/update) and on the phone
// (lib/projects/device-project-saves.ts, saving on the device copy first), so
// the row the phone shows at once is the row the server then keeps. The VAT
// rate a price-includes-VAT project freezes isn't here: each side works it out
// itself, and the server's is the one kept.

export const PROJECT_TYPES: ReadonlySet<string> = new Set(["logistics", "construction", "moving", "other", "home"]);

/** A project's statuses (project_status_enum), in the status picker's order. */
export const PROJECT_STATUSES: readonly string[] = ["quote", "planned", "active", "on_hold", "completed", "cancelled"];

export type ProjectRowFields = {
  customer_id: string;
  branch_id: string | null;
  name: string;
  project_type: string;
  status: string;
  agreed_base_price: number;
  actual_price: number;
  price_includes_vat: boolean;
  no_charge: boolean;
  expenses_billed_separately: boolean;
  project_manager_id: string | null;
  start_date: string | null;
  end_date: string | null;
  payment_terms: string | null;
  due_date: string | null;
  notes: string | null;
  items_to_move: string[] | null;
  origin_address: string | null;
  origin_floor: string | null;
  origin_has_elevator: boolean | null;
  destination_address: string | null;
  destination_floor: string | null;
  destination_has_elevator: boolean | null;
};

/** The row's columns, in a fixed order. */
export const PROJECT_ROW_COLUMNS = [
  "customer_id", "branch_id", "name", "project_type", "status", "agreed_base_price", "actual_price",
  "price_includes_vat", "no_charge", "expenses_billed_separately", "project_manager_id", "start_date", "end_date",
  "payment_terms", "due_date", "notes", "items_to_move", "origin_address", "origin_floor", "origin_has_elevator",
  "destination_address", "destination_floor", "destination_has_elevator",
] as const satisfies readonly (keyof ProjectRowFields)[];

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function sanitizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return null;
  const cleaned = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned : null;
}

function toTrimmedOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** A non-empty string as is, else null (ids and dates: an empty one is "none"). */
function toStringOrNull(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function toBoolOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

const sameDay = (a: string | null | undefined, b: string | null | undefined) =>
  (a ? a.slice(0, 10) : null) === (b ? b.slice(0, 10) : null);

/**
 * What a form that doesn't show them (a project page's edit form) sends back
 * of a project's branch, payment terms and due date — the update route takes
 * the whole record, so leaving them out cleared them. As they are; the due
 * date too, unless the start moved: then none, and the route (or the phone)
 * works it out from the new start and the terms. Only what the project has.
 */
export function keptProjectFields(
  project: { branch_id?: string | null; payment_terms?: string | null; due_date?: string | null; start_date?: string | null },
  newStartDate: string | null
): Partial<Pick<ProjectRowFields, "branch_id" | "payment_terms" | "due_date">> {
  return {
    ...(project.branch_id !== undefined ? { branch_id: project.branch_id } : {}),
    ...(project.payment_terms !== undefined ? { payment_terms: project.payment_terms } : {}),
    ...(project.due_date !== undefined
      ? { due_date: sameDay(newStartDate, project.start_date) ? project.due_date : null }
      : {}),
  };
}

/** The projects row a project form's fields make, or why they don't make one. */
export function projectRowFrom(body: Record<string, unknown>): { row: ProjectRowFields } | { error: string } {
  const customerId = typeof body.customer_id === "string" ? body.customer_id : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const projectType = typeof body.project_type === "string" ? body.project_type : "";
  const status = typeof body.status === "string" ? body.status : "";
  // No-charge (donation / favor / internal): the price is intentionally 0.
  const noCharge = Boolean(body.no_charge);
  const agreedBasePriceRaw = body.agreed_base_price;
  const agreedBasePrice = noCharge
    ? 0
    : agreedBasePriceRaw === undefined || agreedBasePriceRaw === null || agreedBasePriceRaw === ""
      ? 0
      : toNumber(agreedBasePriceRaw);
  const actualPrice = agreedBasePrice;
  const startDate = toStringOrNull(body.start_date);
  const paymentTerms = normalizePaymentTerms(body.payment_terms);
  const dueDate =
    typeof body.due_date === "string" && body.due_date.trim()
      ? body.due_date.trim()
      : computeDueDate(startDate, paymentTerms);
  // Moving-only origin → destination addresses (each: address + floor + elevator).
  const isMoving = projectType === "moving";

  if (!customerId || !name || !projectType || !status) return { error: "Missing required fields" };
  if (!PROJECT_TYPES.has(projectType)) return { error: "Invalid project_type" };
  if (!Number.isFinite(agreedBasePrice) || agreedBasePrice < 0 || !Number.isFinite(actualPrice)) {
    return { error: "Invalid prices" };
  }

  return {
    row: {
      customer_id: customerId,
      branch_id: toTrimmedOrNull(body.branch_id),
      name,
      project_type: projectType,
      status,
      agreed_base_price: agreedBasePrice,
      actual_price: actualPrice,
      price_includes_vat: Boolean(body.price_includes_vat),
      no_charge: noCharge,
      expenses_billed_separately: Boolean(body.expenses_billed_separately),
      project_manager_id: toStringOrNull(body.project_manager_id),
      start_date: startDate,
      end_date: toStringOrNull(body.end_date),
      payment_terms: paymentTerms,
      due_date: dueDate,
      notes: typeof body.notes === "string" ? body.notes.trim() : null,
      items_to_move: isMoving ? sanitizeStringArray(body.items_to_move) : null,
      origin_address: isMoving ? toTrimmedOrNull(body.origin_address) : null,
      origin_floor: isMoving ? toTrimmedOrNull(body.origin_floor) : null,
      origin_has_elevator: isMoving ? toBoolOrNull(body.origin_has_elevator) : null,
      destination_address: isMoving ? toTrimmedOrNull(body.destination_address) : null,
      destination_floor: isMoving ? toTrimmedOrNull(body.destination_floor) : null,
      destination_has_elevator: isMoving ? toBoolOrNull(body.destination_has_elevator) : null,
    },
  };
}
