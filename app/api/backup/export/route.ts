import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

/**
 * Base tables to include in the backup. Views are intentionally excluded — they
 * are derived from these tables, so dumping the base tables is enough to fully
 * reconstruct the data. `order` is the column used for stable pagination (every
 * table has `id` except the join table).
 */
const TABLES: Array<{ name: string; order?: string }> = [
  { name: "users" },
  { name: "customers" },
  { name: "contacts" },
  { name: "projects" },
  { name: "tasks" },
  { name: "payments" },
  { name: "expenses" },
  { name: "recurring_expense_templates" },
  { name: "orders" },
  { name: "order_items" },
  { name: "products" },
  { name: "inventory_movements" },
  { name: "properties" },
  { name: "documents" },
  { name: "attendance_sessions" },
  { name: "salary_agreements" },
  { name: "payroll_periods" },
  { name: "payslips" },
  { name: "worker_payments" },
  { name: "morning_documents" },
  { name: "audit_logs" },
  { name: "project_schedule_entries" },
  { name: "recurring_task_templates" },
  { name: "recurring_task_template_assignees", order: "recurring_task_template_id" },
  { name: "push_alert_config" },
];

const PAGE_SIZE = 1000;

/** Fetch every row from a table, paging past Supabase's 1000-row cap. */
async function fetchAllRows(
  supabase: SupabaseClient,
  table: string,
  orderColumn: string
): Promise<{ rows: Row[] } | { error: string }> {
  const all: Row[] = [];
  let from = 0;
  let useOrder = true;

  for (;;) {
    let query = supabase.from(table).select("*").range(from, from + PAGE_SIZE - 1);
    if (useOrder) query = query.order(orderColumn, { ascending: true });

    const { data, error } = await query;

    if (error) {
      // The order column may not exist on this table — retry once without it.
      if (useOrder) {
        useOrder = false;
        continue;
      }
      return { error: error.message || error.code || "read failed" };
    }

    const rows = (data ?? []) as Row[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return { rows: all };
}

/** jsonb / array columns come back as objects — stringify them for a flat cell. */
function flattenRow(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== null && typeof value === "object") {
      try {
        out[key] = JSON.stringify(value);
      } catch {
        out[key] = String(value);
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Excel sheet names: <=31 chars, no \ / ? * [ ] :, and must be unique. */
function safeSheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[\\/?*[\]:]/g, "_").slice(0, 31);
  let candidate = base;
  let i = 1;
  while (used.has(candidate)) {
    const suffix = `_${i++}`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate);
  return candidate;
}

export async function GET() {
  const access = await requireRouteAccess({ allowedRoles: ["admin"] });
  if (!access.ok) return access.response;

  // Prefer the service-role client (bypasses RLS → a truly complete backup).
  // It's null when SUPABASE_SERVICE_ROLE_KEY is unset, so fall back to the
  // admin's own client — that backs up everything the admin can read.
  const admin = createSupabaseAdminClient();
  const supabase = (admin ?? access.value.supabase) as SupabaseClient;
  const usedServiceRole = Boolean(admin);

  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();
  const summary: Array<Row> = [];

  for (const { name, order } of TABLES) {
    const result = await fetchAllRows(supabase, name, order ?? "id");

    if ("error" in result) {
      summary.push({ "טבלה": name, "שורות": "—", "סטטוס": `דילוג: ${result.error}` });
      continue;
    }

    const rows = result.rows.map(flattenRow);
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(name, usedNames));
    summary.push({ "טבלה": name, "שורות": rows.length, "סטטוס": "הושלם" });
  }

  // Lead with an info sheet: when it was taken, how, and per-table row counts.
  const stamp = new Date().toISOString();
  const info: Row[] = [
    { "טבלה": "— גיבוי BizManager —", "שורות": "", "סטטוס": "" },
    { "טבלה": "תאריך", "שורות": stamp, "סטטוס": "" },
    {
      "טבלה": "מקור",
      "שורות": usedServiceRole ? "service-role (מלא)" : "הרשאות מנהל (כפוף ל-RLS)",
      "סטטוס": "",
    },
    { "טבלה": "", "שורות": "", "סטטוס": "" },
    ...summary,
  ];
  const infoWs = XLSX.utils.json_to_sheet(info, { skipHeader: true });
  XLSX.utils.book_append_sheet(wb, infoWs, safeSheetName("_גיבוי", usedNames));
  // Move the info sheet to the front.
  wb.SheetNames.unshift(wb.SheetNames.pop()!);

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const filename = `bizmanager-backup-${stamp.slice(0, 10)}.xlsx`;

  return new NextResponse(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Backup-Filename": filename,
      "Cache-Control": "no-store",
    },
  });
}
