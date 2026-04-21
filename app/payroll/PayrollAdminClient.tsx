"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  formatCurrency,
  formatDate,
  formatMinutes,
  getCurrentSalaryAgreement,
  getNextMonthDueText,
  getPayrollStatusLabel,
  getSalaryTypeLabel,
  type PayrollPeriodRow,
  type PayslipRow,
  type SalaryAgreementRow,
} from "@/lib/payroll";

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  active: boolean | null;
};

type Props = {
  unlocked: boolean;
  hasPasswordConfigured: boolean;
  users: UserRow[];
  agreements: SalaryAgreementRow[];
  payslips: PayslipRow[];
  periods: PayrollPeriodRow[];
};

type FormState = {
  salary_type: "hourly" | "monthly";
  hourly_rate: string;
  monthly_salary: string;
  valid_from: string;
  overtime_rate: string;
  standard_daily_hours: string;
  notes: string;
};

const DEFAULT_FORM: FormState = {
  salary_type: "monthly",
  hourly_rate: "",
  monthly_salary: "",
  valid_from: new Date().toISOString().slice(0, 10),
  overtime_rate: "",
  standard_daily_hours: "8",
  notes: "",
};

export default function PayrollAdminClient({
  unlocked,
  hasPasswordConfigured,
  users,
  agreements,
  payslips,
  periods,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [filter, setFilter] = useState("");
  const [openUserId, setOpenUserId] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [formState, setFormState] = useState<FormState>(DEFAULT_FORM);

  const periodsById = useMemo(() => new Map(periods.map((period) => [period.id, period])), [periods]);
  const agreementsByUserId = useMemo(() => {
    const map = new Map<string, SalaryAgreementRow[]>();
    agreements.forEach((agreement) => {
      const list = map.get(agreement.user_id) ?? [];
      list.push(agreement);
      map.set(agreement.user_id, list);
    });
    return map;
  }, [agreements]);
  const latestPayslipByUserId = useMemo(() => {
    const map = new Map<string, PayslipRow>();
    payslips.forEach((payslip) => {
      const existing = map.get(payslip.user_id);
      const existingPeriod = existing ? periodsById.get(existing.payroll_period_id)?.period_month ?? "" : "";
      const nextPeriod = periodsById.get(payslip.payroll_period_id)?.period_month ?? "";
      if (!existing || nextPeriod.localeCompare(existingPeriod) > 0) {
        map.set(payslip.user_id, payslip);
      }
    });
    return map;
  }, [payslips, periodsById]);

  const filteredUsers = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return users;
    return users.filter((user) =>
      [user.full_name ?? "", user.email ?? "", user.phone ?? ""].join(" ").toLowerCase().includes(query)
    );
  }, [filter, users]);

  async function unlock() {
    setUnlockError("");
    startTransition(async () => {
      try {
        const response = await fetch("/api/payroll/admin/unlock", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          setUnlockError(json.error ?? "פתיחת מרכז השכר נכשלה.");
          return;
        }
        setPassword("");
        router.refresh();
      } catch (error: unknown) {
        setUnlockError(error instanceof Error ? error.message : "Unknown error");
      }
    });
  }

  async function lockCenter() {
    startTransition(async () => {
      await fetch("/api/payroll/admin/lock", { method: "POST" });
      router.refresh();
    });
  }

  function openFormForUser(userId: string, agreement: SalaryAgreementRow | null) {
    setOpenUserId(userId);
    setSaveError("");
    setSaveMessage("");
    setFormState({
      salary_type: agreement?.salary_type === "hourly" ? "hourly" : "monthly",
      hourly_rate: agreement?.hourly_rate ? String(agreement.hourly_rate) : "",
      monthly_salary: agreement?.monthly_salary ? String(agreement.monthly_salary) : "",
      valid_from: new Date().toISOString().slice(0, 10),
      overtime_rate: agreement?.overtime_rate ? String(agreement.overtime_rate) : "",
      standard_daily_hours: agreement?.standard_daily_hours
        ? String(agreement.standard_daily_hours)
        : "8",
      notes: "",
    });
  }

  async function saveAgreement(userId: string) {
    setSaveError("");
    setSaveMessage("");

    startTransition(async () => {
      try {
        const response = await fetch("/api/payroll/salary-agreements", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ user_id: userId, ...formState }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          setSaveError(json.error ?? "שמירת הסכם השכר נכשלה.");
          return;
        }
        setSaveMessage("הסכם השכר נשמר בהצלחה.");
        setOpenUserId("");
        setFormState(DEFAULT_FORM);
        router.refresh();
      } catch (error: unknown) {
        setSaveError(error instanceof Error ? error.message : "Unknown error");
      }
    });
  }

  if (!hasPasswordConfigured) {
    return (
      <Card>
        <CardContent className="space-y-3 py-6">
          <div className="text-lg font-semibold">הגדרת סיסמת מנהל חסרה</div>
          <div className="text-sm text-muted-foreground">
            כדי להשתמש במרכז השכר צריך להגדיר בשרת את `PAYROLL_ADMIN_PASSWORD`.
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!unlocked) {
    return (
      <Card>
        <CardContent className="space-y-4 py-6">
          <div>
            <div className="text-lg font-semibold">פתיחת מרכז השכר</div>
            <div className="text-sm text-muted-foreground">
              רק מנהל עם סיסמת השכר יכול לצפות ולעדכן את נתוני השכר של כל העובדים.
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,320px)_140px]">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="סיסמת מנהל"
            />
            <Button disabled={!password || isPending} onClick={() => void unlock()}>
              כניסה
            </Button>
          </div>
          {unlockError ? <div className="text-sm text-destructive">{unlockError}</div> : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="חיפוש עובד לפי שם, אימייל או טלפון"
          className="max-w-sm"
        />
        <Button variant="outline" onClick={() => void lockCenter()} disabled={isPending}>
          נעילת מרכז השכר
        </Button>
      </div>

      {saveError ? <div className="text-sm text-destructive">{saveError}</div> : null}
      {saveMessage ? <div className="text-sm text-emerald-700">{saveMessage}</div> : null}

      <div className="grid gap-4">
        {filteredUsers.map((user) => {
          const userAgreements = agreementsByUserId.get(user.id) ?? [];
          const currentAgreement = getCurrentSalaryAgreement(userAgreements);
          const latestPayslip = latestPayslipByUserId.get(user.id) ?? null;
          const latestPeriod = latestPayslip ? periodsById.get(latestPayslip.payroll_period_id) ?? null : null;
          const isOpen = openUserId === user.id;

          return (
            <Card key={user.id}>
              <CardContent className="space-y-4 py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold">{user.full_name ?? user.email ?? "עובד"}</div>
                    <div className="text-sm text-muted-foreground">
                      {user.email ?? "-"} | {user.phone ?? "-"} | תפקיד: {user.role ?? "-"}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => openFormForUser(user.id, currentAgreement)}>
                      עדכון שכר
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-3">
                  <MiniStat
                    label="שכר נוכחי"
                    value={
                      currentAgreement
                        ? currentAgreement.salary_type === "hourly"
                          ? `${formatCurrency(currentAgreement.hourly_rate)} לשעה`
                          : formatCurrency(currentAgreement.monthly_salary)
                        : "-"
                    }
                  />
                  <MiniStat
                    label="בתוקף מ"
                    value={currentAgreement ? formatDate(currentAgreement.valid_from) : "-"}
                  />
                  <MiniStat
                    label="תלוש אחרון"
                    value={latestPayslip ? formatCurrency(latestPayslip.gross_salary) : "-"}
                  />
                </div>

                {latestPayslip && latestPeriod ? (
                  <div className="rounded-2xl border bg-muted/20 p-4 text-sm">
                    <div className="font-medium">תלוש אחרון: {latestPeriod.period_month}</div>
                    <div className="mt-1 text-muted-foreground">
                      סטטוס: {getPayrollStatusLabel(latestPeriod.status)} | שעות:{" "}
                      {formatMinutes(latestPayslip.total_work_minutes)} | צפי תשלום:{" "}
                      {getNextMonthDueText(latestPeriod.end_date)}
                    </div>
                  </div>
                ) : null}

                {isOpen ? (
                  <div className="rounded-2xl border p-4">
                    <div className="mb-3 text-base font-semibold">הסכם שכר חדש</div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <Field label="סוג שכר">
                        <select
                          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                          value={formState.salary_type}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              salary_type: event.target.value as "hourly" | "monthly",
                            }))
                          }
                        >
                          <option value="monthly">גלובלי</option>
                          <option value="hourly">שעתי</option>
                        </select>
                      </Field>
                      <Field label="בתוקף מ">
                        <Input
                          type="date"
                          value={formState.valid_from}
                          onChange={(event) =>
                            setFormState((current) => ({ ...current, valid_from: event.target.value }))
                          }
                        />
                      </Field>
                      <Field label="שעות תקן יומיות">
                        <Input
                          value={formState.standard_daily_hours}
                          onChange={(event) =>
                            setFormState((current) => ({
                              ...current,
                              standard_daily_hours: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field label="תעריף שעות נוספות">
                        <Input
                          value={formState.overtime_rate}
                          onChange={(event) =>
                            setFormState((current) => ({ ...current, overtime_rate: event.target.value }))
                          }
                          placeholder="למשל 85"
                        />
                      </Field>
                      {formState.salary_type === "hourly" ? (
                        <Field label="תעריף שעתי">
                          <Input
                            value={formState.hourly_rate}
                            onChange={(event) =>
                              setFormState((current) => ({ ...current, hourly_rate: event.target.value }))
                            }
                            placeholder="למשל 55"
                          />
                        </Field>
                      ) : (
                        <Field label="שכר חודשי">
                          <Input
                            value={formState.monthly_salary}
                            onChange={(event) =>
                              setFormState((current) => ({ ...current, monthly_salary: event.target.value }))
                            }
                            placeholder="למשל 12000"
                          />
                        </Field>
                      )}
                      <Field label="הערות">
                        <Input
                          value={formState.notes}
                          onChange={(event) =>
                            setFormState((current) => ({ ...current, notes: event.target.value }))
                          }
                          placeholder="הערת מנהל"
                        />
                      </Field>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button disabled={isPending} onClick={() => void saveAgreement(user.id)}>
                        שמירת הסכם
                      </Button>
                      <Button variant="outline" onClick={() => setOpenUserId("")}>
                        ביטול
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <div className="text-sm font-semibold">היסטוריית שכר</div>
                  {userAgreements.length === 0 ? (
                    <div className="text-sm text-muted-foreground">אין הסכמי שכר קודמים.</div>
                  ) : (
                    userAgreements.map((agreement) => (
                      <div key={agreement.id} className="rounded-2xl border p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium">{getSalaryTypeLabel(agreement.salary_type)}</div>
                          <div className="font-semibold">
                            {agreement.salary_type === "hourly"
                              ? `${formatCurrency(agreement.hourly_rate)} לשעה`
                              : formatCurrency(agreement.monthly_salary)}
                          </div>
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {formatDate(agreement.valid_from)} - {formatDate(agreement.valid_to)} | שעות תקן:{" "}
                          {agreement.standard_daily_hours ?? "-"}
                        </div>
                        {agreement.notes ? <div className="mt-1">{agreement.notes}</div> : null}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-sm">
      <div className="font-medium">{label}</div>
      {children}
    </label>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-muted/20 p-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
