-- Rollback for 20261024120000_recurring_and_order_currencies.sql.
--
-- A recurring template in US$ / C$ loses its currency (its amount would then
-- read as shekels) — save them first:
--   create table backup.recurring_templates_currency_<yyyymmdd_hhmm> as
--     select id, template_name, currency, amount from public.recurring_expense_templates where currency <> 'ILS';
-- Bills already written in dollars keep their own currency columns.

-- 3. update_sales_order back to shekel-only payment lines.
do $mig$
declare
  v_def text := pg_get_functiondef(
    'public.update_sales_order(uuid,uuid,timestamp with time zone,text,numeric,numeric,numeric,text,uuid,text,jsonb,text,date,timestamp with time zone,date,uuid,jsonb,jsonb)'::regprocedure);
  v_new_cols text := 'recorded_by, account_id,
      currency, foreign_amount, fx_rate, fx_rate_manual
    ) values (';
  v_old_cols text := 'recorded_by, account_id
    ) values (';
  v_new_vals text := 'nullif(v_item->>''account_id'', '''')::uuid,
      coalesce(nullif(upper(v_item->>''currency''), ''''), ''ILS''),
      nullif(v_item->>''foreign_amount'', '''')::numeric,
      nullif(v_item->>''fx_rate'', '''')::numeric,
      coalesce((v_item->>''fx_rate_manual'')::boolean, false)
    )
    returning id into v_payment_id;';
  v_old_vals text := 'nullif(v_item->>''account_id'', '''')::uuid
    )
    returning id into v_payment_id;';
begin
  v_def := replace(v_def, E'\r\n', E'\n');
  execute replace(replace(v_def, v_new_cols, v_old_cols), v_new_vals, v_old_vals);
end
$mig$;

-- 2. the bill writer as it was (20260720020000_recurring_expense_backfill_auto_paid.sql).
create or replace function public._ensure_recurring_occurrence(
  t public.recurring_expense_templates,
  p_key text,
  p_expense_date date,
  p_paid boolean
)
returns boolean
language plpgsql
as $$
declare
  v_expense_id uuid;
begin
  if t.start_date is not null and p_expense_date < t.start_date then
    return false;
  end if;
  if t.end_date is not null and p_expense_date > t.end_date then
    return false;
  end if;
  if exists (
    select 1 from public.expenses e
    where e.recurring_expense_template_id = t.id and e.recurrence_key = p_key
  ) then
    return false;
  end if;

  insert into public.expenses (
    expense_date, amount, category, description, business_domain,
    project_id, order_id, property_id, account_id, notes, recorded_by,
    recurring_expense_template_id, recurrence_key, payment_status, paid_amount, paid_date
  )
  values (
    p_expense_date, t.amount, t.category,
    public.recurring_expense_apply_tokens(t.description_template, p_key, p_expense_date),
    -- The template stores the domain as text; expenses.business_domain is an enum,
    -- and a text VARIABLE won't implicitly cast to it inside PL/pgSQL (only bare
    -- string literals do — which is why the old inline generator silently failed).
    coalesce(t.business_domain, 'general_business')::public.business_domain_enum, t.project_id, t.order_id, t.property_id, t.account_id,
    public.recurring_expense_apply_tokens(t.notes_template, p_key, p_expense_date),
    t.created_by, t.id, p_key,
    case when p_paid then 'paid' else 'not_paid' end,
    case when p_paid then t.amount else 0 end,
    case when p_paid then p_expense_date else null end
  )
  returning id into v_expense_id;

  if t.project_id is not null then
    insert into public.project_expenses (project_id, expense_id, included_in_base_price, billed_to_customer, notes)
    values (
      t.project_id, v_expense_id, t.included_in_base_price, t.billed_to_customer,
      public.recurring_expense_apply_tokens(t.project_expense_notes_template, p_key, p_expense_date)
    );
  end if;

  return true;
end;
$$;

-- 1. the template's currency.
alter table public.recurring_expense_templates drop constraint if exists recurring_expense_templates_currency_check;
alter table public.recurring_expense_templates drop column if exists currency;
