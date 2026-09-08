import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveExistingCategoryId } from "@/lib/products/resolveCategoryId";

type TableScript = {
  products?: { data: unknown; error: { message: string } | null };
  product_categories?: {
    select?: { data: unknown; error: { message: string } | null };
    insert?: { data: unknown; error: { message: string } | null };
  };
};

function makeSupabase(script: TableScript) {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.not = () => builder;
    builder.limit = () => builder;
    builder.insert = () => {
      const resp = script.product_categories?.insert ?? { data: null, error: null };
      return { select: () => ({ maybeSingle: () => Promise.resolve(resp) }) };
    };
    builder.maybeSingle = () => {
      if (table === "products") return Promise.resolve(script.products ?? { data: null, error: null });
      if (table === "product_categories")
        return Promise.resolve(script.product_categories?.select ?? { data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    return builder;
  };
  return { from } as unknown as Parameters<typeof resolveExistingCategoryId>[0];
}

const ORIGINAL_ENV = process.env.DEFAULT_PRODUCT_CATEGORY_ID;
beforeEach(() => {
  delete process.env.DEFAULT_PRODUCT_CATEGORY_ID;
});
afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.DEFAULT_PRODUCT_CATEGORY_ID;
  else process.env.DEFAULT_PRODUCT_CATEGORY_ID = ORIGINAL_ENV;
});

describe("resolveExistingCategoryId — the fallback precedence chain", () => {
  it("1) an explicitly preferred category id wins outright, no queries needed", async () => {
    const supabase = makeSupabase({});
    const result = await resolveExistingCategoryId(supabase, "cat-preferred");
    expect(result).toEqual({ categoryId: "cat-preferred", created: false });
  });

  it("2) falls back to whatever category an existing PRODUCT already uses", async () => {
    const supabase = makeSupabase({ products: { data: { category_id: "cat-from-product" }, error: null } });
    const result = await resolveExistingCategoryId(supabase, null);
    expect(result).toEqual({ categoryId: "cat-from-product", created: false });
  });

  it("3) falls back to any existing category row when no product has one set", async () => {
    const supabase = makeSupabase({
      products: { data: null, error: null },
      product_categories: { select: { data: { id: "cat-existing" }, error: null } },
    });
    const result = await resolveExistingCategoryId(supabase, null);
    expect(result).toEqual({ categoryId: "cat-existing", created: false });
  });

  it("4) falls back to the configured DEFAULT_PRODUCT_CATEGORY_ID env var", async () => {
    process.env.DEFAULT_PRODUCT_CATEGORY_ID = "cat-from-env";
    const supabase = makeSupabase({
      products: { data: null, error: null },
      product_categories: { select: { data: null, error: null } },
    });
    const result = await resolveExistingCategoryId(supabase, null);
    expect(result).toEqual({ categoryId: "cat-from-env", created: false });
  });

  it("5) as a last resort, creates a new 'General' category", async () => {
    const supabase = makeSupabase({
      products: { data: null, error: null },
      product_categories: {
        select: { data: null, error: null },
        insert: { data: { id: "cat-new" }, error: null },
      },
    });
    const result = await resolveExistingCategoryId(supabase, null);
    expect(result).toEqual({ categoryId: "cat-new", created: true });
  });

  it("surfaces a Hebrew error when even the existing-category lookup fails (and there's no env fallback)", async () => {
    const supabase = makeSupabase({
      products: { data: null, error: null },
      product_categories: { select: { data: null, error: { message: "db down" } } },
    });
    const result = await resolveExistingCategoryId(supabase, null);
    expect(result.categoryId).toBeNull();
    expect((result as { error: string }).error).toBeTruthy();
  });
});
