"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { toHebrewError } from "@/lib/error-messages";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { DateInput } from "@/components/ui/date-input";
import {
  norm,
  parseAmount,
  parseDateToIso,
  parseStatementLines,
  detectHeaderRow,
  extractCardName,
  findColumn,
  findBankDateColumn,
  findStatementTotal,
  nextChargeDate,
  isRealCardLabel,
  FIELD_TOKENS,
  type ParsedTxn,
  type MerchantMemory,
  type KnownCard,
} from "@/lib/financial/cardImport";
import { extractPdfLines } from "@/lib/financial/pdfStatement";

type Option = { id: string; name: string };
type Sheet = { name: string; rows: string[][] };

type ReviewRow = {
  include: boolean; // saved on the row; governs later expense creation
  expenseDate: string; // ISO yyyy-mm-dd (bank charge date); "" → the card group's chosen date
  txnDate: string; // ISO yyyy-mm-dd (transaction date)
  amount: number;
  description: string;
  notes: string;
  card: string; // detected card key ("" if none — must be assigned before saving)
  assignmentRaw: string; // original שיוך text from the sheet (persisted as reference)
  businessDomain: string; // pre-resolved head-start (assigned for real on the statement page)
  projectId: string;
  propertyId: string;
};

// The lines of one card, as the review step's "כרטיסים בקובץ" box shows them.
type CardGroup = {
  key: string; // ReviewRow.card
  count: number;
  totalAgorot: number;
  latestTxn: string; // latest purchase date, for suggesting the bank date
  needsDate: boolean; // some line has no bank date of its own
};

const NEW_CARD = "__new__";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Lines with no card, or only the generic "כרטיס אשראי", share the "" group, which
// must be given a real card before saving.
const cardKeyOf = (label: unknown) => (isRealCardLabel(label) ? String(label).trim() : "");

// ── Parsing helpers ─────────────────────────────────────────────────────────
// norm / parseAmount / parseDateToIso / parseStatementLines / detectHeaderRow /
// extractCardName / findColumn / findBankDateColumn / findStatementTotal /
// nextChargeDate / FIELD_TOKENS live in @/lib/financial/cardImport (pure + unit-tested).

type Assignment = { include?: boolean; businessDomain?: string; projectId?: string; propertyId?: string };

// Map the spreadsheet's own שיוך value → a domain (+ project/property), so the user's
// existing assignments pre-fill as a head-start (they finalize them on the statement page).
function mapAssignment(value: string, projects: Option[], properties: Option[]): Assignment {
  const v = norm(value);
  if (!v) return {};
  // "Don't document" markers — including a plain X — leave the row's include off.
  if (v.includes("לא לתעד") || v === "ללא תיעוד" || v === "אל תתעד" || v === "לא" || v.toLowerCase() === "x" || v === "✗" || v === "✖")
    return { include: false };
  if (v === "בית") return { businessDomain: "home" };
  if (v === "צדקה") return { businessDomain: "charity" };
  if (v === "שוטף" || v === "כללי" || v === "עסקי" || v === "כללי עסקי") return { businessDomain: "general_business" };
  if (v === "מכירות") return { businessDomain: "sales" };
  if (v.includes("ניהול נכס") || v === "נכסים" || v === "נכס") return { businessDomain: "property_management" };
  if (v === "פרויקטים" || v === "פרויקט") return { businessDomain: "logistics_projects" };

  const projExact = projects.find((p) => norm(p.name) === v);
  if (projExact) return { businessDomain: "logistics_projects", projectId: projExact.id };
  const propExact = properties.find((p) => norm(p.name) === v);
  if (propExact) return { businessDomain: "property_management", propertyId: propExact.id };

  const projPart = projects.find((p) => {
    const n = norm(p.name);
    return n.length > 1 && (n.includes(v) || v.includes(n));
  });
  if (projPart) return { businessDomain: "logistics_projects", projectId: projPart.id };
  const propPart = properties.find((p) => {
    const n = norm(p.name);
    return n.length > 1 && (n.includes(v) || v.includes(n));
  });
  if (propPart) return { businessDomain: "property_management", propertyId: propPart.id };

  return {};
}

function colLetter(index: number): string {
  let i = index + 1;
  let s = "";
  while (i > 0) {
    const r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

function formatIsoDisplay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(-2)}` : iso;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}

// ── Column-mapping presets ───────────────────────────────────────────────────
// Remember, per card-issuer file layout, which columns the user mapped — keyed by a
// signature of the detected header row — so next month's file maps itself. Stored in
// localStorage (per browser); no server round-trip needed.
type MappingPreset = {
  headerRow: number;
  colDate: number;
  colAmount: number;
  colMerchant: number;
  colTxnDate: number;
  colAssignment: number;
  colCard: number;
};
// Presets saved before the card column existed have no colCard.
type StoredPreset = Omit<MappingPreset, "colCard"> & { colCard?: number };
const PRESET_STORE_KEY = "bizh.cardImportPresets";

function loadPresets(): Record<string, StoredPreset> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(PRESET_STORE_KEY) || "{}") as Record<string, StoredPreset>;
  } catch {
    return {};
  }
}

function savePreset(signature: string, preset: MappingPreset) {
  if (typeof window === "undefined" || !signature) return;
  try {
    const all = loadPresets();
    all[signature] = preset;
    window.localStorage.setItem(PRESET_STORE_KEY, JSON.stringify(all));
  } catch {
    /* ignore quota/availability errors */
  }
}

function sheetSignature(sheet: Sheet): string {
  const hr = detectHeaderRow(sheet.rows);
  const cells = sheet.rows[hr] ?? [];
  return cells
    .map((c) => norm(c))
    .filter(Boolean)
    .join("|")
    .slice(0, 500);
}

// Local pdfjs parse is trusted only when it recovers at least this many transactions;
// below that we fall back to the Claude parser.
const LOCAL_MIN_TXNS = 5;

export default function CardImportClient({
  projects,
  properties,
  smartExtractEnabled,
  merchantMemory,
  knownCards,
}: {
  projects: Option[];
  properties: Option[];
  smartExtractEnabled: boolean;
  merchantMemory: MerchantMemory;
  knownCards: KnownCard[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<"upload" | "map" | "review">("upload");
  const [source, setSource] = useState<"excel" | "pdf">("excel");
  const [fileName, setFileName] = useState<string>("");
  const [fileError, setFileError] = useState<string | null>(null);

  // The uploaded file (Excel or PDF), kept so the save can store it as an attachment.
  const [sourceFile, setSourceFile] = useState<File | null>(null);

  // PDF flow
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfNotice, setPdfNotice] = useState<string | null>(null);

  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [presetApplied, setPresetApplied] = useState(false);
  const [headerRow, setHeaderRow] = useState(0);
  const [colDate, setColDate] = useState(-1);
  const [colAmount, setColAmount] = useState(-1);
  const [colMerchant, setColMerchant] = useState(-1);
  const [colTxnDate, setColTxnDate] = useState(-1);
  const [colAssignment, setColAssignment] = useState(-1);
  const [colCard, setColCard] = useState(-1);

  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [statementTotal, setStatementTotal] = useState<number | null>(null);
  const [cardLabels, setCardLabels] = useState<Record<string, string>>({});
  // The card chosen for the lines that name none: a known card's label, or NEW_CARD.
  const [noCardPick, setNoCardPick] = useState("");
  const [noCardCustom, setNoCardCustom] = useState("");
  // Bank dates typed per card group; a group not in here gets its suggested date.
  const [bankDates, setBankDates] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const currentSheet = sheets[sheetIndex];
  const headerCells = currentSheet?.rows[headerRow] ?? [];
  const columnCount = useMemo(
    () => Math.max(0, ...((currentSheet?.rows ?? []).map((r) => r.length))),
    [currentSheet]
  );
  const cardGroups = useMemo(() => {
    const byKey = new Map<string, CardGroup>();
    for (const r of rows) {
      let g = byKey.get(r.card);
      if (!g) {
        g = { key: r.card, count: 0, totalAgorot: 0, latestTxn: "", needsDate: false };
        byKey.set(r.card, g);
      }
      g.count += 1;
      g.totalAgorot += Math.round(r.amount * 100);
      if (r.txnDate > g.latestTxn) g.latestTxn = r.txnDate;
      if (!r.expenseDate) g.needsDate = true;
    }
    // The lines without a card first — they're the ones that need an answer.
    return [...byKey.values()].sort((a, b) => Number(a.key !== "") - Number(b.key !== ""));
  }, [rows]);
  const knownByKey = useMemo(() => new Map(knownCards.map((c) => [norm(c.label), c])), [knownCards]);

  // The card label a row's group is saved under (card_label and category).
  function groupLabel(key: string): string {
    if (key) return (cardLabels[key] ?? key).trim();
    return noCardPick === NEW_CARD ? noCardCustom.trim() : noCardPick;
  }

  function chargeDayFor(key: string): number | null {
    return knownByKey.get(norm(groupLabel(key)))?.chargeDay ?? null;
  }

  function groupBankDate(g: CardGroup): string {
    if (g.key in bankDates) return bankDates[g.key];
    const day = chargeDayFor(g.key);
    return day ? nextChargeDate(g.latestTxn, day) : "";
  }

  // The date saved as the row's bank charge date ("" until its group has one).
  function rowBankDate(r: ReviewRow): string {
    if (r.expenseDate) return r.expenseDate;
    const g = cardGroups.find((x) => x.key === r.card);
    return g ? groupBankDate(g) : "";
  }

  // What still blocks the save: every group needs a real card and, when its lines
  // carry no bank date, a bank date.
  const missing: string[] = [];
  for (const g of cardGroups) {
    const label = groupLabel(g.key);
    const real = isRealCardLabel(label);
    if (!real) missing.push(g.key ? "שם לכרטיס" : `כרטיס ל־${g.count} שורות`);
    else if (!g.key && noCardPick === NEW_CARD && !/\d{4}/.test(label)) missing.push("4 ספרות של הכרטיס החדש");
    if (g.needsDate && !ISO_DATE.test(groupBankDate(g))) missing.push(`תאריך החיוב בבנק${real ? ` של ${label}` : ""}`);
  }

  // Decide a row's pre-filled assignment: the sheet's שיוך wins; otherwise fall back to what
  // we remember for this merchant. Empty when neither applies — it's finalized later.
  function resolveAssignment(
    description: string,
    sheet: Assignment
  ): { businessDomain: string; projectId: string; propertyId: string } {
    if (sheet.businessDomain) {
      return { businessDomain: sheet.businessDomain, projectId: sheet.projectId ?? "", propertyId: sheet.propertyId ?? "" };
    }
    const mem = merchantMemory[norm(description)];
    if (mem) return { businessDomain: mem.businessDomain, projectId: mem.projectId, propertyId: mem.propertyId };
    return { businessDomain: "", projectId: "", propertyId: "" };
  }

  function applyAutoDetect(sheet: Sheet) {
    const hr = detectHeaderRow(sheet.rows);
    const header = sheet.rows[hr] ?? [];
    const rawPreset = loadPresets()[sheetSignature(sheet)];
    // Trust a remembered preset only if its own header row still has real text
    // in the required columns (the amount and a date) — otherwise it's stale
    // (most likely saved against a misdetected header row, e.g. a card-section
    // divider) and silently mapping blank columns is worse than re-detecting fresh.
    const presetHeader = rawPreset ? sheet.rows[rawPreset.headerRow] ?? [] : [];
    const hasText = (ci: number) => ci >= 0 && String(presetHeader[ci] ?? "").trim().length > 0;
    const presetLooksValid =
      rawPreset != null &&
      hasText(rawPreset.colAmount) &&
      (rawPreset.colDate < 0 || hasText(rawPreset.colDate)) &&
      (hasText(rawPreset.colDate) || hasText(rawPreset.colTxnDate));
    const preset: MappingPreset | undefined =
      rawPreset && presetLooksValid
        ? {
            ...rawPreset,
            // Saved before the bank date was told apart from the purchase date: a file
            // with only a purchase date got that one column as both.
            colDate: rawPreset.colDate === rawPreset.colTxnDate ? -1 : rawPreset.colDate,
            colCard: rawPreset.colCard ?? findColumn(presetHeader, FIELD_TOKENS.card),
          }
        : undefined;
    const m: MappingPreset = preset ?? {
      headerRow: hr,
      colDate: findBankDateColumn(header),
      colAmount: findColumn(header, FIELD_TOKENS.amount),
      colMerchant: findColumn(header, FIELD_TOKENS.merchant),
      colTxnDate: findColumn(header, FIELD_TOKENS.txnDate),
      colAssignment: findColumn(header, FIELD_TOKENS.assignment),
      colCard: findColumn(header, FIELD_TOKENS.card),
    };
    setHeaderRow(m.headerRow);
    setColDate(m.colDate);
    setColAmount(m.colAmount);
    setColMerchant(m.colMerchant);
    setColTxnDate(m.colTxnDate);
    setColAssignment(m.colAssignment);
    setColCard(m.colCard);
    setPresetApplied(Boolean(preset));
  }

  async function onFile(file: File) {
    setFileError(null);
    setPdfNotice(null);
    setSourceFile(file);
    clearCardChoices();
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (isPdf) {
      await onPdf(file);
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const XLSX = await import("xlsx");
      const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
      const parsed: Sheet[] = wb.SheetNames.map((name) => ({
        name,
        rows: XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, raw: false, defval: "" }),
      })).filter((s) => s.rows.length > 0);

      if (parsed.length === 0) {
        setFileError("הקובץ ריק או לא נתמך.");
        return;
      }
      setSource("excel");
      setFileName(file.name);
      setSheets(parsed);
      setSheetIndex(0);
      applyAutoDetect(parsed[0]);
      setStep("map");
    } catch {
      setFileError("קריאת הקובץ נכשלה. ודא/י שזה קובץ Excel או CSV תקין.");
    }
  }

  // PDF: try local text extraction first; fall back to the Claude parser when the local
  // parse is low-confidence or the PDF has no text layer (scanned).
  async function onPdf(file: File) {
    setSource("pdf");
    setFileName(file.name);
    setPdfFile(file);
    setPdfNotice(null);
    setPdfBusy(true);
    try {
      const { lines, hasText } = await extractPdfLines(file);
      if (hasText) {
        const { txns, confidence } = parseStatementLines(lines);
        if (confidence >= LOCAL_MIN_TXNS) {
          loadTxns(txns);
          return;
        }
      }
      if (smartExtractEnabled) {
        setPdfNotice(
          hasText
            ? "לא הצלחנו לקרוא את הדף באופן אמין מקומית. ניתן לנסות חילוץ חכם (הקובץ יישלח לשירות AI חיצוני)."
            : "הקובץ ככל הנראה סרוק (ללא שכבת טקסט). נדרש חילוץ חכם (הקובץ יישלח לשירות AI חיצוני)."
        );
      } else {
        setPdfNotice("לא הצלחנו לקרוא את ה-PDF, וחילוץ חכם אינו מוגדר בשרת. נסה/י להעלות קובץ Excel/CSV.");
      }
    } catch {
      if (smartExtractEnabled) {
        setPdfNotice("קריאת ה-PDF מקומית נכשלה. ניתן לנסות חילוץ חכם (הקובץ יישלח לשירות AI חיצוני).");
      } else {
        setFileError("קריאת ה-PDF נכשלה, וחילוץ חכם אינו מוגדר בשרת.");
      }
    } finally {
      setPdfBusy(false);
    }
  }

  async function runSmartExtract() {
    if (!pdfFile || pdfBusy) return;
    setPdfBusy(true);
    setPdfNotice(null);
    setFileError(null);
    try {
      const fd = new FormData();
      fd.append("file", pdfFile);
      const res = await fetch("/api/expenses/parse-statement-pdf", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { transactions?: ParsedTxn[]; error?: string };
      if (!res.ok) {
        setPdfNotice(toHebrewError(data.error, "החילוץ החכם נכשל."));
        return;
      }
      const txns = data.transactions ?? [];
      if (txns.length === 0) {
        setPdfNotice("לא זוהו עסקאות בקובץ.");
        return;
      }
      loadTxns(txns);
    } catch {
      setPdfNotice("החילוץ החכם נכשל.");
    } finally {
      setPdfBusy(false);
    }
  }

  function clearCardChoices() {
    setNoCardPick("");
    setNoCardCustom("");
    setBankDates({});
  }

  // Build review rows from normalized transactions (PDF paths). expense_date is the
  // billing date (cash-flow correct) — a line without one gets its card's bank date,
  // chosen in the review step, never its purchase date.
  function loadTxns(txns: ParsedTxn[]) {
    const labels: Record<string, string> = {};
    const out: ReviewRow[] = txns
      .filter((t) => Number.isFinite(t.amount) && t.amount !== 0 && (t.billingDate || t.txnDate))
      .map((t) => {
        const card = cardKeyOf(t.card);
        if (card && !(card in labels)) labels[card] = card;
        const noteParts: string[] = [];
        if (t.txnDate) noteParts.push(`תאריך עסקה: ${formatIsoDisplay(t.txnDate)}`);
        if (t.installment) noteParts.push(`תשלום ${t.installment}`);
        if (t.currency && t.originalAmount != null) noteParts.push(`${t.originalAmount} ${t.currency}`);
        const description = t.merchant || "ללא שם";
        const resolved = resolveAssignment(description, {});
        return {
          // Refunds too: the statement page records them as income in their domain.
          include: true,
          expenseDate: t.billingDate || "",
          txnDate: t.txnDate,
          amount: t.amount,
          description,
          notes: noteParts.join(" · "),
          card,
          assignmentRaw: "",
          businessDomain: resolved.businessDomain,
          projectId: resolved.projectId,
          propertyId: resolved.propertyId,
        };
      });
    setCardLabels(labels);
    setRows(out);
    setSkippedCount(0);
    setStatementTotal(null);
    setStep("review");
    setPdfNotice(null);
  }

  function selectSheet(idx: number) {
    setSheetIndex(idx);
    applyAutoDetect(sheets[idx]);
  }

  function buildReview() {
    const sheet = sheets[sheetIndex];
    if (!sheet) return;
    // Remember this layout so the same issuer's next file maps itself.
    savePreset(sheetSignature(sheet), { headerRow, colDate, colAmount, colMerchant, colTxnDate, colAssignment, colCard });
    const out: ReviewRow[] = [];
    const labels: Record<string, string> = {};
    let currentCard = "";
    let skipped = 0;

    sheet.rows.forEach((r, rowIndex) => {
      const sectionCard = extractCardName(r);
      if (sectionCard) {
        currentCard = sectionCard;
        return;
      }
      const amount = parseAmount(colAmount >= 0 ? r[colAmount] : "");
      const bankDate = colDate >= 0 ? parseDateToIso(r[colDate]) : null;
      const txn = colTxnDate >= 0 ? parseDateToIso(r[colTxnDate]) : null;
      // With a bank-date column a line needs its bank date, as always. Without one the
      // purchase date carries the line, and the bank date is chosen per card in review.
      if (!Number.isFinite(amount) || amount === 0 || !(colDate >= 0 ? bankDate : txn)) {
        // Count non-empty rows that were dropped — not blank rows, header rows, or the
        // account lines and titles above the header (Mercantile has six).
        const hasContent = r.some((cell) => String(cell ?? "").trim().length > 0);
        const looksLikeHeader = hasContent && findColumn(r, FIELD_TOKENS.date) >= 0 && findColumn(r, FIELD_TOKENS.amount) >= 0;
        if (rowIndex > headerRow && hasContent && !looksLikeHeader) skipped++;
        return;
      }

      const description = (colMerchant >= 0 ? String(r[colMerchant] ?? "").trim() : "") || "ללא שם";
      const assignmentRaw = colAssignment >= 0 ? String(r[colAssignment] ?? "").trim() : "";
      const assign = colAssignment >= 0 ? mapAssignment(assignmentRaw, projects, properties) : {};
      const resolved = resolveAssignment(description, assign);
      // The line's own card cell wins; otherwise the card of the Cal section it's in.
      const card = cardKeyOf(colCard >= 0 ? r[colCard] : "") || cardKeyOf(currentCard);
      if (card && !(card in labels)) labels[card] = card;

      out.push({
        // Refunds too: the statement page records them as income in their domain.
        include: assign.include !== false,
        expenseDate: bankDate ?? "",
        txnDate: txn ?? "",
        amount,
        description,
        notes: txn ? `תאריך עסקה: ${formatIsoDisplay(txn)}` : "",
        card,
        assignmentRaw,
        businessDomain: resolved.businessDomain,
        projectId: resolved.projectId,
        propertyId: resolved.propertyId,
      });
    });

    setCardLabels(labels);
    setRows(out);
    setSkippedCount(skipped);
    setStatementTotal(findStatementTotal(sheet.rows, headerRow));
    setStep("review");
  }

  const includedCount = rows.filter((r) => r.include).length;
  // Show the original שיוך value as a reference only when the sheet had that column.
  const showAssignmentRef = rows.some((r) => r.assignmentRaw);
  const refundCount = rows.filter((r) => r.amount < 0 && r.include).length;
  const linesAgorot = rows.reduce((sum, r) => sum + Math.round(r.amount * 100), 0);
  const mappingReady = colAmount >= 0 && (colDate >= 0 || colTxnDate >= 0);

  async function doSave() {
    if (saving) return;
    setSaveError(null);
    if (rows.length === 0) {
      setSaveError("אין שורות לשמירה.");
      return;
    }
    if (missing.length > 0) return;
    setSaving(true);
    let documentId: string | null = null;
    try {
      // Save the original file as an attachment (best-effort — the save proceeds regardless).
      let storageKey: string | null = null;
      if (sourceFile) {
        try {
          const fd = new FormData();
          fd.append("file", sourceFile);
          const upRes = await fetch("/api/expenses/statement-file", { method: "POST", body: fd });
          if (upRes.ok) {
            const up = (await upRes.json().catch(() => ({}))) as { document_id?: string; storage_key?: string };
            documentId = up.document_id ?? null;
            storageKey = up.storage_key ?? null;
          }
        } catch {
          /* keep saving even if the file upload fails */
        }
      }

      const payload = {
        rows: rows.map((r) => ({
          expense_date: rowBankDate(r),
          transaction_date: r.txnDate || null,
          amount: r.amount,
          description: r.description,
          category: groupLabel(r.card),
          // Stable card identity, snapshotted once here — never re-derived
          // from category again, so a later category edit can't create a
          // phantom card group (see the card_label migration).
          card_label: groupLabel(r.card),
          business_domain: r.businessDomain || null,
          project_id: r.businessDomain === "logistics_projects" ? r.projectId || null : null,
          property_id: r.businessDomain === "property_management" ? r.propertyId || null : null,
          notes: r.notes || null,
          assignment_raw: r.assignmentRaw || null,
          include: r.include,
        })),
        statement: {
          file_name: fileName,
          source,
          document_id: documentId,
          storage_key: storageKey,
          total_rows: rows.length,
        },
      };
      const res = await fetch("/api/expenses/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { statement_id?: string; error?: string };
      if (!res.ok || !data.statement_id) {
        await discardUploadedStatementFile(documentId);
        setSaveError(toHebrewError(data.error, "שמירת הדף נכשלה."));
        setSaving(false);
        return;
      }
      // Off to the statement page to assign domains and create the expenses.
      router.push(`/financial/statements/${data.statement_id}`);
    } catch {
      await discardUploadedStatementFile(documentId);
      setSaveError("שמירת הדף נכשלה.");
      setSaving(false);
    }
  }

  /** Best-effort cleanup of the statement file when the import that was meant
   *  to claim it never completed. Failing here is not worth surfacing — the
   *  user already has a save error, and the worst case is one stray document. */
  async function discardUploadedStatementFile(documentId: string | null) {
    if (!documentId) return;
    try {
      await fetch("/api/documents/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document_id: documentId }),
      });
    } catch {
      /* leave it; the archive's unlinked view is the backstop */
    }
  }

  function reset() {
    setStep("upload");
    setSource("excel");
    setSourceFile(null);
    setPresetApplied(false);
    setSheets([]);
    setRows([]);
    setStatementTotal(null);
    clearCardChoices();
    setFileName("");
    setSaveError(null);
    setPdfFile(null);
    setPdfBusy(false);
    setPdfNotice(null);
  }

  return (
    <div className="space-y-4 text-right" dir="rtl">
      {/* Wraps: on a phone the two buttons beside the heading ran off the
          screen's edge ("חזרה לפיננסי" was cut off). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-lg font-semibold">העלאת פירוט אשראי</h1>
          <p className="text-sm text-muted-foreground">
            העלאת Excel/CSV/PDF ושמירת הפירוט. שיוך התחומים העסקיים ויצירת ההוצאות נעשים אחר כך בעמוד הפירוט.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/financial/statements">פירוטים שנשמרו</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/financial">חזרה לפיננסי</Link>
          </Button>
        </div>
      </div>

      {/* STEP 1 — UPLOAD */}
      {step === "upload" ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            <label className="text-sm font-medium">בחר/י קובץ Excel, CSV או PDF</label>
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.pdf"
              disabled={pdfBusy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
              className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-primary-foreground hover:file:opacity-90 disabled:opacity-50"
            />
            {fileError ? <p className="text-sm text-destructive">{fileError}</p> : null}

            {/* PDF status / smart-extraction fallback */}
            {source === "pdf" && (pdfBusy || pdfNotice) ? (
              <div className="space-y-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <div className="text-muted-foreground">קובץ: {fileName}</div>
                {pdfBusy ? (
                  <div className="text-muted-foreground">מעבד את ה-PDF…</div>
                ) : (
                  <>
                    {pdfNotice ? <div className="text-warning-soft-foreground">{pdfNotice}</div> : null}
                    {smartExtractEnabled && pdfFile ? (
                      <Button size="sm" onClick={() => void runSmartExtract()} disabled={pdfBusy}>
                        חילוץ חכם (AI)
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Excel/CSV: קובץ עם כמה כרטיסים נתמך — כל כרטיס מזוהה לפי שורת הכותרת שלו או לפי עמודת כרטיס, וכל שורה
              מקבלת את שם הכרטיס כקטגוריה. אם קיימת עמודת &quot;שיוך&quot;, היא תישמר כעמודת ייחוס וגם תמלא מראש את הבחירה.
              {" "}PDF: ננסה לקרוא את הדף ישירות
              {smartExtractEnabled ? ", ובמקרה הצורך נציע חילוץ חכם (הקובץ יישלח לשירות AI חיצוני)." : " (חילוץ חכם אינו מוגדר בשרת)."}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* STEP 2 — MAP COLUMNS */}
      {step === "map" && currentSheet ? (
        <Card>
          <CardContent className="space-y-4 py-5">
            <div className="text-sm text-muted-foreground">קובץ: {fileName}</div>
            {presetApplied ? (
              <div className="rounded-md border bg-info-soft/15 px-3 py-1.5 text-xs text-info-soft-foreground">
                המיפוי מולא אוטומטית לפי קובץ קודם מאותו מבנה (ניתן לשנות).
              </div>
            ) : null}

            {sheets.length > 1 ? (
              <div className="space-y-1">
                <label className="text-sm font-medium">גיליון</label>
                <NativeSelect dense
                  value={sheetIndex}
                  onChange={(e) => selectSheet(Number(e.target.value))} className="max-w-xs"
                >
                  {sheets.map((s, i) => (
                    <option key={i} value={i}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">שורת כותרת</label>
                <input
                  type="text"
                  inputMode="numeric"
                  min={1}
                  value={headerRow + 1}
                  onChange={(e) => setHeaderRow(Math.max(0, (Number(e.target.value.replace(/[^\d]/g, "")) || 1) - 1))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <ColumnSelect label="עמודת סכום (חיוב) *" value={colAmount} onChange={setColAmount} headerCells={headerCells} columnCount={columnCount} />
              <ColumnSelect label="עמודת תאריך חיוב (אם יש)" value={colDate} onChange={setColDate} headerCells={headerCells} columnCount={columnCount} optional />
              <ColumnSelect label="עמודת תאריך עסקה" value={colTxnDate} onChange={setColTxnDate} headerCells={headerCells} columnCount={columnCount} optional />
              <ColumnSelect label="עמודת שם בית עסק" value={colMerchant} onChange={setColMerchant} headerCells={headerCells} columnCount={columnCount} optional />
              <ColumnSelect label="עמודת כרטיס" value={colCard} onChange={setColCard} headerCells={headerCells} columnCount={columnCount} optional />
              <ColumnSelect label="עמודת שיוך (ייחוס + מילוי מראש)" value={colAssignment} onChange={setColAssignment} headerCells={headerCells} columnCount={columnCount} optional />
            </div>
            {colDate < 0 && colTxnDate >= 0 ? (
              <p className="text-xs text-muted-foreground">
                בקובץ אין תאריך חיוב — את תאריך החיוב בבנק בוחרים בשלב הבא, לכל כרטיס.
              </p>
            ) : null}

            <div className="max-h-56 overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <tbody>
                  {currentSheet.rows.slice(headerRow, headerRow + 6).map((r, ri) => (
                    <tr key={ri} className={ri === 0 ? "sticky top-0 bg-muted font-medium" : "border-t"}>
                      {Array.from({ length: columnCount }).map((_, ci) => (
                        <td key={ci} className="whitespace-nowrap px-2 py-1">
                          {String(r[ci] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-2">
              <Button onClick={buildReview} disabled={!mappingReady}>
                המשך לתצוגה מקדימה
              </Button>
              <Button variant="outline" onClick={reset}>
                החלפת קובץ
              </Button>
            </div>
            {!mappingReady ? (
              <p className="text-xs text-muted-foreground">יש לבחור עמודת סכום ולפחות עמודת תאריך אחת (חיוב או עסקה).</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* STEP 3 — PREVIEW & SAVE */}
      {step === "review" ? (
        <div className="space-y-3">
          {rows.length === 0 ? (
            <Card>
              <CardContent className="space-y-3 py-6 text-sm">
                <div className="text-muted-foreground">
                  {source === "pdf" ? "לא זוהו עסקאות בקובץ." : "לא נמצאו שורות תקינות (תאריך + סכום) לפי המיפוי שנבחר."}
                </div>
                <Button variant="outline" onClick={() => (source === "pdf" ? reset() : setStep("map"))}>
                  {source === "pdf" ? "החלפת קובץ" : "חזרה למיפוי עמודות"}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardContent className="space-y-2 py-3">
                  <div className="text-sm font-medium">כרטיסים בקובץ (שם הכרטיס = קטגוריה)</div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {cardGroups.map((g) => {
                      const label = groupLabel(g.key);
                      const chargeDay = chargeDayFor(g.key);
                      const customLacksDigits =
                        !g.key && noCardPick === NEW_CARD && noCardCustom.trim() !== "" && !/\d{4}/.test(noCardCustom);
                      return (
                        <div
                          key={g.key || "__none__"}
                          className={
                            g.key
                              ? "space-y-2 rounded-md border p-2"
                              : "space-y-2 rounded-md border border-warning/40 bg-warning-soft/20 p-2"
                          }
                        >
                          {g.key ? (
                            <Input
                              value={cardLabels[g.key] ?? g.key}
                              onChange={(e) => setCardLabels((prev) => ({ ...prev, [g.key]: e.target.value }))}
                              aria-label="שם הכרטיס"
                              className="h-8 text-sm"
                            />
                          ) : (
                            <>
                              <div className="text-sm font-medium text-warning-soft-foreground">
                                {g.count} שורות בלי כרטיס — לאיזה כרטיס הן שייכות?
                              </div>
                              <NativeSelect
                                dense
                                value={noCardPick}
                                onChange={(e) => setNoCardPick(e.target.value)}
                                aria-label="כרטיס לשורות בלי כרטיס"
                              >
                                <option value="">— בחר/י כרטיס —</option>
                                {knownCards.map((c) => (
                                  <option key={c.label} value={c.label}>
                                    {c.accountName ? `${c.label} · ${c.accountName}` : c.label}
                                  </option>
                                ))}
                                <option value={NEW_CARD}>כרטיס חדש…</option>
                              </NativeSelect>
                              {noCardPick === NEW_CARD ? (
                                <Input
                                  value={noCardCustom}
                                  onChange={(e) => setNoCardCustom(e.target.value)}
                                  placeholder="למשל: ויזה כאל זהב 9557"
                                  aria-label="שם הכרטיס החדש"
                                  className="h-8 text-sm"
                                />
                              ) : null}
                              {customLacksDigits ? (
                                <p className="text-xs text-destructive">יש לכלול את 4 הספרות של הכרטיס.</p>
                              ) : null}
                            </>
                          )}
                          <div className="text-xs text-muted-foreground">
                            {g.count} שורות · {formatCurrency(g.totalAgorot / 100)}
                          </div>
                          {g.needsDate ? (
                            <Field label="תאריך החיוב בבנק" required size="xs">
                              <DateInput
                                value={groupBankDate(g)}
                                onChange={(e) => setBankDates((prev) => ({ ...prev, [g.key]: e.target.value }))}
                                aria-label={`תאריך החיוב בבנק${label ? ` של ${label}` : ""}`}
                                className="h-8 text-sm"
                              />
                              {chargeDay ? (
                                <p className="text-xs text-muted-foreground">
                                  לפי החיוב הקודם של הכרטיס: ב־{chargeDay} לחודש
                                </p>
                              ) : null}
                            </Field>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {skippedCount > 0 ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  אזהרה: {skippedCount} שורות בקובץ לא נקראו (תאריך או סכום לא תקין במיפוי הנוכחי). אם הקובץ אמור להכיל יותר שורות — חזור/י למיפוי עמודות ובדוק/י שהעמודות נבחרו נכון.
                </div>
              ) : null}
              {statementTotal !== null ? (
                Math.round(statementTotal * 100) === linesAgorot ? (
                  <div className="rounded-md border bg-success-soft/20 px-3 py-1.5 text-sm text-success-soft-foreground">
                    תואם לסה״כ בקובץ ({formatCurrency(statementTotal)})
                  </div>
                ) : (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    בקובץ כתוב {formatCurrency(statementTotal)}, השורות מסתכמות ב־{formatCurrency(linesAgorot / 100)} — כנראה
                    שורות לא נקראו. חזור/י למיפוי עמודות.
                  </div>
                )
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                  נמצאו {rows.length} שורות · {includedCount} מסומנות לרישום
                  {refundCount > 0 ? ` · ${refundCount} זיכויים יירשמו כהכנסה` : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  כל השורות יישמרו בפירוט. שיוך התחומים ויצירת ההוצאות נעשים בעמוד הפירוט לאחר השמירה.
                </div>
              </div>

              <Card className="overflow-hidden">
                <div className="max-h-[60vh] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                      <tr className="text-right">
                        <th className="px-2 py-2 font-medium">תאריך</th>
                        <th className="px-2 py-2 font-medium">בית עסק</th>
                        <th className="px-2 py-2 font-medium">סכום</th>
                        <th className="px-2 py-2 font-medium">קטגוריה</th>
                        {showAssignmentRef ? <th className="px-2 py-2 font-medium">שיוך מקורי</th> : null}
                        <th className="px-2 py-2 font-medium">לרישום?</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {rows.map((row, index) => {
                        const bankDate = rowBankDate(row);
                        return (
                          <tr key={index} className={row.include ? "" : "opacity-60"}>
                            <td className="whitespace-nowrap px-2 py-2">
                              {/* The date saved as the bank charge date; the purchase date under it. */}
                              <div>{bankDate ? formatIsoDisplay(bankDate) : "—"}</div>
                              {row.txnDate ? (
                                <div className="text-xs text-muted-foreground">עסקה {formatIsoDisplay(row.txnDate)}</div>
                              ) : null}
                            </td>
                            <td className="px-2 py-2">{row.description}</td>
                            <td className="whitespace-nowrap px-2 py-2 font-medium">
                              <span className={row.amount < 0 ? "text-success-soft-foreground" : ""}>
                                {formatCurrency(row.amount)}
                              </span>
                              {row.amount < 0 ? (
                                <span
                                  title="זיכוי/החזר — יירשם כהכנסה בתחום שלו"
                                  className="ms-1 inline-block rounded bg-success-soft px-1 py-0.5 text-[0.588rem] font-medium text-success-soft-foreground"
                                >
                                  זיכוי
                                </span>
                              ) : null}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2 text-xs text-muted-foreground">
                              {groupLabel(row.card) || "—"}
                            </td>
                            {showAssignmentRef ? (
                              <td className="whitespace-nowrap px-2 py-2 text-xs text-muted-foreground">{row.assignmentRaw || "—"}</td>
                            ) : null}
                            <td className="px-2 py-2">
                              <input
                                type="checkbox"
                                checked={row.include}
                                onChange={(e) =>
                                  setRows((prev) => prev.map((r, i) => (i === index ? { ...r, include: e.target.checked } : r)))
                                }
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
              {missing.length > 0 ? (
                <p className="text-xs text-muted-foreground">לפני השמירה חסר: {missing.join(" · ")}</p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void doSave()} disabled={saving || missing.length > 0}>
                  {saving ? "שומר..." : `שמירת פירוט אשראי (${rows.length} שורות)`}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => (source === "pdf" ? reset() : setStep("map"))}
                  disabled={saving}
                >
                  {source === "pdf" ? "החלפת קובץ" : "חזרה למיפוי"}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ColumnSelect({
  label,
  value,
  onChange,
  headerCells,
  columnCount,
  optional,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  headerCells: string[];
  columnCount: number;
  optional?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      <NativeSelect dense
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        <option value={-1}>{optional ? "— ללא —" : "— בחר —"}</option>
        {Array.from({ length: columnCount }).map((_, ci) => (
          <option key={ci} value={ci}>
            {colLetter(ci)} — {String(headerCells[ci] ?? "").trim() || "(ריק)"}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
