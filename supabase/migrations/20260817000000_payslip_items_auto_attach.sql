-- A רכיב שכר lands on the payslip by itself.
--
-- Without this, a bonus added after the month's payslip was generated sat loose
-- until someone pressed "יצירת / רענון תלושים" — so the תלוש showed a ברוטו that
-- was quietly missing money. Nobody should have to remember a button for that.
--
-- Two triggers on payslip_items:
--   • BEFORE  — a dated item with no payslip_id adopts the payslip that already
--               covers its month (only an OPEN period; a locked month is closed
--               business and must not move).
--   • AFTER   — recompute that payslip's gross_salary from its parts. Same formula
--               generatePayslipsForPeriod uses, so the two can never disagree:
--                   gross = calculated_base_salary + manual_adjustments + Σ items
--
-- SECURITY DEFINER on purpose: a WORKER may insert his own bonus but has no rights
-- on `payslips` at all. Doing the attach + recalc in his own session is what made
-- the app try (and fail) to regenerate payslips as him. Here it runs as the table
-- owner, so his bonus reaches the תלוש without giving him any access to payroll.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

-- ── 1. Adopt a loose dated item into the month's payslip ────────────────────
create or replace function public.payslip_items_attach_to_payslip()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  target_payslip uuid;
begin
  if new.payslip_id is null and new.item_date is not null and new.user_id is not null then
    select p.id
      into target_payslip
    from public.payslips p
    join public.payroll_periods pp on pp.id = p.payroll_period_id
    where p.user_id = new.user_id
      and pp.start_date <= new.item_date
      and pp.end_date >= new.item_date
      -- Mirrors isPayrollPeriodEditable(): only an open month absorbs new items.
      and coalesce(pp.status, 'open') not in ('closed', 'locked', 'approved', 'paid')
    order by pp.start_date desc
    limit 1;

    if target_payslip is not null then
      new.payslip_id := target_payslip;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists payslip_items_attach on public.payslip_items;
create trigger payslip_items_attach
  before insert or update of payslip_id, item_date, user_id on public.payslip_items
  for each row execute function public.payslip_items_attach_to_payslip();

-- ── 2. Keep gross_salary in step with the items ─────────────────────────────
create or replace function public.payslip_items_recalc_gross()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  ids uuid[];
  pid uuid;
begin
  -- OLD/NEW only exist for the ops that have them — referencing the wrong one
  -- raises "record is not assigned yet", so each branch names only its own.
  if tg_op = 'INSERT' then
    ids := array_remove(array[new.payslip_id], null);
  elsif tg_op = 'DELETE' then
    ids := array_remove(array[old.payslip_id], null);
  else
    ids := array_remove(array[old.payslip_id, new.payslip_id], null);
  end if;

  foreach pid in array ids loop
    update public.payslips p
    set gross_salary = round(
      coalesce(p.calculated_base_salary, 0)
      + coalesce(p.manual_adjustments, 0)
      + coalesce((
          select sum(i.amount)
          from public.payslip_items i
          where i.payslip_id = p.id
        ), 0)
    , 2)
    where p.id = pid;
  end loop;

  return null;
end;
$$;

drop trigger if exists payslip_items_recalc on public.payslip_items;
create trigger payslip_items_recalc
  after insert or update or delete on public.payslip_items
  for each row execute function public.payslip_items_recalc_gross();

-- ── 3. Catch up anything already stranded ───────────────────────────────────
-- Items recorded before these triggers existed, whose month is generated and open.
update public.payslip_items i
set payslip_id = p.id
from public.payslips p
join public.payroll_periods pp on pp.id = p.payroll_period_id
where i.payslip_id is null
  and i.item_date is not null
  and p.user_id = i.user_id
  and pp.start_date <= i.item_date
  and pp.end_date >= i.item_date
  and coalesce(pp.status, 'open') not in ('closed', 'locked', 'approved', 'paid');

-- …and re-total every payslip, so a gross that drifted before now is correct.
update public.payslips p
set gross_salary = round(
  coalesce(p.calculated_base_salary, 0)
  + coalesce(p.manual_adjustments, 0)
  + coalesce((
      select sum(i.amount)
      from public.payslip_items i
      where i.payslip_id = p.id
    ), 0)
, 2);
