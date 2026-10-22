// The customers list's layout, shared by the list (CustomersClient) and its
// loading placeholder (CustomersSkeleton), so the placeholder is the page's
// exact shape and nothing moves when the page arrives.

/**
 * The computer's table, from 1024px (lg) — below that the swipe cards (owner,
 * 2026-10-13). Its columns are sized to fit a 1024px screen with the sidebar
 * open (about 44rem for the table — 45rem ran 6px past its card at 1024px with
 * the default 17px text) up to 1366px without scrolling: the fixed
 * shares hold their headers and a ₪ figure, the three text columns wrap. At a
 * bigger text size the rem minimum grows with it, and the table scrolls inside
 * its card rather than running emails and figures into the next column.
 */
export const CUSTOMERS_COLUMNS: ReadonlyArray<{ key: string; label: string; width: string; srOnly?: boolean }> = [
  { key: "name", label: "לקוח", width: "w-[19%]" },
  { key: "contact", label: "טלפון ואימייל", width: "w-[17%]" },
  { key: "address", label: "כתובת", width: "w-[16%]" },
  { key: "morning", label: "Morning", width: "w-[10.5%]" },
  { key: "orders", label: "הזמנות", width: "w-[8.5%]" },
  { key: "projects", label: "פרויקטים", width: "w-[10.5%]" },
  { key: "debt", label: "חוב פתוח", width: "w-[11.5%]" },
  // The ⋮ column names itself to a screen reader only — the word didn't fit.
  { key: "actions", label: "פעולות", width: "w-[7%]", srOnly: true },
];

export const CUSTOMERS_TABLE_CLASS = "table-fixed min-w-[44rem]";
export const CUSTOMERS_HEAD_CELL = "px-2 py-2 font-medium";
export const CUSTOMERS_CELL = "px-2 py-1.5";

/** The line over the phone's cards — the four sections' own words and size. */
export const CUSTOMERS_SWIPE_HINT = "החלק כרטיס ימינה לפעולות · הקש לפתיחה";
export const CUSTOMERS_HINT_TEXT = "text-[0.647rem] text-muted-foreground";
/** Tall enough for the "לא מקוון" pill that can join it, so it never grows the line. */
export const CUSTOMERS_HINT_ROW = "flex min-h-6 items-center justify-between gap-2 px-1";
/** The count line from md up — the same reserved height, for the same pill. */
export const CUSTOMERS_COUNT_ROW = "hidden min-h-6 items-center justify-between gap-2 text-sm text-muted-foreground md:flex";

/**
 * The md+ toolbar: the search, then the filter toggle and the export, bottoms aligned — the search 20rem at most,
 * not the page's width (owner, 2026-10-22; PAGE_SEARCH_WIDTH), the row at the start.
 */
export const CUSTOMERS_TOOLBAR =
  "hidden gap-3 md:grid md:grid-cols-[minmax(0,24rem)_auto_auto] md:items-end md:justify-start";
