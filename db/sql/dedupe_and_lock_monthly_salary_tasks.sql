-- Dedupe the auto-created monthly salary payment tasks and prevent future duplicates.
-- Keeps the earliest created task per (assigned_user_id, subject, due_date::date).

begin;

-- 1) Remove duplicates (keep the earliest row)
with ranked as (
  select
    id,
    row_number() over (
      partition by assigned_user_id, subject, (due_date::date)
      order by created_at asc nulls last, id asc
    ) as rn
  from public.tasks
  where subject like 'תשלום משכורות - %'
)
delete from public.tasks t
using ranked r
where t.id = r.id
  and r.rn > 1;

-- 2) Prevent duplicates going forward
create unique index if not exists tasks_monthly_salary_unique_idx
  on public.tasks (assigned_user_id, subject, (due_date::date))
  where subject like 'תשלום משכורות - %';

commit;

