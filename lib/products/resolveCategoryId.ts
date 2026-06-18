import { toHebrewError } from "@/lib/error-messages";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

type RouteSupabaseClient = Awaited<ReturnType<typeof createSupabaseRouteClient>>;

type CategoryRow = {
  id?: unknown;
};

type ProductRow = {
  category_id?: unknown;
};

type ResolveCategoryResult =
  | { categoryId: string; created: boolean }
  | { categoryId: null; created: false; error: string };

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function readCategoryId(row: CategoryRow | null | undefined) {
  return readString(row?.id);
}

export async function resolveExistingCategoryId(
  supabase: RouteSupabaseClient,
  preferredCategoryId?: string | null
): Promise<ResolveCategoryResult> {
  const preferred = readString(preferredCategoryId);
  if (preferred) {
    return { categoryId: preferred, created: false };
  }

  const configuredFallback = readString(process.env.DEFAULT_PRODUCT_CATEGORY_ID);

  const productResult = await supabase
    .from("products")
    .select("category_id")
    .not("category_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (!productResult.error) {
    const productCategoryId = readString((productResult.data as ProductRow | null | undefined)?.category_id);
    if (productCategoryId) {
      return { categoryId: productCategoryId, created: false };
    }
  }

  const existingResult = await supabase.from("product_categories").select("id").limit(1).maybeSingle();

  if (!existingResult.error) {
    const existingCategoryId = readCategoryId((existingResult.data ?? null) as CategoryRow | null);
    if (existingCategoryId) {
      return { categoryId: existingCategoryId, created: false };
    }
  }

  if (configuredFallback) {
    return { categoryId: configuredFallback, created: false };
  }

  if (existingResult.error) {
    return {
      categoryId: null,
      created: false,
      error: toHebrewError(existingResult.error.message),
    };
  }

  const createdResult = await supabase
    .from("product_categories")
    .insert({ name: "General" })
    .select("id")
    .maybeSingle();

  if (createdResult.error) {
    return {
      categoryId: null,
      created: false,
      error: toHebrewError(createdResult.error.message),
    };
  }

  const createdCategoryId = readCategoryId((createdResult.data ?? null) as CategoryRow | null);
  if (!createdCategoryId) {
    return {
      categoryId: null,
      created: false,
      error: "Could not create a default product category.",
    };
  }

  return { categoryId: createdCategoryId, created: true };
}
