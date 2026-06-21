"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toHebrewError } from "@/lib/error-messages";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  norm,
  parseAmount,
  parseDateToIso,
  parseStatementLines,
  type ParsedTxn,
  type MerchantMemory,
} from "@/lib/financial/cardImport";
import { extractPdfLines } from "@/lib/financial/pdfStatement";

type Option = { id: string; name: string };
type Sheet = { name: string; rows: string[][] };

type ReviewRow = {
  include: boolean; // saved on the row; governs later expense creation
  expenseDate: string; // ISO yyyy-mm-dd (charge date)
  txnDate: string; // ISO yyyy-mm-dd (transaction date)
  amount: number;
  description: string;
  notes: string;
  card: string; // detected card key ("" if none)
  assignmentRaw: string; // original שיוך text from the sheet (persisted as reference)
  businessDomain: string; // pre-resolved head-start (assigned for real on the statement page)
  projectId: string;
  propertyId: string;
};

const FALLBACK_CATEGORY = "כרטיס אשראי";

// ── Parsing helpers ─────────────────────────────────────────────────────────
// norm / parseAmount / parseDateToIso / parseStatementLines live in
// @/lib/financial/cardImport (pure + unit-tested).

const FIELD_TOKENS = {
  date: ["תאריך חיוב", "מועד חיוב", "תאריך החיוב", "תאריך"],
  amount: ["סכום חיוב", "סכום החיוב", "סכום לחיוב", "סכום בשח", "סכום בש", "חיוב", "סכום"],
  merchant: ["שם בית עסק", "שם בית העסק", "בית עסק", "בית העסק", "תיאור עסקה", "תיאור", "שם"],
  txnDate: ["תאריך עסקה", "תאריך העסקה", "מועד עסקה"],
  assignment: ["שיוך", "שיוך עסקי", "קטגוריה", "תחום"],
} as const;

function findColumn(header: string[], tokens: readonly string[]): number {
  for (const token of tokens) {
    const idx = header.findIndex((cell) => norm(cell).includes(token));
    if (idx !== -1) return idx;
  }
  return -1;
}

function detectHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 25);
  let best = 0;
  let bestScore = 0;
  for (let i = 0; i < limit; i++) {
    const header = rows[i] ?? [];
    let score = 0;
    for (const tokens of Object.values(FIELD_TOKENS)) {
      if (findColumn(header, tokens) !== -1) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

// A card-section title row, e.g. "חשבון כרטיס: 176606 שם כרטיס: ויזה כאל זהב ארבע ספרות אחרונות 9557".
function extractCardName(rowCells: string[]): string | null {
  const joined = rowCells.map((c) => String(c ?? "")).join(" ").trim();
  if (!joined) return null;
  if (!/שם כרטיס|חשבון כרטיס|ספרות אחרונות/.test(joined)) return null;
  const last4 = joined.match(/(\d{4})\s*$/) ?? joined.match(/אחרונות\D*(\d{3,4})/);
  const digits = last4 ? last4[1] : "";
  const nameMatch = joined.match(/שם כרטיס[:\s]*(.*?)(?:ארבע ספרות|ספרות אחרונות|$)/);
  const name = nameMatch ? nameMatch[1].trim() : "";
  const label = [name, digits].filter(Boolean).join(" ").trim();
  return label || FALLBACK_CATEGORY;
}

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
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 2 }).format(value);
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
};
const PRESET_STORE_KEY = "bizh.cardImportPresets";

function loadPresets(): Record<string, MappingPreset> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(PRESET_STORE_KEY) || "{}") as Record<string, MappingPreset>;
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
}: {
  projects: Option[];
  properties: Option[];
  smartExtractEnabled: boolean;
  merchantMemory: MerchantMemory;
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

  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [cardLabels, setCardLabels] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const currentSheet = sheets[sheetIndex];
  const headerCells = currentSheet?.rows[headerRow] ?? [];
  const columnCount = useMemo(
    () => Math.max(0, ...((currentSheet?.rows ?? []).map((r) => r.length))),
    [currentSheet]
  );
  const detectedCards = useMemo(
    () => Array.from(new Set(rows.map((r) => r.card).filter(Boolean))),
    [rows]
  );

  function categoryFor(card: string): string {
    return (cardLabels[card] ?? card).trim() || FALLBACK_CATEGORY;
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
    const preset = loadPresets()[sheetSignature(sheet)];
    const m: MappingPreset = preset ?? {
      headerRow: hr,
      colDate: findColumn(header, FIELD_TOKENS.date),
      colAmount: findColumn(header, FIELD_TOKENS.amount),
      colMerchant: findColumn(header, FIELD_TOKENS.merchant),
      colTxnDate: findColumn(header, FIELD_TOKENS.txnDate),
      colAssignment: findColumn(header, FIELD_TOKENS.assignment),
    };
    setHeaderRow(m.headerRow);
    setColDate(m.colDate);
    setColAmount(m.colAmount);
    setColMerchant(m.colMerchant);
    setColTxnDate(m.colTxnDate);
    setColAssignment(m.colAssignment);
    setPresetApplied(Boolean(preset));
  }

  async function onFile(file: File) {
    setFileError(null);
    setPdfNotice(null);
    setSourceFile(file);
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

  // Build review rows from normalized transactions (PDF paths). expense_date stays the
  // billing date (cash-flow correct); the transaction date drives notes.
  function loadTxns(txns: ParsedTxn[]) {
    const labels: Record<string, string> = {};
    const out: ReviewRow[] = txns
      .filter((t) => Number.isFinite(t.amount) && t.amount !== 0 && (t.billingDate || t.txnDate))
      .map((t) => {
        if (t.card && !(t.card in labels)) labels[t.card] = t.card;
        const noteParts: string[] = [];
        if (t.txnDate) noteParts.push(`תאריך עסקה: ${formatIsoDisplay(t.txnDate)}`);
        if (t.installment) noteParts.push(`תשלום ${t.installment}`);
        if (t.currency && t.originalAmount != null) noteParts.push(`${t.originalAmount} ${t.currency}`);
        const description = t.merchant || "ללא שם";
        const resolved = resolveAssignment(description, {});
        return {
          // Refunds/credits (negative) are saved for the record but left out of expense
          // creation — the cash-flow view treats every expense as an outflow.
          include: t.amount > 0,
          expenseDate: t.billingDate || t.txnDate,
          txnDate: t.txnDate,
          amount: t.amount,
          description,
          notes: noteParts.join(" · "),
          card: t.card,
          assignmentRaw: "",
          businessDomain: resolved.businessDomain,
          projectId: resolved.projectId,
          propertyId: resolved.propertyId,
        };
      });
    setCardLabels(labels);
    setRows(out);
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
    savePreset(sheetSignature(sheet), { headerRow, colDate, colAmount, colMerchant, colTxnDate, colAssignment });
    const out: ReviewRow[] = [];
    const labels: Record<string, string> = {};
    let currentCard = "";
    let skipped = 0;

    for (const r of sheet.rows) {
      const card = extractCardName(r);
      if (card) {
        currentCard = card;
        if (!(card in labels)) labels[card] = card;
        continue;
      }
      const amount = parseAmount(colAmount >= 0 ? r[colAmount] : "");
      const expenseDate = parseDateToIso(colDate >= 0 ? r[colDate] : "");
      if (!Number.isFinite(amount) || amount === 0 || !expenseDate) {
        // Count non-empty rows that were dropped (excludes blank rows and header rows)
        const hasContent = r.some((cell) => String(cell ?? "").trim().length > 0);
        const looksLikeHeader = hasContent && findColumn(r, FIELD_TOKENS.date) >= 0 && findColumn(r, FIELD_TOKENS.amount) >= 0;
        if (hasContent && !looksLikeHeader) skipped++;
        continue;
      }

      const description = (colMerchant >= 0 ? String(r[colMerchant] ?? "").trim() : "") || "ללא שם";
      const txn = colTxnDate >= 0 ? parseDateToIso(r[colTxnDate]) : null;
      const assignmentRaw = colAssignment >= 0 ? String(r[colAssignment] ?? "").trim() : "";
      const assign = colAssignment >= 0 ? mapAssignment(assignmentRaw, projects, properties) : {};
      const resolved = resolveAssignment(description, assign);

      out.push({
        include: assign.include === false ? false : amount > 0,
        expenseDate,
        txnDate: txn ?? "",
        amount,
        description,
        notes: txn ? `תאריך עסקה: ${formatIsoDisplay(txn)}` : "",
        card: currentCard,
        assignmentRaw,
        businessDomain: resolved.businessDomain,
        projectId: resolved.projectId,
        propertyId: resolved.propertyId,
      });
    }

    setCardLabels(labels);
    setRows(out);
    setSkippedCount(skipped);
    setStep("review");
  }

  const includedCount = rows.filter((r) => r.include).length;
  // Show the original שיוך value as a reference only when the sheet had that column.
  const showAssignmentRef = rows.some((r) => r.assignmentRaw);
  const refundCount = rows.filter((r) => r.amount < 0).length;

  async function doSave() {
    if (saving) return;
    setSaveError(null);
    if (rows.length === 0) {
      setSaveError("אין שורות לשמירה.");
      return;
    }
    setSaving(true);
    try {
      // Save the original file as an attachment (best-effort — the save proceeds regardless).
      let documentId: string | null = null;
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
          expense_date: r.expenseDate,
          transaction_date: r.txnDate || null,
          amount: r.amount,
          description: r.description,
          category: categoryFor(r.card),
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
        setSaveError(toHebrewError(data.error, "שמירת הדף נכשלה."));
        setSaving(false);
        return;
      }
      // Off to the statement page to assign domains and create the expenses.
      router.push(`/financial/statements/${data.statement_id}`);
    } catch {
      setSaveError("שמירת הדף נכשלה.");
      setSaving(false);
    }
  }

  function reset() {
    setStep("upload");
    setSource("excel");
    setSourceFile(null);
    setPresetApplied(false);
    setSheets([]);
    setRows([]);
    setFileName("");
    setSaveError(null);
    setPdfFile(null);
    setPdfBusy(false);
    setPdfNotice(null);
  }

  return (
    <div className="space-y-4 text-right" dir="rtl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">העלאת פירוט אשראי</h1>
          <p className="text-sm text-muted-foreground">
            העלאת Excel/CSV/PDF ושמירת הפירוט. שיוך התחומים העסקיים ויצירת ההוצאות נעשים אחר כך בעמוד הפירוט.
          </p>
        </div>
        <div className="flex gap-2">
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
              Excel/CSV: קובץ עם כמה כרטיסים נתמך — כל כרטיס מזוהה לפי שורת הכותרת שלו, וכל שורה מקבלת את שם הכרטיס
              כקטגוריה. אם קיימת עמודת &quot;שיוך&quot;, היא תישמר כעמודת ייחוס וגם תמלא מראש את הבחירה.
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
                <select
                  value={sheetIndex}
                  onChange={(e) => selectSheet(Number(e.target.value))}
                  className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
                >
                  {sheets.map((s, i) => (
                    <option key={i} value={i}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">שורת כותרת</label>
                <input
                  type="number"
                  min={1}
                  value={headerRow + 1}
                  onChange={(e) => setHeaderRow(Math.max(0, (Number(e.target.value) || 1) - 1))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <ColumnSelect label="עמודת תאריך (חיוב) *" value={colDate} onChange={setColDate} headerCells={headerCells} columnCount={columnCount} />
              <ColumnSelect label="עמודת סכום (חיוב) *" value={colAmount} onChange={setColAmount} headerCells={headerCells} columnCount={columnCount} />
              <ColumnSelect label="עמודת שם בית עסק" value={colMerchant} onChange={setColMerchant} headerCells={headerCells} columnCount={columnCount} optional />
              <ColumnSelect label="עמודת שיוך (ייחוס + מילוי מראש)" value={colAssignment} onChange={setColAssignment} headerCells={headerCells} columnCount={columnCount} optional />
              <ColumnSelect label="עמודת תאריך עסקה (להערה)" value={colTxnDate} onChange={setColTxnDate} headerCells={headerCells} columnCount={columnCount} optional />
            </div>

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
              <Button onClick={buildReview} disabled={colDate < 0 || colAmount < 0}>
                המשך לתצוגה מקדימה
              </Button>
              <Button variant="outline" onClick={reset}>
                החלפת קובץ
              </Button>
            </div>
            {colDate < 0 || colAmount < 0 ? (
              <p className="text-xs text-muted-foreground">יש לבחור לפחות עמודת תאריך ועמודת סכום.</p>
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
              {detectedCards.length > 0 ? (
                <Card>
                  <CardContent className="space-y-2 py-3">
                    <div className="text-sm font-medium">כרטיסים שזוהו (שם הכרטיס = קטגוריה)</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {detectedCards.map((card) => (
                        <div key={card} className="flex items-center gap-2">
                          <Input
                            value={cardLabels[card] ?? card}
                            onChange={(e) => setCardLabels((prev) => ({ ...prev, [card]: e.target.value }))}
                            className="h-8 text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {skippedCount > 0 ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  אזהרה: {skippedCount} שורות בקובץ לא נקראו (תאריך או סכום לא תקין במיפוי הנוכחי). אם הקובץ אמור להכיל יותר שורות — חזור/י למיפוי עמודות ובדוק/י שהעמודות נבחרו נכון.
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                  נמצאו {rows.length} שורות · {includedCount} מסומנות ליצירת הוצאה
                  {refundCount > 0 ? ` · ${refundCount} זיכויים לא סומנו` : ""}
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
                        <th className="px-2 py-2 font-medium">להוצאה?</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {rows.map((row, index) => (
                        <tr key={index} className={row.include ? "" : "opacity-60"}>
                          <td className="whitespace-nowrap px-2 py-2">{formatIsoDisplay(row.expenseDate)}</td>
                          <td className="px-2 py-2">{row.description}</td>
                          <td className="whitespace-nowrap px-2 py-2 font-medium">
                            <span className={row.amount < 0 ? "text-success-soft-foreground" : ""}>
                              {formatCurrency(row.amount)}
                            </span>
                            {row.amount < 0 ? (
                              <span
                                title="זיכוי/החזר — לא ייווצר כהוצאה כברירת מחדל"
                                className="ms-1 inline-block rounded bg-success-soft px-1 py-0.5 text-[10px] font-medium text-success-soft-foreground"
                              >
                                זיכוי
                              </span>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-xs text-muted-foreground">{categoryFor(row.card)}</td>
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
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void doSave()} disabled={saving}>
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
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value={-1}>{optional ? "— ללא —" : "— בחר —"}</option>
        {Array.from({ length: columnCount }).map((_, ci) => (
          <option key={ci} value={ci}>
            {colLetter(ci)} — {String(headerCells[ci] ?? "").trim() || "(ריק)"}
          </option>
        ))}
      </select>
    </div>
  );
}
