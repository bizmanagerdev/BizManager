"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EXPENSE_BUSINESS_DOMAINS, getBusinessDomainLabel } from "@/lib/expenses";

type Option = { id: string; name: string };
type Sheet = { name: string; rows: string[][] };
type ExistingExpense = { expense_date: string; amount: number; description: string };

type ReviewRow = {
  include: boolean;
  expenseDate: string; // ISO yyyy-mm-dd (charge date)
  txnDate: string; // ISO yyyy-mm-dd (transaction date, used for duplicate check)
  amount: number;
  description: string;
  notes: string;
  card: string; // detected card key ("" if none)
  assignmentRaw: string; // original שיוך text from the sheet (reference)
  businessDomain: string;
  projectId: string;
  propertyId: string;
  duplicate: ExistingExpense | null; // matched existing expense, if any
};

type ImportResult = { created: number; errors: { index: number; message: string }[] };

const FALLBACK_CATEGORY = "כרטיס אשראי";

// ── Parsing helpers ─────────────────────────────────────────────────────────
const norm = (s: unknown) => String(s ?? "").replace(/["׳״'`]/g, "").replace(/\s+/g, " ").trim();

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

// Map the spreadsheet's own שיוך value → a domain (+ project/property), so the
// user's existing assignments pre-fill the dropdowns.
function mapAssignment(value: string, projects: Option[], properties: Option[]): Assignment {
  const v = norm(value);
  if (!v) return {};
  if (v.includes("לא לתעד") || v === "ללא תיעוד" || v === "אל תתעד" || v === "לא") return { include: false };
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

function parseAmount(raw: unknown): number {
  if (typeof raw === "number") return raw;
  let s = String(raw ?? "").trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.includes("-")) neg = true;
  s = s.replace(/[^\d.]/g, "");
  if (!s) return NaN;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return neg ? -n : n;
}

function parseDateToIso(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const dmy = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (dmy[3].length === 2) year = year >= 70 ? 1900 + year : 2000 + year;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return null;
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

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Find an existing expense that looks like the same charge: same amount and a
// date within ±windowDays of the row's transaction date (falls back to charge date).
function findDuplicate(
  row: Pick<ReviewRow, "amount" | "txnDate" | "expenseDate" | "description">,
  existing: ExistingExpense[],
  windowDays: number
): ExistingExpense | null {
  const base = row.txnDate || row.expenseDate;
  if (!base) return null;
  const baseTime = Date.parse(`${base}T00:00:00Z`);
  const windowMs = windowDays * 86400000;
  const merchant = norm(row.description);

  const matches = existing.filter(
    (e) =>
      e.expense_date &&
      Math.abs((e.amount ?? 0) - row.amount) < 0.01 &&
      Math.abs(Date.parse(`${e.expense_date}T00:00:00Z`) - baseTime) <= windowMs
  );
  if (matches.length === 0) return null;

  const nameHit = (e: ExistingExpense) => {
    const n = norm(e.description);
    return merchant.length > 1 && n.length > 1 && (n.includes(merchant) || merchant.includes(n)) ? 0 : 1;
  };
  matches.sort((a, b) => {
    const byName = nameHit(a) - nameHit(b);
    if (byName !== 0) return byName;
    return (
      Math.abs(Date.parse(`${a.expense_date}T00:00:00Z`) - baseTime) -
      Math.abs(Date.parse(`${b.expense_date}T00:00:00Z`) - baseTime)
    );
  });
  return matches[0];
}

export default function CardImportClient({ projects, properties }: { projects: Option[]; properties: Option[] }) {
  const [step, setStep] = useState<"upload" | "map" | "review">("upload");
  const [fileName, setFileName] = useState<string>("");
  const [fileError, setFileError] = useState<string | null>(null);

  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [colDate, setColDate] = useState(-1);
  const [colAmount, setColAmount] = useState(-1);
  const [colMerchant, setColMerchant] = useState(-1);
  const [colTxnDate, setColTxnDate] = useState(-1);
  const [colAssignment, setColAssignment] = useState(-1);

  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [cardLabels, setCardLabels] = useState<Record<string, string>>({});
  const [bulkDomain, setBulkDomain] = useState("");
  const [matchWindow, setMatchWindow] = useState(3);
  const [checkingDup, setCheckingDup] = useState(false);
  const [dupError, setDupError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

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

  function applyAutoDetect(sheet: Sheet) {
    const hr = detectHeaderRow(sheet.rows);
    const header = sheet.rows[hr] ?? [];
    setHeaderRow(hr);
    setColDate(findColumn(header, FIELD_TOKENS.date));
    setColAmount(findColumn(header, FIELD_TOKENS.amount));
    setColMerchant(findColumn(header, FIELD_TOKENS.merchant));
    setColTxnDate(findColumn(header, FIELD_TOKENS.txnDate));
    setColAssignment(findColumn(header, FIELD_TOKENS.assignment));
  }

  async function onFile(file: File) {
    setFileError(null);
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
      const parsed: Sheet[] = wb.SheetNames.map((name) => ({
        name,
        rows: XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, raw: false, defval: "" }),
      })).filter((s) => s.rows.length > 0);

      if (parsed.length === 0) {
        setFileError("הקובץ ריק או לא נתמך.");
        return;
      }
      setFileName(file.name);
      setSheets(parsed);
      setSheetIndex(0);
      applyAutoDetect(parsed[0]);
      setStep("map");
    } catch {
      setFileError("קריאת הקובץ נכשלה. ודא/י שזה קובץ Excel או CSV תקין.");
    }
  }

  function selectSheet(idx: number) {
    setSheetIndex(idx);
    applyAutoDetect(sheets[idx]);
  }

  function buildReview() {
    const sheet = sheets[sheetIndex];
    if (!sheet) return;
    const out: ReviewRow[] = [];
    const labels: Record<string, string> = {};
    let currentCard = "";

    for (const r of sheet.rows) {
      const card = extractCardName(r);
      if (card) {
        currentCard = card;
        if (!(card in labels)) labels[card] = card;
        continue;
      }
      const amount = parseAmount(colAmount >= 0 ? r[colAmount] : "");
      const expenseDate = parseDateToIso(colDate >= 0 ? r[colDate] : "");
      if (!Number.isFinite(amount) || amount === 0 || !expenseDate) continue;

      const description = (colMerchant >= 0 ? String(r[colMerchant] ?? "").trim() : "") || "ללא שם";
      const txn = colTxnDate >= 0 ? parseDateToIso(r[colTxnDate]) : null;
      const assignmentRaw = colAssignment >= 0 ? String(r[colAssignment] ?? "").trim() : "";
      const assign = colAssignment >= 0 ? mapAssignment(assignmentRaw, projects, properties) : {};

      out.push({
        include: assign.include === false ? false : true,
        expenseDate,
        txnDate: txn ?? "",
        amount,
        description,
        notes: txn ? `תאריך עסקה: ${formatIsoDisplay(txn)}` : "",
        card: currentCard,
        assignmentRaw,
        businessDomain: assign.businessDomain ?? "",
        projectId: assign.projectId ?? "",
        propertyId: assign.propertyId ?? "",
        duplicate: null,
      });
    }

    setCardLabels(labels);
    setRows(out);
    setStep("review");
    void checkDuplicates(out, matchWindow);
  }

  // Fetch existing expenses around the rows' dates and flag/uncheck likely repeats.
  async function checkDuplicates(reviewRows: ReviewRow[], windowDays: number) {
    const dates = reviewRows.map((r) => r.txnDate || r.expenseDate).filter(Boolean).sort();
    if (dates.length === 0) return;
    setCheckingDup(true);
    setDupError(null);
    try {
      const from = shiftIso(dates[0], -windowDays);
      const to = shiftIso(dates[dates.length - 1], windowDays);
      const res = await fetch("/api/expenses/check-duplicates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const data = (await res.json().catch(() => ({}))) as { expenses?: ExistingExpense[]; error?: string };
      if (!res.ok) {
        setDupError(data.error ?? "בדיקת הכפילויות נכשלה.");
        return;
      }
      const existing: ExistingExpense[] = (data.expenses ?? []).map((e) => ({
        expense_date: String(e.expense_date ?? "").slice(0, 10),
        amount: Number(e.amount),
        description: String(e.description ?? ""),
      }));
      setRows((prev) =>
        prev.map((row) => {
          const dup = findDuplicate(row, existing, windowDays);
          return { ...row, duplicate: dup, include: dup ? false : row.include };
        })
      );
    } catch {
      setDupError("בדיקת הכפילויות נכשלה.");
    } finally {
      setCheckingDup(false);
    }
  }

  function updateRow(index: number, patch: Partial<ReviewRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function setRowDomain(index: number, domain: string) {
    updateRow(index, { businessDomain: domain, projectId: "", propertyId: "" });
  }

  function applyDomainToAll() {
    if (!bulkDomain) return;
    setRows((prev) =>
      prev.map((row) => (row.include ? { ...row, businessDomain: bulkDomain, projectId: "", propertyId: "" } : row))
    );
  }

  const includedRows = rows.filter((r) => r.include);
  const allAssigned = includedRows.length > 0 && includedRows.every((r) => r.businessDomain);
  // Show the original שיוך value as a reference only when the sheet had that column.
  const showAssignmentRef = rows.some((r) => r.assignmentRaw);
  const dupCount = rows.filter((r) => r.duplicate).length;

  async function doImport() {
    if (importing) return;
    setImportError(null);
    if (includedRows.length === 0) {
      setImportError("לא נבחרו שורות לייבוא.");
      return;
    }
    if (!allAssigned) {
      setImportError("יש לבחור תחום עסקי לכל שורה מסומנת.");
      return;
    }
    setImporting(true);
    try {
      const payload = {
        rows: includedRows.map((r) => ({
          expense_date: r.expenseDate,
          amount: r.amount,
          description: r.description,
          category: categoryFor(r.card),
          business_domain: r.businessDomain,
          project_id: r.businessDomain === "logistics_projects" ? r.projectId || null : null,
          property_id: r.businessDomain === "property_management" ? r.propertyId || null : null,
          notes: r.notes || null,
        })),
      };
      const res = await fetch("/api/expenses/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as ImportResult & { error?: string };
      if (!res.ok) {
        setImportError(data.error ?? "הייבוא נכשל.");
        return;
      }
      setResult({ created: data.created ?? 0, errors: data.errors ?? [] });
    } catch {
      setImportError("הייבוא נכשל.");
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setStep("upload");
    setSheets([]);
    setRows([]);
    setResult(null);
    setFileName("");
    setImportError(null);
  }

  return (
    <div className="space-y-4 text-right" dir="rtl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">ייבוא הוצאות מכרטיס אשראי</h1>
          <p className="text-sm text-muted-foreground">
            העלאת Excel/CSV, ובחירת התחום העסקי לכל שורה. כל שורה נשמרת כהוצאה (שולמה, אשראי); הקטגוריה היא שם הכרטיס.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/financial">חזרה לפיננסי</Link>
        </Button>
      </div>

      {/* RESULT */}
      {result ? (
        <Card>
          <CardContent className="space-y-3 py-5">
            <div className="text-base font-medium text-success-soft-foreground">נוצרו {result.created} הוצאות בהצלחה.</div>
            {result.errors.length > 0 ? (
              <div className="text-sm text-destructive">
                {result.errors.length} שורות נכשלו:
                <ul className="mr-4 list-disc">
                  {result.errors.slice(0, 10).map((e, i) => (
                    <li key={i}>
                      {e.index >= 0 ? `שורה ${e.index + 1}: ` : ""}
                      {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button asChild>
                <Link href="/financial">צפייה בפיננסי</Link>
              </Button>
              <Button variant="outline" onClick={reset}>
                ייבוא קובץ נוסף
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* STEP 1 — UPLOAD */}
      {!result && step === "upload" ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            <label className="text-sm font-medium">בחר/י קובץ Excel או CSV</label>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
              className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-primary-foreground hover:file:opacity-90"
            />
            {fileError ? <p className="text-sm text-destructive">{fileError}</p> : null}
            <p className="text-xs text-muted-foreground">
              קובץ עם שני כרטיסים נתמך — כל כרטיס מזוהה לפי שורת הכותרת שלו, וכל שורה מקבלת את שם הכרטיס כקטגוריה. אם
              קיימת עמודת &quot;שיוך&quot;, הבחירה תמולא אוטומטית (ניתן לשנות).
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* STEP 2 — MAP COLUMNS */}
      {!result && step === "map" && currentSheet ? (
        <Card>
          <CardContent className="space-y-4 py-5">
            <div className="text-sm text-muted-foreground">קובץ: {fileName}</div>

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
              <ColumnSelect label="עמודת שיוך (מילוי אוטומטי)" value={colAssignment} onChange={setColAssignment} headerCells={headerCells} columnCount={columnCount} optional />
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
                המשך לבחירת שיוך
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

      {/* STEP 3 — REVIEW & ASSIGN */}
      {!result && step === "review" ? (
        <div className="space-y-3">
          {rows.length === 0 ? (
            <Card>
              <CardContent className="space-y-3 py-6 text-sm">
                <div className="text-muted-foreground">לא נמצאו שורות תקינות (תאריך + סכום) לפי המיפוי שנבחר.</div>
                <Button variant="outline" onClick={() => setStep("map")}>
                  חזרה למיפוי עמודות
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

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                  נמצאו {rows.length} שורות · נבחרו {includedRows.length}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">החל תחום על הכל:</span>
                  <select
                    value={bulkDomain}
                    onChange={(e) => setBulkDomain(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">— בחר —</option>
                    {EXPENSE_BUSINESS_DOMAINS.map((d) => (
                      <option key={d} value={d}>
                        {getBusinessDomainLabel(d)}
                      </option>
                    ))}
                  </select>
                  <Button variant="outline" size="sm" onClick={applyDomainToAll} disabled={!bulkDomain}>
                    החל
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-warning-soft/15 px-3 py-2 text-sm">
                <span className="text-muted-foreground">בדיקת כפילויות מול הוצאות קיימות (לפי סכום + תאריך עסקה):</span>
                <span>טווח ±</span>
                <input
                  type="number"
                  min={0}
                  max={31}
                  value={matchWindow}
                  onChange={(e) => setMatchWindow(Math.max(0, Math.min(31, Number(e.target.value) || 0)))}
                  className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm"
                />
                <span>ימים</span>
                <Button variant="outline" size="sm" disabled={checkingDup} onClick={() => void checkDuplicates(rows, matchWindow)}>
                  {checkingDup ? "בודק..." : "בדוק כפילויות"}
                </Button>
                {dupError ? (
                  <span className="text-destructive">{dupError}</span>
                ) : dupCount > 0 ? (
                  <span className="font-medium text-warning-soft-foreground">
                    זוהו {dupCount} כפילויות אפשריות — לא סומנו לייבוא.
                  </span>
                ) : !checkingDup ? (
                  <span className="text-muted-foreground">לא זוהו כפילויות.</span>
                ) : null}
              </div>

              <Card className="overflow-hidden">
                <div className="max-h-[60vh] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                      <tr className="text-right">
                        <th className="px-2 py-2 font-medium">ייבוא</th>
                        <th className="px-2 py-2 font-medium">תאריך</th>
                        <th className="px-2 py-2 font-medium">בית עסק</th>
                        <th className="px-2 py-2 font-medium">סכום</th>
                        <th className="px-2 py-2 font-medium">כפילות?</th>
                        <th className="px-2 py-2 font-medium">קטגוריה</th>
                        {showAssignmentRef ? <th className="px-2 py-2 font-medium">שיוך מקורי</th> : null}
                        <th className="px-2 py-2 font-medium">תחום עסקי *</th>
                        <th className="px-2 py-2 font-medium">שיוך (פרויקט/נכס)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {rows.map((row, index) => (
                        <tr key={index} className={`${row.duplicate ? "bg-warning-soft/20 " : ""}${row.include ? "" : "opacity-50"}`.trim()}>
                          <td className="px-2 py-2">
                            <input type="checkbox" checked={row.include} onChange={(e) => updateRow(index, { include: e.target.checked })} />
                          </td>
                          <td className="whitespace-nowrap px-2 py-2">{formatIsoDisplay(row.expenseDate)}</td>
                          <td className="px-2 py-2">{row.description}</td>
                          <td className="whitespace-nowrap px-2 py-2 font-medium">{formatCurrency(row.amount)}</td>
                          <td className="px-2 py-2">
                            {row.duplicate ? (
                              <span
                                title={`קיים: ${formatIsoDisplay(row.duplicate.expense_date)} · ${formatCurrency(row.duplicate.amount)} · ${row.duplicate.description}`}
                                className="rounded bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning-soft-foreground"
                              >
                                כפילות?
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-xs text-muted-foreground">{categoryFor(row.card)}</td>
                          {showAssignmentRef ? (
                            <td className="whitespace-nowrap px-2 py-2 text-xs text-muted-foreground">{row.assignmentRaw || "—"}</td>
                          ) : null}
                          <td className="px-2 py-2">
                            <select
                              value={row.businessDomain}
                              disabled={!row.include}
                              onChange={(e) => setRowDomain(index, e.target.value)}
                              className="h-8 w-full min-w-[8rem] rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                            >
                              <option value="">— בחר —</option>
                              {EXPENSE_BUSINESS_DOMAINS.map((d) => (
                                <option key={d} value={d}>
                                  {getBusinessDomainLabel(d)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            {row.businessDomain === "logistics_projects" ? (
                              <select
                                value={row.projectId}
                                disabled={!row.include}
                                onChange={(e) => updateRow(index, { projectId: e.target.value })}
                                className="h-8 w-full min-w-[10rem] rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                              >
                                <option value="">— ללא פרויקט —</option>
                                {projects.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </select>
                            ) : row.businessDomain === "property_management" ? (
                              <select
                                value={row.propertyId}
                                disabled={!row.include}
                                onChange={(e) => updateRow(index, { propertyId: e.target.value })}
                                className="h-8 w-full min-w-[10rem] rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                              >
                                <option value="">— ללא נכס —</option>
                                {properties.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {importError ? <p className="text-sm text-destructive">{importError}</p> : null}

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void doImport()} disabled={importing || !allAssigned}>
                  {importing ? "מייבא..." : `ייבוא ${includedRows.length} הוצאות`}
                </Button>
                <Button variant="outline" onClick={() => setStep("map")} disabled={importing}>
                  חזרה למיפוי
                </Button>
              </div>
              {!allAssigned ? (
                <p className="text-xs text-muted-foreground">יש לבחור תחום עסקי לכל שורה מסומנת לפני הייבוא.</p>
              ) : null}
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
