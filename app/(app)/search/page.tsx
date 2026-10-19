import AppShell from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SearchIcon } from "@/components/ui/icons";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { GLOBAL_SEARCH_LABELS, isGlobalSearchKind, performGlobalSearch } from "@/lib/global-search";
import { GlobalSearchResults } from "@/components/search/GlobalSearchResults";
import { toHebrewError } from "@/lib/error-messages";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// The full results of the global search: up to 20 of every kind of record,
// and with ?kind=… every match of one kind ("הצג את כל 36").
export default async function SearchPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const query = (firstValue(params.q) ?? "").trim();
  const kindParam = firstValue(params.kind);
  const kind = isGlobalSearchKind(kindParam) ? kindParam : null;
  const { profile, supabase } = await requireStaffPage();

  let error: string | null = null;
  let results: Awaited<ReturnType<typeof performGlobalSearch>> | null = null;
  if (query) {
    try {
      results = await performGlobalSearch(supabase, {
        query,
        viewerRole: profile.role,
        viewerId: profile.id,
        limitPerGroup: kind ? 500 : 20,
        kind,
      });
    } catch (cause: unknown) {
      error = toHebrewError(cause, "החיפוש נכשל");
    }
  }

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">
            {kind ? `חיפוש — ${GLOBAL_SEARCH_LABELS[kind]}` : "חיפוש בכל המערכת"}
          </h1>
          <p className="text-sm text-muted-foreground">
            מילה, תאריך, תגובה, מספר, כל דבר...
          </p>
        </div>

        <form action="/search" method="get" className="flex gap-2">
          {kind ? <input type="hidden" name="kind" value={kind} /> : null}
          <div className="relative flex-1">
            <SearchIcon className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              defaultValue={query}
              placeholder="מה לחפש?"
              className="h-11 ps-9 text-base"
              autoComplete="off"
              enterKeyHint="search"
            />
          </div>
          <Button type="submit" className="h-11 rounded-xl px-5">
            חיפוש
          </Button>
        </form>

        {!query ? null : error ? (
          <Card>
            <CardContent className="p-6 text-sm text-destructive">{error}</CardContent>
          </Card>
        ) : !results || results.totalResults === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              לא נמצאו תוצאות עבור <span className="font-medium text-foreground">{query}</span>.
            </CardContent>
          </Card>
        ) : (
          <GlobalSearchResults results={results} showAllKind={kind} />
        )}
      </div>
    </AppShell>
  );
}
