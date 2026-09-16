-- ════════════════════════════════════════════════════════════════════════════
-- Books start date ("תחילת ספירת הכספים") — the day the business started using
-- the system for real. The system was in use before it was fully built (orders
-- and income were recorded, expenses weren't), so all-time totals are wrong.
-- Reports and the dashboard money chart count only from this date on; nothing
-- earlier is deleted or changed. NULL = count everything (the old behaviour).
--
-- Always the 1st of a month, so every monthly report starts on a whole month.
-- Same singleton row as vat_rate / cc_fee_rate. Idempotent / safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.business_settings
  add column if not exists books_start_date date;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'business_settings_books_start_date_first_of_month'
      and conrelid = 'public.business_settings'::regclass
  ) then
    alter table public.business_settings
      add constraint business_settings_books_start_date_first_of_month
      check (books_start_date is null or extract(day from books_start_date) = 1);
  end if;
end $$;
