import { toHebrewError } from "@/lib/error-messages";
﻿import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";
import { syncEntityTags, parseTagIds } from "@/lib/tags";
import { CUSTOMER_CORE_SELECT, isMissingLinkColumn, type QueryError } from "@/lib/customers/workerLink";
import { clientRowId } from "@/lib/client-row-id";
import { newCustomerRow, parseNewCustomerBranches, parseNewCustomerContacts } from "@/lib/customers/new-customer";

type CreateCustomerPayload = {
  /** The id the app gave it (saved on the phone first) — else the database picks one. */
  id?: unknown;
  name?: string;
  name_for_invoice?: string | null;
  registration_number?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  city?: string | null;
  address?: string | null;
  notes?: string | null;
  requires_prepayment?: boolean;
  /** The users row that is the same person as this customer (worker who buys from us). */
  linked_user_id?: string | null;
  tag_ids?: unknown;
  /** Its contacts and branches, created right after it (the phone sends them all in one change). */
  contacts?: unknown;
  branches?: unknown;
};

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    return await withIdempotency(req, supabase, user.id, "customers/create", async () => {
    const body = (await req.json()) as CreateCustomerPayload;
    const clientId = clientRowId(body.id);

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const city = typeof body.city === "string" ? body.city.trim() : "";
    const linkedUserId =
      typeof body.linked_user_id === "string" && body.linked_user_id.trim()
        ? body.linked_user_id.trim()
        : null;

    if (!name) {
      return NextResponse.json({ error: "שם לקוח הוא שדה חובה." }, { status: 400 });
    }
    if (!city) {
      return NextResponse.json({ error: "עיר היא שדה חובה לתיאום משלוחים." }, { status: 400 });
    }
    // The same row the phone writes when it saves first (lib/customers/new-customer.ts).
    const baseRow = {
      ...(clientId ? { id: clientId } : {}),
      ...newCustomerRow({
        name,
        name_for_invoice: typeof body.name_for_invoice === "string" ? body.name_for_invoice : null,
        registration_number: typeof body.registration_number === "string" ? body.registration_number : null,
        phone: typeof body.phone === "string" ? body.phone : null,
        whatsapp: typeof body.whatsapp === "string" ? body.whatsapp : null,
        email: typeof body.email === "string" ? body.email : null,
        city,
        street: typeof body.address === "string" ? body.address : null,
        notes: typeof body.notes === "string" ? body.notes : null,
        requires_prepayment: body.requires_prepayment === true,
      }),
    };

    // The worker link is best-effort: on a database that is still missing the
    // column, creating the customer must not fail — only the link is dropped.
    // (Cast because the select string is built at runtime, so supabase-js can't
    // parse it into a row type.)
    type InsertResult = { data: Record<string, unknown> | null; error: QueryError };
    let { data, error } = (await supabase
      .from("customers")
      .insert(linkedUserId ? { ...baseRow, linked_user_id: linkedUserId } : baseRow)
      .select(linkedUserId ? `${CUSTOMER_CORE_SELECT},linked_user_id` : CUSTOMER_CORE_SELECT)
      .maybeSingle()) as unknown as InsertResult;

    if (error && linkedUserId && isMissingLinkColumn(error)) {
      ({ data, error } = (await supabase
        .from("customers")
        .insert(baseRow)
        .select(CUSTOMER_CORE_SELECT)
        .maybeSingle()) as unknown as InsertResult);
    }

    if (error) {
      if (clientId && error.code === "23505") {
        // Sent again after its answer was lost: the customer it already made.
        const { data: existing } = await supabase
          .from("customers")
          .select(CUSTOMER_CORE_SELECT)
          .eq("id", clientId)
          .maybeSingle();
        if (existing) return NextResponse.json({ customer: existing });
      }
      if (linkedUserId && error.code === "23505") {
        return NextResponse.json({ error: "העובד שנבחר כבר מקושר ללקוח אחר." }, { status: 400 });
      }
      return NextResponse.json({ error: `יצירת לקוח נכשלה: ${error.message}` }, { status: 400 });
    }
    if (!data || typeof data.id !== "string") {
      return NextResponse.json({ error: "לקוח לא נוצר בהצלחה." }, { status: 500 });
    }

    await syncEntityTags(supabase, "customer", data.id, parseTagIds(body.tag_ids), {
      createdBy: user.id,
    });

    // Contacts and branches sent with it. The customer itself is made either
    // way: a contact or branch that fails is reported back, not a failed save.
    const contacts = parseNewCustomerContacts(body.contacts);
    const branches = parseNewCustomerBranches(body.branches);
    const problems: string[] = [];
    let createdContacts: Record<string, unknown>[] = [];
    if (contacts.length > 0) {
      const { data: rows, error: contactsError } = await supabase
        .from("contacts")
        .insert(contacts.map((contact) => ({ customer_id: data.id, ...contact })))
        .select("id,customer_id,full_name,role,phone,email,whatsapp,is_primary,active,notes");
      if (contactsError) problems.push(`אנשי קשר: ${toHebrewError(contactsError.message)}`);
      else createdContacts = (rows ?? []) as Record<string, unknown>[];
    }
    if (branches.length > 0) {
      const { error: branchesError } = await supabase
        .from("customer_branches")
        .insert(branches.map((branch) => ({ customer_id: data.id, ...branch })));
      if (branchesError) problems.push(`סניפים: ${toHebrewError(branchesError.message)}`);
    }

    return NextResponse.json({
      customer: data,
      ...(contacts.length > 0 ? { contacts: createdContacts } : {}),
      ...(problems.length > 0 ? { partial: problems.join(" · ") } : {}),
    });
    });
  } catch (err: unknown) {
    const message = toHebrewError(err, "שגיאה לא ידועה");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
