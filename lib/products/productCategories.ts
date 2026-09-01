import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type ProductCategory = { id: string; name: string; active: boolean };

/**
 * Get-or-create a product category. RLS ("product_categories_admin_full"/
 * "product_categories_office_full") matches the old route's unrestricted
 * requireRouteAccess (any staff role could call it; only admin/office could
 * actually write, same as now).
 */
export async function getOrCreateProductCategory(name: string): Promise<{ ok: true; category: ProductCategory } | { ok: false; error: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "יש להזין שם קטגוריה." };

  const supabase = createSupabaseBrowserClient();
  const { data: existing, error: existingError } = await supabase
    .from("product_categories")
    .select("id,name,active")
    .eq("name", trimmed)
    .maybeSingle();
  if (existingError) return { ok: false, error: existingError.message };
  if (existing) return { ok: true, category: existing as ProductCategory };

  const { data, error } = await supabase
    .from("product_categories")
    .insert({ name: trimmed, active: true })
    .select("id,name,active")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "יצירת קטגוריה נכשלה." };
  return { ok: true, category: data as ProductCategory };
}
