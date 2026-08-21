/**
 * The name of the screen you're on, derived from the path.
 *
 * The mobile top bar has no sidebar to orient you, so it must always say where
 * you are. A page can still declare its own heading with `useSetPageTitle`
 * (usually because it wants a live subtitle, e.g. a row count) and that always
 * wins — this is the fallback for every page that doesn't, so a new route can
 * never ship as an anonymous row of icons.
 *
 * Longest match first, so "/financial/reports" beats "/financial".
 */
const ROUTE_TITLES: Array<[string, string]> = [
  ["/dashboard", "דשבורד"],
  ["/deliveries", "משלוחים"],
  ["/calendar", "יומן"],
  ["/tasks/recurring", "משימות קבועות"],
  ["/tasks", "משימות"],
  ["/sales/orders/new", "הזמנה חדשה"],
  ["/sales/orders", "הזמנות"],
  ["/sales", "מכירות"],
  ["/customers", "לקוחות"],
  ["/projects", "פרויקטים"],
  ["/properties", "דירות"],
  ["/vehicles", "רכבים"],
  ["/communications", "תיעוד פניות"],
  ["/collections", "גבייה"],
  ["/checks", "צ׳קים"],
  ["/invoices", "חשבוניות"],
  ["/financial/payments-calendar", "לוח תשלומים"],
  ["/financial/statements", "כרטיסי אשראי"],
  ["/financial/reports", "דוחות"],
  ["/financial/loans", "הלוואות והחזרות"],
  ["/financial/taxes", "מע״מ ומסים"],
  ["/financial/import", "ייבוא חיובים"],
  ["/financial/bank", "חשבונות"],
  ["/financial", "תזרים"],
  ["/payroll/workers", "כרטיס עובד"],
  ["/payroll/attendance", "דיווחי נוכחות"],
  ["/payroll", "עובדים"],
  ["/documents", "מסמכים"],
  ["/activity", "פעילות"],
  ["/inbox", "מה דורש טיפול"],
  ["/notifications", "התראות"],
  ["/search", "חיפוש"],
  ["/profile", "הפרופיל שלי"],
  ["/settings/integrations/morning", "חיבור למורנינג"],
  ["/settings", "הגדרות ניהול"],
];

export function titleForPath(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const path = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  let best: { prefix: string; title: string } | null = null;
  for (const [prefix, title] of ROUTE_TITLES) {
    if (path !== prefix && !path.startsWith(`${prefix}/`)) continue;
    if (!best || prefix.length > best.prefix.length) best = { prefix, title };
  }
  return best?.title ?? null;
}
