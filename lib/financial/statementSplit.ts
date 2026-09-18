import { isExpenseBusinessDomain } from "@/lib/expenses";

// Splitting one card-statement line across business domains — e.g. ₪1,000 at
// a supermarket: ₪500 בית, ₪340 מכירות, and the rest to שוטף. The line becomes
// that many lines (and expenses), one per domain, adding up to the original.
// Pure: the dialog and the route both use it, so they can't disagree.

export const MAX_SPLIT_PARTS = 10;

/** One part as the dialog holds it. The last part's amount is ignored — it takes the rest. */
export type SplitPartDraft = { domain: string; amount: string; projectId: string; propertyId: string };

export type SplitPart = {
  domain: string;
  amount: number;
  projectId: string | null;
  propertyId: string | null;
};

const toAgorot = (n: number) => Math.round(n * 100);

/**
 * The parts to save, with the last one taking what the others leave, or the
 * reason they can't be saved yet (in Hebrew, for the dialog).
 */
export function resolveSplit(
  total: number,
  drafts: SplitPartDraft[]
): { parts: SplitPart[]; remainder: number; error: string | null } {
  const others = drafts.slice(0, -1);
  const usedAgorot = others.reduce((sum, d) => sum + (Number.isFinite(Number(d.amount)) ? toAgorot(Number(d.amount)) : 0), 0);
  const remainder = (toAgorot(total) - usedAgorot) / 100;
  const parts: SplitPart[] = drafts.map((d, i) => ({
    domain: d.domain,
    amount: i === drafts.length - 1 ? remainder : Number(d.amount),
    projectId: d.domain === "logistics_projects" && d.projectId ? d.projectId : null,
    propertyId: d.domain === "property_management" && d.propertyId ? d.propertyId : null,
  }));

  let error: string | null = null;
  if (drafts.length < 2) error = "פיצול צריך לפחות שני תחומים.";
  else if (drafts.length > MAX_SPLIT_PARTS) error = `אפשר לפצל לעד ${MAX_SPLIT_PARTS} תחומים.`;
  else if (parts.some((p) => !isExpenseBusinessDomain(p.domain))) error = "יש לבחור תחום לכל חלק.";
  else if (others.some((d) => !(Number(d.amount) > 0))) error = "יש להזין סכום לכל חלק.";
  else if (!(remainder > 0)) error = "הסכומים עוברים את סכום השורה.";
  return { parts, remainder, error };
}

/** Server side: do these parts add up to the line exactly, each positive, each with a domain? */
export function validateSplitParts(total: number, parts: SplitPart[]): string | null {
  if (parts.length < 2) return "פיצול צריך לפחות שני תחומים.";
  if (parts.length > MAX_SPLIT_PARTS) return `אפשר לפצל לעד ${MAX_SPLIT_PARTS} תחומים.`;
  if (parts.some((p) => !isExpenseBusinessDomain(p.domain))) return "יש לבחור תחום לכל חלק.";
  if (parts.some((p) => !(Number.isFinite(p.amount) && p.amount > 0))) return "כל חלק צריך סכום חיובי.";
  const sum = parts.reduce((s, p) => s + toAgorot(p.amount), 0);
  if (sum !== toAgorot(total)) return "סכומי החלקים לא מסתכמים לסכום השורה.";
  return null;
}
