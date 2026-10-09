import AppShell from "@/components/layout/AppShell";

// The invoices page is a placeholder — its heading and "בקרוב." and nothing
// to load but the viewer's role — so its loading screen is the page itself,
// instead of nothing until the role check answers.
export default function InvoicesLoading() {
  return (
    <AppShell>
      <div data-route-loading="true">
        <h1>חשבוניות</h1>
        <p>בקרוב.</p>
      </div>
    </AppShell>
  );
}
