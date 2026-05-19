import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireProfile } from "@/lib/auth/requireProfile";
import { performGlobalSearch } from "@/lib/global-search";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const query = (firstValue(params.q) ?? "").trim();
  const { profile, supabase } = await requireProfile();
  const results = await performGlobalSearch(supabase, {
    query,
    viewerRole: profile.role,
    limitPerGroup: 10,
    mode: "full",
  });

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">חיפוש גלובלי</h1>
          <p className="text-sm text-muted-foreground">
            מקום אחד לחיפוש לקוחות, פרויקטים, משימות, מכירות, מסמכים, מלאי ופיננסים.
          </p>
        </div>

        {!query ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              הקלידו בשורת החיפוש העליונה כדי לחפש בכל המערכת.
            </CardContent>
          </Card>
        ) : results.totalResults === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              לא נמצאו תוצאות עבור <span className="font-medium text-foreground">{query}</span>.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-6 text-sm">
                <div>
                  <span className="text-muted-foreground">חיפוש:</span>{" "}
                  <span className="font-medium">{query}</span>
                </div>
                <div className="text-muted-foreground">{results.totalResults} תוצאות</div>
              </CardContent>
            </Card>

            <div className="grid gap-4 xl:grid-cols-2">
              {results.groups.map((group) => (
                <Card key={group.key}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">{group.label}</CardTitle>
                    <CardDescription>{group.results.length} תוצאות</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {group.results.map((result) => (
                      <Link
                        key={`${result.group}:${result.id}`}
                        href={result.href}
                        className="block rounded-2xl border border-border/70 p-4 transition-colors hover:bg-muted/40"
                      >
                        <div className="font-medium">{result.title}</div>
                        {result.subtitle ? (
                          <div className="mt-1 text-sm text-muted-foreground">{result.subtitle}</div>
                        ) : null}
                        {result.meta.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            {result.meta.map((item) => (
                              <span key={item} className="rounded-full bg-muted px-2.5 py-1">
                                {item}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </Link>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
