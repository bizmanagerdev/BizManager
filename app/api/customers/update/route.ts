import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { syncEntityTags, parseTagIds } from "@/lib/tags";
import {
  CUSTOMER_CORE_SELECT,
  isMissingLinkColumn,
  withLinkColumn,
  type QueryError,
} from "@/lib/customers/workerLink";

type UpdateCustomerPayload = {
  id?: string;
  name?: string;
  name_for_invoice?: string | null;
  registration_number?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  city?: string | null;
  address?: string | null;
  notes?: string | null;
  active?: boolean;
  requires_prepayment?: boolean;
  /** The users row that is the same person as this customer. `null` unlinks. */
  linked_user_id?: string | null;
  tag_ids?: unknown;
};

function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as UpdateCustomerPayload;

    const id = typeof body.id === "string" ? body.id : "";
    if (!id) {
      return NextResponse.json({ error: "Missing customer id" }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};

    if ("name" in body) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        return NextResponse.json({ error: "Customer name is required" }, { status: 400 });
      }
      patch.name = name;
    }
    if ("name_for_invoice" in body) {
      const nameForInvoice = trimOrNull(body.name_for_invoice);
      patch.name_for_invoice = nameForInvoice ?? (typeof patch.name === "string" ? patch.name : null);
    } else if ("name" in body) {
      patch.name_for_invoice = patch.name;
    }
    if ("registration_number" in body) patch.registration_number = trimOrNull(body.registration_number);
    if ("phone" in body) patch.phone = trimOrNull(body.phone);
    if ("whatsapp" in body) patch.whatsapp = trimOrNull(body.whatsapp);
    if ("email" in body) patch.email = trimOrNull(body.email);
    // city is NOT NULL — only overwrite when a non-empty value is supplied, so an
    // edit that omits/blanks the city never violates the constraint.
    if ("city" in body) {
      const city = trimOrNull(body.city);
      if (city) patch.city = city;
    }
    if ("address" in body) patch.address = trimOrNull(body.address);
    if ("notes" in body) patch.notes = trimOrNull(body.notes);
    if ("active" in body) patch.active = body.active === true;
    if ("requires_prepayment" in body) patch.requires_prepayment = body.requires_prepayment === true;
    // Tracked apart from `patch` so a database that predates the migration can
    // still save every other field instead of rejecting the whole edit.
    const hasLinkUpdate = "linked_user_id" in body;
    const linkedUserId = trimOrNull(body.linked_user_id);

    const hasTagUpdate = "tag_ids" in body;
    if (Object.keys(patch).length === 0 && !hasTagUpdate && !hasLinkUpdate) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    const SELECT = CUSTOMER_CORE_SELECT;
    const SELECT_WITH_LINK = `${CUSTOMER_CORE_SELECT},linked_user_id`;

    let data:
      | { id: string; [key: string]: unknown }
      | null = null;

    if (Object.keys(patch).length > 0 || hasLinkUpdate) {
      const fullPatch = hasLinkUpdate ? { ...patch, linked_user_id: linkedUserId } : patch;
      // Cast: the select string is chosen at runtime, so supabase-js can't parse
      // it into a row type.
      type UpdateResult = { data: Record<string, unknown> | null; error: QueryError };
      let { data: updated, error } = (await supabase
        .from("customers")
        .update(fullPatch)
        .eq("id", id)
        .select(hasLinkUpdate ? SELECT_WITH_LINK : SELECT)
        .maybeSingle()) as unknown as UpdateResult;

      if (error && hasLinkUpdate && isMissingLinkColumn(error)) {
        if (Object.keys(patch).length === 0) {
          // Link-only edit against a pre-migration database: nothing to write.
          return NextResponse.json({ error: "קישור עובד ללקוח דורש הרצת מיגרציה במסד הנתונים." }, { status: 400 });
        }
        ({ data: updated, error } = (await supabase
          .from("customers")
          .update(patch)
          .eq("id", id)
          .select(SELECT)
          .maybeSingle()) as unknown as UpdateResult);
      }

      if (error) {
        if (hasLinkUpdate && error.code === "23505") {
          return NextResponse.json({ error: "העובד שנבחר כבר מקושר ללקוח אחר." }, { status: 400 });
        }
        return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
      }
      if (!updated || typeof updated.id !== "string") {
        return NextResponse.json({ error: "Customer was not updated" }, { status: 400 });
      }
      data = updated as { id: string; [key: string]: unknown };
    } else {
      // Tag-only edit: nothing changed on the customer row itself; read it back.
      const { data: current } = await withLinkColumn(SELECT, (select) =>
        supabase.from("customers").select(select).eq("id", id).maybeSingle()
      );
      data = (current as { id: string; [key: string]: unknown } | null) ?? null;
      if (!data) {
        return NextResponse.json({ error: "Customer was not updated" }, { status: 400 });
      }
    }

    if (hasTagUpdate) {
      await syncEntityTags(supabase, "customer", id, parseTagIds(body.tag_ids), {
        replace: true,
        createdBy: user.id,
      });
    }

    return NextResponse.json({ customer: data });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
