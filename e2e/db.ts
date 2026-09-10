import { createClient } from "@supabase/supabase-js";

// Direct DB setup/teardown for tests that need a real record to navigate to
// (detail pages are keyed off an id — there's no way to open one without
// one existing). Uses the service-role key from .env.test.local (see
// e2e/README.md) to bypass RLS entirely; this only ever runs against the
// local Supabase stack, never the real database.

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — copy .env.test.example to " +
        ".env.test.local and fill in the local `supabase start` output (see e2e/README.md)."
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type TestCustomer = { id: string; name: string };
export type TestProject = { id: string; name: string };

export async function createTestCustomer(overrides: { name?: string; phone?: string } = {}): Promise<TestCustomer> {
  const { data, error } = await adminClient()
    .from("customers")
    .insert({
      name: overrides.name ?? `לקוח בדיקה ${Date.now()}`,
      phone: overrides.phone ?? "0500000000",
      city: "תל אביב",
    })
    .select("id,name")
    .single();
  if (error) throw error;
  return data as TestCustomer;
}

export async function deleteTestCustomer(id: string): Promise<void> {
  const { error } = await adminClient().from("customers").delete().eq("id", id);
  if (error) throw error;
}

export async function getAdminUserId(): Promise<string> {
  const { data, error } = await adminClient()
    .from("users")
    .select("id")
    .eq("email", "e2e-admin@bizh.test")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function createTestProject(
  customerId: string,
  overrides: { name?: string } = {}
): Promise<TestProject> {
  const { data, error } = await adminClient()
    .from("projects")
    .insert({
      customer_id: customerId,
      name: overrides.name ?? `פרויקט בדיקה ${Date.now()}`,
      project_type: "other",
      status: "active",
    })
    .select("id,name")
    .single();
  if (error) throw error;
  return data as TestProject;
}

export async function deleteTestProject(id: string): Promise<void> {
  const { error } = await adminClient().from("projects").delete().eq("id", id);
  if (error) throw error;
}

export type TestOrder = { id: string };

export async function createTestOrder(customerId: string): Promise<TestOrder> {
  const createdBy = await getAdminUserId();
  const { data, error } = await adminClient()
    .from("orders")
    .insert({
      customer_id: customerId,
      status: "draft",
      payment_status: "unpaid",
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data as TestOrder;
}

export async function deleteTestOrder(id: string): Promise<void> {
  const { error } = await adminClient().from("orders").delete().eq("id", id);
  if (error) throw error;
}

export type TestProperty = { id: string; address: string };

export async function createTestProperty(overrides: { address?: string } = {}): Promise<TestProperty> {
  const { data, error } = await adminClient()
    .from("properties")
    .insert({ address: overrides.address ?? `נכס בדיקה ${Date.now()}` })
    .select("id,address")
    .single();
  if (error) throw error;
  return data as TestProperty;
}

export async function deleteTestProperty(id: string): Promise<void> {
  const { error } = await adminClient().from("properties").delete().eq("id", id);
  if (error) throw error;
}

export type TestVehicle = { id: string; tagId: string };

// Vehicle detail pages are keyed by their TAG id, not the vehicles.id row
// itself (see VehiclesClient.tsx's `/vehicles/${v.tagId}` link) — vehicles
// is a cross-cutting overlay on the shared tags table, not standalone.
export async function createTestVehicle(overrides: { name?: string } = {}): Promise<TestVehicle> {
  const supabase = adminClient();
  const { data: tag, error: tagError } = await supabase
    .from("tags")
    .insert({ kind: "vehicle", name: overrides.name ?? `רכב בדיקה ${Date.now()}` })
    .select("id")
    .single();
  if (tagError) throw tagError;
  const tagId = (tag as { id: string }).id;

  const { data: vehicle, error: vehicleError } = await supabase
    .from("vehicles")
    .insert({ tag_id: tagId })
    .select("id")
    .single();
  if (vehicleError) throw vehicleError;
  return { id: (vehicle as { id: string }).id, tagId };
}

export async function deleteTestVehicle(vehicle: TestVehicle): Promise<void> {
  const supabase = adminClient();
  const { error: vehicleError } = await supabase.from("vehicles").delete().eq("id", vehicle.id);
  if (vehicleError) throw vehicleError;
  const { error: tagError } = await supabase.from("tags").delete().eq("id", vehicle.tagId);
  if (tagError) throw tagError;
}

// For tests that create a task through the board's UI (no id available from
// the response) rather than via a direct insert — cleans up by exact title.
export async function deleteTestTaskByTitle(subject: string): Promise<void> {
  const { error } = await adminClient().from("tasks").delete().eq("subject", subject);
  if (error) throw error;
}
