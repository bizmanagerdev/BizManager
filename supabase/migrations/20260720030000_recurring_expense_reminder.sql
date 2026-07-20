-- Monthly reminder for a recurring bill: "remind me N WORK-days before the
-- payment date" (Fri+Sat don't count). Stored per template; the
-- `recurring_payment_reminder` engine rule sends the push each period.
--
-- reminder_work_days_before: null / 0 = no reminder; N = alert N work-days before
-- each occurrence's date.
--
-- Idempotent; safe to re-run.

alter table public.recurring_expense_templates
  add column if not exists reminder_work_days_before integer;

-- Register the rule in the unified alert center so it can be toggled in
-- Settings → התראות.
insert into public.push_alert_config (title, body, url, mode, rule_key, audience_role, enabled, send_hour_israel)
values ('תזכורת לתשלום קבוע', '', '/financial/payments-calendar', 'live', 'recurring_payment_reminder', 'office', true, 8)
on conflict (rule_key) where rule_key is not null do nothing;
