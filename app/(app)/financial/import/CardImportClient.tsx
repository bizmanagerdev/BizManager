"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { toHebrewError } from "@/lib/error-messages";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { DateInput } from "@/components/ui/date-input";
import { WizardStepper, type WizardStepDef } from "@/components/ui/step-wizard";
import { CheckIcon, UploadIcon } from "@/components/ui/icons";
import { PanelTitle, STATUS_CHIP as chip } from "@/components/financial/statement-ui";
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
import ImportNotes from "./ImportNotes";
import { formatShortDate } from "@/lib/date";

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

type ImportStep = "upload" | "map" | "review";
const STEP_LABELS: Record<ImportStep, string> = { upload: "קובץ", map: "עמודות", review: "בדיקה ושמירה" };
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
  return formatShortDate(iso, "");
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
  const [step, setStep] = useState<ImportStep>("upload");
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
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // ── The page ────────────────────────────────────────────────────────────────
  // Built like the statement page it leads to: a header with the file's name, then
  // one card with the step bar and the panel of the step on screen (one main button
  // each), and the lines under it. A PDF has no columns step.
  const stepIds: ImportStep[] = source === "pdf" ? ["upload", "review"] : ["upload", "map", "review"];
  const stepDefs: WizardStepDef<ImportStep>[] = stepIds.map((n) => ({ n, label: STEP_LABELS[n] }));
  const fileLoaded = sheets.length > 0 || rows.length > 0;
  const stepDone = (n: ImportStep) =>
    n === "upload" ? fileLoaded : n === "map" ? source === "excel" && step === "review" && rows.length > 0 : false;
  const canOpenStep = (n: ImportStep) =>
    !saving && (n === "upload" || (n === "map" ? source === "excel" && sheets.length > 0 : rows.length > 0));
  const excludedCount = rows.filter((r) => !r.include).length;
  const purchasesToRecord = rows.filter((r) => r.include && r.amount > 0).length;
  const totalMatches = statementTotal !== null && Math.round(statementTotal * 100) === linesAgorot;

  // The bank date the file itself gives a card's lines (the one most of them carry).
  function fileBankDate(key: string): string {
    const counts = new Map<string, number>();
    for (const r of rows) if (r.card === key && r.expenseDate) counts.set(r.expenseDate, (counts.get(r.expenseDate) ?? 0) + 1);
    let best = "";
    let bestCount = 0;
    for (const [d, c] of counts) if (c > bestCount) [best, bestCount] = [d, c];
    return best;
  }

  function groupComplete(g: CardGroup): boolean {
    const label = groupLabel(g.key);
    if (!isRealCardLabel(label)) return false;
    if (!g.key && noCardPick === NEW_CARD && !/\d{4}/.test(label)) return false;
    return !g.needsDate || ISO_DATE.test(groupBankDate(g));
  }

  // Which field a file column is mapped to, for the preview's column heads.
  const mappedField = (ci: number): string | null =>
    ci === colAmount
      ? "סכום"
      : ci === colDate
        ? "תאריך חיוב"
        : ci === colTxnDate
          ? "תאריך עסקה"
          : ci === colMerchant
            ? "בית עסק"
            : ci === colCard
              ? "כרטיס"
              : ci === colAssignment
                ? "שיוך"
                : null;

  const headerLine = fileName
    ? [
        source === "pdf" ? "PDF" : "Excel/CSV",
        rows.length > 0 ? `${rows.length} שורות` : null,
        rows.length > 0 ? (cardGroups.length === 1 ? "כרטיס אחד" : `${cardGroups.length} כרטיסים`) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "פירוט חדש. אחרי השמירה ממשיכים בעמוד הפירוט: שיוך, חיוב בבנק וסיום.";

  return (
    <div className="space-y-4 text-right" dir="rtl">
      {/* Wraps: on a phone the buttons beside the heading must not run off the edge. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{fileName || "העלאת פירוט אשראי"}</h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>{headerLine}</span>
            {fileName ? <span className={chip.warn}>טרם נשמר</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {fileName ? (
            <Button variant="outline" size="sm" onClick={reset} disabled={saving}>
              קובץ אחר
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link href="/financial/statements">חזרה לרשימה</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-4 py-4">
          <WizardStepper
            steps={stepDefs}
            current={step}
            canClick={canOpenStep}
            onStepClick={setStep}
            isDone={stepDone}
            className="mx-auto max-w-md"
          />

          {step === "upload" ? (
            <div className="space-y-3">
              <PanelTitle
                title="קובץ"
                hint="הפירוט של החודש מחברת האשראי או מהבנק. הכרטיסים, התאריכים והסכומים נקראים ממנו לבד."
              />
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file && !pdfBusy) void onFile(file);
                }}
                className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
                  dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/20"
                }`}
              >
                <UploadIcon className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm font-medium">גררו את הקובץ לכאן, או</p>
                <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={pdfBusy}>
                  {pdfBusy ? "קורא את הקובץ..." : "בחירת קובץ"}
                </Button>
                <p className="text-xs text-muted-foreground">קובץ Excel, CSV או PDF</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.pdf"
                  className="sr-only"
                  tabIndex={-1}
                  aria-label="בחירת קובץ פירוט"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    // Cleared so picking the same file again still reads it.
                    e.target.value = "";
                    if (file) void onFile(file);
                  }}
                />
              </div>
              {fileName && fileLoaded ? (
                <p className="text-xs text-muted-foreground">הקובץ הנוכחי: {fileName}. בחירת קובץ אחר תחליף אותו.</p>
              ) : null}
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

              <ImportNotes smartExtractEnabled={smartExtractEnabled} />
            </div>
          ) : step === "map" && currentSheet ? (
            <div className="space-y-3">
              <PanelTitle
                title="עמודות"
                hint="זיהינו את העמודות לפי הכותרות בקובץ. בדקו שכל עמודה נכונה — הקובץ הבא באותו מבנה יתמלא לבד."
              />
              {presetApplied ? <span className={chip.info}>מולא לפי קובץ קודם מאותו מבנה</span> : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {sheets.length > 1 ? (
                  <Field size="xs" label="גיליון">
                    <NativeSelect dense value={sheetIndex} onChange={(e) => selectSheet(Number(e.target.value))}>
                      {sheets.map((s, i) => (
                        <option key={i} value={i}>
                          {s.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                ) : null}
                <Field size="xs" label="שורת הכותרות">
                  <Input
                    inputMode="numeric"
                    value={headerRow + 1}
                    onChange={(e) => setHeaderRow(Math.max(0, (Number(e.target.value.replace(/[^\d]/g, "")) || 1) - 1))}
                    className="h-9"
                  />
                </Field>
                <ColumnSelect label="סכום החיוב *" value={colAmount} onChange={setColAmount} headerCells={headerCells} columnCount={columnCount} />
                <ColumnSelect label="תאריך חיוב (אם יש)" value={colDate} onChange={setColDate} headerCells={headerCells} columnCount={columnCount} optional />
                <ColumnSelect label="תאריך עסקה" value={colTxnDate} onChange={setColTxnDate} headerCells={headerCells} columnCount={columnCount} optional />
                <ColumnSelect label="בית עסק" value={colMerchant} onChange={setColMerchant} headerCells={headerCells} columnCount={columnCount} optional />
                <ColumnSelect label="כרטיס" value={colCard} onChange={setColCard} headerCells={headerCells} columnCount={columnCount} optional />
                <ColumnSelect label="שיוך (ממלא מראש)" value={colAssignment} onChange={setColAssignment} headerCells={headerCells} columnCount={columnCount} optional />
              </div>
              {colDate < 0 && colTxnDate >= 0 ? (
                <p className="text-xs text-muted-foreground">בקובץ אין תאריך חיוב — את תאריך החיוב בבנק בוחרים בשלב הבא, לכל כרטיס.</p>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                {mappingReady ? (
                  <span />
                ) : (
                  <span className="text-xs text-destructive">יש לבחור את עמודת הסכום ולפחות עמודת תאריך אחת (חיוב או עסקה).</span>
                )}
                <Button size="sm" onClick={buildReview} disabled={!mappingReady}>
                  המשך לבדיקה
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <PanelTitle
                title="בדיקה ושמירה"
                hint="לכל כרטיס צריך שם עם 4 ספרות ותאריך חיוב בבנק. השיוך לתחומים נעשה אחרי השמירה, בעמוד הפירוט."
              />
              {rows.length === 0 ? (
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">
                    {source === "pdf" ? "לא זוהו עסקאות בקובץ." : "לא נמצאו שורות תקינות (תאריך + סכום) לפי העמודות שנבחרו."}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => (source === "pdf" ? reset() : setStep("map"))}>
                    {source === "pdf" ? "קובץ אחר" : "חזרה לעמודות"}
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <span className={chip.plain}>{rows.length} שורות</span>
                    <span className={chip.info}>{purchasesToRecord} לרישום כהוצאה</span>
                    {refundCount > 0 ? <span className={chip.info}>{refundCount} זיכויים יירשמו כהכנסה</span> : null}
                    {excludedCount > 0 ? <span className={chip.plain}>{excludedCount} לא לתיעוד</span> : null}
                    {statementTotal !== null ? (
                      totalMatches ? (
                        <span className={chip.ok}>תואם לסה״כ בקובץ ({formatCurrency(statementTotal)})</span>
                      ) : (
                        <span className={chip.warn}>לא תואם לסה״כ בקובץ</span>
                      )
                    ) : null}
                    {skippedCount > 0 ? <span className={chip.warn}>{skippedCount} שורות לא נקראו</span> : null}
                  </div>
                  {statementTotal !== null && !totalMatches ? (
                    <p className="rounded-md border border-warning-soft-foreground/40 bg-warning-soft/30 px-3 py-2 text-xs">
                      בקובץ כתוב {formatCurrency(statementTotal)}, השורות מסתכמות ב־{formatCurrency(linesAgorot / 100)} — כנראה שורות
                      לא נקראו. כדאי לבדוק בשלב “עמודות”.
                    </p>
                  ) : null}
                  {skippedCount > 0 ? (
                    <p className="rounded-md border border-warning-soft-foreground/40 bg-warning-soft/30 px-3 py-2 text-xs">
                      {skippedCount} שורות בקובץ לא נקראו (תאריך או סכום לא תקין לפי העמודות שנבחרו). אם הקובץ אמור להכיל עוד
                      שורות — בדקו את שלב “עמודות”.
                    </p>
                  ) : null}

                  <div className="space-y-2">
                    {cardGroups.map((g) => {
                      const label = groupLabel(g.key);
                      const chargeDay = chargeDayFor(g.key);
                      const complete = groupComplete(g);
                      const customLacksDigits =
                        !g.key && noCardPick === NEW_CARD && noCardCustom.trim() !== "" && !/\d{4}/.test(noCardCustom);
                      return (
                        <div
                          key={g.key || "__none__"}
                          className={`rounded-md border px-3 py-2 ${
                            complete
                              ? "border-success-soft-foreground/40 bg-success-soft/15"
                              : !g.key
                                ? "border-warning-soft-foreground/40 bg-warning-soft/20"
                                : ""
                          }`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 basis-56 space-y-1.5">
                              {g.key ? (
                                <Input
                                  value={cardLabels[g.key] ?? g.key}
                                  onChange={(e) => setCardLabels((prev) => ({ ...prev, [g.key]: e.target.value }))}
                                  aria-label="שם הכרטיס"
                                  className="h-8 max-w-xs text-sm font-medium"
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
                                    className="max-w-xs"
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
                                      className="h-8 max-w-xs text-sm"
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
                            </div>
                            <div className="shrink-0">
                              {g.needsDate ? (
                                <Field label="תאריך החיוב בבנק" required size="xs">
                                  <DateInput
                                    value={groupBankDate(g)}
                                    onChange={(e) => setBankDates((prev) => ({ ...prev, [g.key]: e.target.value }))}
                                    aria-label={`תאריך החיוב בבנק${label ? ` של ${label}` : ""}`}
                                    className="h-8 text-sm"
                                  />
                                  {chargeDay ? (
                                    <p className="text-xs text-muted-foreground">לפי החיוב הקודם של הכרטיס: ב־{chargeDay} לחודש</p>
                                  ) : null}
                                </Field>
                              ) : fileBankDate(g.key) ? (
                                <span className={chip.ok}>חיוב בבנק {formatIsoDisplay(fileBankDate(g.key))} (מהקובץ)</span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                    {missing.length > 0 ? (
                      <p className="text-sm">
                        <span className="font-medium">עוד חסר: </span>
                        <span className="text-destructive">{missing.join(" · ")}</span>
                      </p>
                    ) : (
                      <p className="text-sm text-success-soft-foreground">
                        <CheckIcon className="inline h-4 w-4 align-text-bottom" /> הכל מוכן לשמירה.
                      </p>
                    )}
                    <Button size="sm" onClick={() => void doSave()} disabled={saving || missing.length > 0}>
                      {saving ? "שומר..." : `שמירת פירוט אשראי (${rows.length} שורות)`}
                    </Button>
                  </div>
                  {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* The file itself under the columns step, its head marked with what each column was read as. */}
      {step === "map" && currentSheet ? (
        <Card className="overflow-hidden">
          <div className="border-b px-3 py-2 text-xs text-muted-foreground">תחילת הקובץ, מהשורה {headerRow + 1}</div>
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-muted-foreground">
                <tr className="text-right">
                  {Array.from({ length: columnCount }).map((_, ci) => {
                    const field = mappedField(ci);
                    return (
                      <th key={ci} className="whitespace-nowrap px-3 py-2 align-top font-medium">
                        <div>
                          {colLetter(ci)} · {String(headerCells[ci] ?? "").trim() || "(ריק)"}
                        </div>
                        {field ? <span className={chip.info}>{field}</span> : null}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y">
                {currentSheet.rows.slice(headerRow + 1, headerRow + 9).map((r, ri) => (
                  <tr key={ri}>
                    {Array.from({ length: columnCount }).map((_, ci) => (
                      <td key={ci} className="whitespace-nowrap px-3 py-2">
                        {String(r[ci] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* The lines, as the statement page will show them. */}
      {step === "review" && rows.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                <tr className="text-right">
                  <th className="px-3 py-2 font-medium">סטטוס</th>
                  <th className="px-3 py-2 font-medium">תאריך</th>
                  <th className="px-3 py-2 font-medium">בית עסק</th>
                  <th className="px-3 py-2 font-medium">סכום</th>
                  <th className="px-3 py-2 font-medium">כרטיס</th>
                  {showAssignmentRef ? <th className="px-3 py-2 font-medium">שיוך מקורי</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row, index) => {
                  const bankDate = rowBankDate(row);
                  const isRefund = row.amount < 0;
                  return (
                    <tr key={index} className={`align-top ${row.include ? "" : "opacity-50"}`}>
                      <td className="px-3 py-2">
                        <div className="space-y-1">
                          <label className="flex items-center gap-1 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={row.include}
                              onChange={(e) =>
                                setRows((prev) => prev.map((r, i) => (i === index ? { ...r, include: e.target.checked } : r)))
                              }
                            />
                            {isRefund ? "להכנסה" : "להוצאה"}
                          </label>
                          {isRefund ? (
                            <span
                              title="זיכוי/החזר — יירשם כהכנסה בתחום שלו"
                              className="inline-block rounded bg-info-soft px-1.5 py-0.5 text-[0.647rem] font-medium text-info-soft-foreground"
                            >
                              זיכוי
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {/* The date saved as the bank charge date; the purchase date under it. */}
                        <div>{bankDate ? formatIsoDisplay(bankDate) : "—"}</div>
                        {row.txnDate ? <div className="text-xs text-muted-foreground">עסקה {formatIsoDisplay(row.txnDate)}</div> : null}
                      </td>
                      <td className="px-3 py-2">{row.description}</td>
                      <td className={`whitespace-nowrap px-3 py-2 font-medium ${isRefund ? "text-success-soft-foreground" : ""}`}>
                        {formatCurrency(row.amount)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{groupLabel(row.card) || "—"}</td>
                      {showAssignmentRef ? (
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{row.assignmentRaw || "—"}</td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
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
    <Field size="xs" label={label}>
      <NativeSelect dense value={value} onChange={(e) => onChange(Number(e.target.value))}>
        <option value={-1}>{optional ? "— ללא —" : "— בחר —"}</option>
        {Array.from({ length: columnCount }).map((_, ci) => (
          <option key={ci} value={ci}>
            {colLetter(ci)} — {String(headerCells[ci] ?? "").trim() || "(ריק)"}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}
