// ────────────────────────────────────────────────────────────────────────────
// What the archive remembers between visits: which facets are on, how things
// are grouped and sorted, grid or list.
//
// Per browser, not per account — these are a way of looking, not a setting.
// Both stores exist in this shape because the page is server-rendered and
// useSyncExternalStore needs a referentially stable snapshot; see readPrefs.
// ────────────────────────────────────────────────────────────────────────────

export const ENTITY_FACETS: Array<{ key: string; label: string }> = [
  { key: "", label: "הכל" },
  { key: "project", label: "פרויקטים" },
  { key: "vehicle", label: "רכבים" },
  { key: "property", label: "נכסים" },
  { key: "customer", label: "לקוחות" },
  { key: "order", label: "הזמנות" },
  { key: "task", label: "משימות" },
  { key: "user", label: "עובדים" },
  { key: "unlinked", label: "ללא שיוך" },
];

// Which way you read the archive is a per-viewer convenience, so it lives in
// this browser and nowhere else. Every access is guarded — storage throws in a
// private window and returns nothing with site data cleared.
export type DocumentsViewMode = "list" | "grid";

export type DocumentsPrefs = {
  attachedTo: string[];
  typeChips: string[];
  /** Any of EXPIRY_FACETS — "expired" | "soon" | "undated". */
  expiry: string[];
  groupBy: string;
  sortBy: string;
};
export const PREFS_KEY = "documents:prefs";
export const DEFAULT_PREFS: DocumentsPrefs = {
  attachedTo: [],
  typeChips: [],
  expiry: [],
  groupBy: "entity",
  sortBy: "newest",
};

/** Only the states a person can act on — "valid" is not something to filter for. */
export const EXPIRY_FACETS: Array<{ key: string; label: string }> = [
  { key: "expired", label: "פג תוקף" },
  { key: "soon", label: "פג בקרוב" },
  { key: "undated", label: "חסר תאריך" },
];

/** Same shape as the view-mode store, and for the same reason: this component
 *  is server-rendered, so the preference cannot be read in a lazy initializer
 *  without hydrating to a different value than the server produced. */
export function readPrefs(): DocumentsPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<DocumentsPrefs>;
    return {
      attachedTo: Array.isArray(parsed.attachedTo)
        ? parsed.attachedTo.filter((v): v is string => typeof v === "string")
        : [],
      typeChips: Array.isArray(parsed.typeChips)
        ? parsed.typeChips.filter((v): v is string => typeof v === "string")
        : [],
      expiry: Array.isArray(parsed.expiry)
        ? parsed.expiry.filter((v): v is string => typeof v === "string")
        : [],
      groupBy: typeof parsed.groupBy === "string" ? parsed.groupBy : DEFAULT_PREFS.groupBy,
      sortBy: typeof parsed.sortBy === "string" ? parsed.sortBy : DEFAULT_PREFS.sortBy,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export const prefsListeners = new Set<() => void>();
// The snapshot must be referentially stable between reads or
// useSyncExternalStore loops, so cache the parsed object and only replace it
// when something is actually written.
let prefsCache: DocumentsPrefs | null = null;
export const prefsStore = {
  subscribe(callback: () => void) {
    prefsListeners.add(callback);
    return () => {
      prefsListeners.delete(callback);
    };
  },
  get(): DocumentsPrefs {
    if (!prefsCache) prefsCache = readPrefs();
    return prefsCache;
  },
  getServerSnapshot(): DocumentsPrefs {
    return DEFAULT_PREFS;
  },
  set(next: DocumentsPrefs) {
    prefsCache = next;
    writePrefs(next);
    prefsListeners.forEach((callback) => callback());
  },
};

export function writePrefs(prefs: DocumentsPrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private window or blocked storage — the session still works, it just
    // will not be remembered.
  }
}
export const VIEW_MODE_KEY = "documents:view";
export const viewModeListeners = new Set<() => void>();
export const viewModeStore = {
  subscribe(callback: () => void) {
    viewModeListeners.add(callback);
    return () => {
      viewModeListeners.delete(callback);
    };
  },
  get(): DocumentsViewMode {
    try {
      return window.localStorage.getItem(VIEW_MODE_KEY) === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  },
  set(next: DocumentsViewMode) {
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, next);
    } catch {
      // The choice just won't survive a reload.
    }
    viewModeListeners.forEach((callback) => callback());
  },
};

