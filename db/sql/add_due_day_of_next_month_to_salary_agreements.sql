-- Run this in Supabase SQL Editor.
--
-- Goal:
-- - Allow each salary agreement to define the worker's due day in the following month.
-- - Keep existing agreements safe by defaulting everything to day 10.

alter table public.salary_agreements
  add column if not exists due_day_of_next_month integer;

alter table public.salary_agreements
  drop constraint if exists salary_agreements_due_day_of_next_month_check;

update public.salary_agreements
set due_day_of_next_month = 10
where due_day_of_next_month is null;

alter table public.salary_agreements
  alter column due_day_of_next_month set default 10;

alter table public.salary_agreements
  alter column due_day_of_next_month set not null;

alter table public.salary_agreements
  add constraint salary_agreements_due_day_of_next_month_check
  check (due_day_of_next_month between 1 and 31);

comment on column public.salary_agreements.due_day_of_next_month is
  'Day in the following month when this worker''s salary becomes due. Defaults to 10.';
