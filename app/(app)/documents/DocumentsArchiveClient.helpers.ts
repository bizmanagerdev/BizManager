import { DOCUMENT_CATEGORIES, getDocumentCategoryLabel } from "@/lib/documents";
import { getBusinessDomainLabel } from "@/lib/expenses";
import { formatShortDateTime } from "@/lib/date";
import type { DocumentArchiveItem } from "@/lib/documents/archive";

// ────────────────────────────────────────────────────────────────────────────
// The archive's pure logic: how documents sort, group, collapse and pack.
//
// Split out of the page component, which had grown past three thousand lines.
// Nothing here touches React or the DOM, which is the point — this is the part
// worth testing, and it can be tested without rendering anything.
// ────────────────────────────────────────────────────────────────────────────

export function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

// Sentinel filter value that matches all system/auto-generated document types
// (delivery photos, card statements, session attachments, Morning docs, …) —
// i.e. any document_type that isn't one of the controlled DOCUMENT_CATEGORIES.
export const SYSTEM_CATEGORY_FILTER = "__system__";
export const UNCATEGORIZED_FILTER = "__none__";


// Sorting is separate from grouping: grouping decides what sits together,
// this decides the order inside. Always returns a new array — the caller's
// list is the memoised filter result and must not be mutated.
/** Section order, governed by the same מיון choice as the documents inside, so
 *  the page has ONE ordering rule rather than a visible one and a hidden one. */
export function compareGroups(
  a: { label: string; items: DocumentArchiveItem[] },
  b: { label: string; items: DocumentArchiveItem[] },
  sortBy: string
): number {
  const newest = (g: { items: DocumentArchiveItem[] }) =>
    g.items.reduce((max, d) => (String(d.uploaded_at ?? "") > max ? String(d.uploaded_at ?? "") : max), "");
  const oldest = (g: { items: DocumentArchiveItem[] }) =>
    g.items.reduce(
      (min, d) => (min === "" || String(d.uploaded_at ?? "") < min ? String(d.uploaded_at ?? "") : min),
      ""
    );

  if (sortBy === "newest") return newest(b).localeCompare(newest(a));
  if (sortBy === "oldest") return oldest(a).localeCompare(oldest(b));
  if (sortBy === "name" || sortBy === "category") return a.label.localeCompare(b.label, "he");
  return newest(b).localeCompare(newest(a));
}

export const GROUP_BY_OPTIONS: Record<string, string> = {
  entity: "לפי שיוך",
  type: "לפי קטגוריה",
  customer: "לפי לקוח",
  domain: "לפי תחום",
  date: "לפי חודש",
  kind: "לפי סוג קובץ",
};

export const SORT_BY_OPTIONS: Record<string, string> = {
  expiry: "תוקף קרוב",
  newest: "החדשים",
  oldest: "הישנים",
  name: "לפי שם",
  category: "לפי קטגוריה",
};

export type FacetOption = { key: string; label: string; count: number };

export function facetTriggerLabel(name: string, selected: Set<string>, options: FacetOption[]): string {
  if (selected.size === 0) return name;
  if (selected.size === 1) {
    const only = options.find((option) => option.key === Array.from(selected)[0]);
    return only ? `${name}: ${only.label} (${only.count})` : name;
  }
  return `${name}: ${selected.size} נבחרו`;
}

/** Milliseconds, or null when there is no usable date. Exported for the tests
 *  that pin the ordering. */
/**
 * What makes two documents one card.
 *
 * Two ways, and the second matters more than it looks. THE SAME PAPER, SCANNED
 * TWICE: one car's insurance certificate photographed in three goes, on three
 * different days, is one policy — three cards for it is three times the noise
 * and three chances to renew the wrong one. An entity, a category and a shared
 * expiry date say that as well as anything can.
 *
 * Failing that, ONE UPLOAD: same minute, same category, same entity. Narrow on
 * purpose, so two unrelated files dropped together stay two cards.
 *
 * Note what does NOT merge: the same car's insurance with a LATER date. That is
 * a renewal, not a duplicate, and keeping it apart is what lets the old one be
 * marked הוחלף instead of quietly disappearing.
 */
export function setKeyFor(doc: DocumentArchiveItem) {
  const entity = doc.linked_entities[0]?.id ?? doc.tags[0]?.id ?? "";
  const category = (doc.document_type ?? "").trim();
  if (entity && category && doc.valid_until) {
    return `same|${entity}|${category}|${doc.valid_until}`;
  }
  const minute = (doc.uploaded_at ?? "").slice(0, 16);
  if (!minute) return null;
  return `upload|${minute}|${category}|${entity}`;
}

/** One entry per set: the first document plus everything it stands for, so a
 *  delivery photographed twice is ONE card saying "2 תמונות". */
export function collapseSets(items: DocumentArchiveItem[]) {
  const out: Array<{ lead: DocumentArchiveItem; members: DocumentArchiveItem[] }> = [];
  const byKey = new Map<string, number>();
  for (const doc of items) {
    const key = setKeyFor(doc);
    if (!key) {
      out.push({ lead: doc, members: [doc] });
      continue;
    }
    const at = byKey.get(key);
    if (at === undefined) {
      byKey.set(key, out.length);
      out.push({ lead: doc, members: [doc] });
    } else {
      out[at]!.members.push(doc);
    }
  }
  return out;
}

/**
 * Reorders groups so a row that cannot fit the next one tries the ones just
 * behind it before giving up on the space — usually a single-photo group slides
 * up into the tail of the row above.
 *
 * The lookahead is bounded on purpose. Unbounded packing (CSS grid-auto-flow
 * "dense" does exactly this) will haul a group from far down the page into a
 * two-column hole, and the order you were reading stops meaning anything.
 * Returns the indices to render in.
 */
export function packGroups(spans: number[], columns: number, lookahead = 3): number[] {
  const pending = spans.map((span, index) => ({ span, index }));
  const order: number[] = [];
  let remaining = Math.max(1, columns);
  while (pending.length > 0) {
    let pick = 0;
    if (pending[0]!.span > remaining) {
      pick = -1;
      const limit = Math.min(pending.length, lookahead + 1);
      for (let i = 1; i < limit; i += 1) {
        if (pending[i]!.span <= remaining) {
          pick = i;
          break;
        }
      }
      // Nothing near enough fits — start the next row rather than reaching
      // further down the page for a filler.
      if (pick === -1) {
        remaining = Math.max(1, columns);
        pick = 0;
      }
    }
    const [chosen] = pending.splice(pick, 1);
    order.push(chosen!.index);
    remaining -= chosen!.span;
    if (remaining <= 0) remaining = Math.max(1, columns);
  }
  return order;
}

export function documentTime(doc: { uploaded_at: string | null }): number | null {
  const raw = (doc.uploaded_at ?? "").trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

export function sortDocuments(items: DocumentArchiveItem[], sortBy: string): DocumentArchiveItem[] {
  const copy = [...items];
  // Undated rows sink to the bottom in either direction rather than sorting as
  // if they were from 1970.
  const byTime = (a: DocumentArchiveItem, b: DocumentArchiveItem, newestFirst: boolean) => {
    const at = documentTime(a);
    const bt = documentTime(b);
    if (at === null && bt === null) return 0;
    if (at === null) return 1;
    if (bt === null) return -1;
    return newestFirst ? bt - at : at - bt;
  };
  if (sortBy === "oldest") {
    return copy.sort((a, b) => byTime(a, b, false));
  }
  if (sortBy === "expiry") {
    return copy.sort((a, b) => {
      const av = a.valid_until;
      const bv = b.valid_until;
      if (!av && !bv) return byTime(a, b, true);
      if (!av) return 1;
      if (!bv) return -1;
      return av.localeCompare(bv);
    });
  }
  if (sortBy === "name") {
    return copy.sort((a, b) => a.title.localeCompare(b.title, "he"));
  }
  if (sortBy === "category") {
    return copy.sort((a, b) => {
      const byCategory = getDocumentCategoryLabel(a.document_type).localeCompare(
        getDocumentCategoryLabel(b.document_type),
        "he"
      );
      if (byCategory !== 0) return byCategory;
      return String(b.uploaded_at ?? "").localeCompare(String(a.uploaded_at ?? ""));
    });
  }
  return copy.sort((a, b) => byTime(a, b, true));
}

// The "what is this attached to" axis. Separate from category on purpose — they
// answer different questions and the UI labels them as two groups.

export function isControlledCategory(value: string | null | undefined) {
  return Boolean(value) && (DOCUMENT_CATEGORIES as readonly string[]).includes(value as string);
}

export function formatDate(value: string | null) {
  return formatShortDateTime(value, "—");
}

// Year used for filtering: the explicit "document year" (ref_year, set on upload)
// when present, otherwise the upload year (the date shown on the card).
export function documentYear(doc: DocumentArchiveItem): string {
  if (doc.ref_year && doc.ref_year > 0) return String(doc.ref_year);
  const value = doc.uploaded_at ?? doc.created_at;
  if (!value) return "";
  const year = value.slice(0, 4);
  return /^\d{4}$/.test(year) ? year : "";
}

export function entityTypeLabel(value: string) {
  switch (value) {
    case "project":
      return "פרויקט";
    case "property":
      return "נכס";
    case "task":
      return "משימה";
    case "customer":
      return "לקוח";
    case "order":
      return "הזמנה";
    case "user":
      return "עובד";
    case "vehicle":
      return "רכב";
    case "statement":
      return "דף חיוב";
    case "expense":
      return "הוצאה";
    case "payment":
      return "תשלום";
    case "session":
      return "דיווח שעות";
    case "loan":
      return "הלוואה";
    case "unlinked":
      return "ללא שיוך";
    default:
      return value || "ללא שיוך";
  }
}

export function fileKindLabel(value: string) {
  switch (value) {
    case "pdf":
      return "PDF";
    case "image":
      return "תמונה";
    case "document":
      return "מסמך";
    case "spreadsheet":
      return "גיליון";
    case "presentation":
      return "מצגת";
    case "video":
      return "וידאו";
    case "archive":
      return "ארכיון";
    default:
      return "אחר";
  }
}


export type GroupDropTarget =
  | { kind: "project"; id: string }
  | { kind: "property"; id: string }
  | { kind: "customer"; id: string }
  | { kind: "domain"; value: string }
  | { kind: "category"; value: string };

export function groupDropTarget(
  groupBy: string,
  doc: DocumentArchiveItem
): GroupDropTarget | null {
  if (groupBy === "entity") {
    // Same order groupLabel names them in, limited to the kinds an upload can
    // actually be filed under. A tray named after an order or a vehicle still
    // takes the drop — it just cannot pre-answer the question.
    if (doc.projects[0]) return { kind: "project", id: doc.projects[0].id };
    if (doc.properties[0]) return { kind: "property", id: doc.properties[0].id };
    if (doc.customers[0]) return { kind: "customer", id: doc.customers[0].id };
    return null;
  }
  if (groupBy === "customer") {
    return doc.customers[0] ? { kind: "customer", id: doc.customers[0].id } : null;
  }
  if (groupBy === "domain") {
    const value = doc.business_domains[0];
    return value ? { kind: "domain", value } : null;
  }
  if (groupBy === "type") {
    const value = (doc.document_type ?? "").trim();
    return value ? { kind: "category", value } : null;
  }
  return null;
}

export function groupHref(groupBy: string, doc: DocumentArchiveItem): string | null {
  // Mirrors groupLabel's fallback order, so the link always points at the thing
  // the heading actually named.
  const pick =
    groupBy === "entity"
      ? doc.projects[0] ?? doc.tags[0] ?? doc.properties[0] ?? doc.customers[0] ?? null
      : groupBy === "customer"
        ? doc.customers[0] ?? null
        : null;
  if (!pick) {
    // Only "entity" falls through to a bare linked row, and groupLabel picks the
    // first one that has somewhere to go.
    return groupBy === "entity"
      ? doc.linked_entities.find((entity) => entity.href)?.href ?? null
      : null;
  }
  // Tags carry their own href; everything else is matched back to the link row
  // that knows the URL for its kind.
  return pick.href ?? doc.linked_entities.find((entity) => entity.id === pick.id)?.href ?? null;
}

export function groupLabel(groupBy: string, doc: DocumentArchiveItem) {
  if (groupBy === "entity") {
    // Name the thing itself. Falling back through the anchors people actually
    // remember: the project, then the car, the property, the customer.
    const named =
      doc.projects[0]?.label ??
      doc.tags[0]?.label ??
      doc.properties[0]?.label ??
      doc.customers[0]?.label ??
      doc.linked_entities.find((entity) => entity.href)?.label ??
      null;
    if (named) return named;
    return doc.no_link_needed ? "ללא שיוך נדרש" : "ללא שיוך";
  }

  if (groupBy === "type") return getDocumentCategoryLabel(doc.document_type);
  if (groupBy === "kind") return fileKindLabel(doc.file_kind);
  if (groupBy === "customer") return doc.customers[0]?.label || "ללא לקוח";
  if (groupBy === "domain") return getBusinessDomainLabel(doc.business_domains[0] ?? "general_business");
  if (groupBy === "date") {
    const raw = (doc.uploaded_at ?? "").slice(0, 7);
    if (!raw) return "ללא תאריך";
    const [year, month] = raw.split("-");
    return `${month}/${year}`;
  }
  return "כל המסמכים";
}


/**
 * The half of a document's title the section heading is not already carrying.
 * Titles read "<category> · <entity>"; under a heading naming the entity, the
 * card only needs to say which kind of paper it is.
 */
/**
 * A chip's halves: what kind of thing it is, then which one. The server writes
 * some labels with the kind already in them ("הזמנה · בית גדליה"), so it is
 * stripped before being added back — otherwise the chip stutters.
 */
export function entityChipParts(type: string, label: string): string[] {
  const kind = entityTypeLabel(type);
  const name = label.trim();
  if (!kind) return [name];
  if (name === kind) return [kind];
  if (name.startsWith(kind)) {
    const rest = name.slice(kind.length).replace(/^[\s·:\-–]+/, "").trim();
    return rest ? [kind, rest] : [kind];
  }
  return [kind, name];
}

export function cardTitle(doc: DocumentArchiveItem, groupHeading: string): string {
  const full = doc.title;
  if (!groupHeading) return full;
  const parts = full.split(" · ");
  if (parts.length < 2) return full;
  const trimmed = parts.filter((part) => part !== groupHeading);
  return trimmed.length > 0 ? trimmed.join(" · ") : full;
}
