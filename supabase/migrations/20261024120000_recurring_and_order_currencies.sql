-- ════════════════════════════════════════════════════════════════════════════
-- Money in US$ and C$ on every form (owner, 2026-10-24: "every single form in
-- the whole system that you could add or edit an expense … and income"):
--
-- 1. A recurring bill (recurring_expense_templates) has a currency: its amount
--    is in it. Every template stays ₪ — a constant default is only written to
--    the catalog, no row is rewritten.
-- 2. _ensure_recurring_occurrence — what the daily generator and the backfill
--    write a bill with — writes a US$ / C$ template's bill in that currency:
--    its amount as the template says, its shekels at the Bank of Israel rate
--    of the bill's day (fx_rate_on). A ₪ template writes exactly as before.
-- 3. update_sales_order saves a new payment / refund line's currency columns
--    with it (an order edited with a payment in dollars); a line without them
--    is shekels, as before.
--
-- ROLLBACK: supabase/rollbacks/20261024120000_recurring_and_order_currencies.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. the template's currency ──────────────────────────────────────────────
alter table public.recurring_expense_templates
  add column if not exists currency text not null default 'ILS';

alter table public.recurring_expense_templates drop constraint if exists recurring_expense_templates_currency_check;
alter table public.recurring_expense_templates
  add constraint recurring_expense_templates_currency_check check (currency in ('ILS', 'USD', 'CAD'));

comment on column public.recurring_expense_templates.currency is
  'ILS | USD | CAD — the currency its amount is in; its bills are written in it, their shekels at the rate of each bill''s day.';

-- ── 2. a bill written in its template's currency ────────────────────────────
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
  v_currency text := upper(coalesce(t.currency, 'ILS'));
  v_rate numeric;
  v_shekels numeric := t.amount;
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

  -- In US$ / C$: the template's amount is in it, and the bill's shekels are at
  -- the rate of its day (the last one before it on a weekend or a holiday).
  -- With no rate at all it waits for a later run rather than stopping the others.
  if v_currency <> 'ILS' then
    v_rate := public.fx_rate_on(v_currency, p_expense_date);
    if v_rate is null then
      return false;
    end if;
    v_shekels := round(coalesce(t.amount, 0) * v_rate, 2);
  end if;

  insert into public.expenses (
    expense_date, amount, category, description, business_domain,
    project_id, order_id, property_id, account_id, notes, recorded_by,
    recurring_expense_template_id, recurrence_key, payment_status, paid_amount, paid_date,
    currency, foreign_amount, fx_rate, fx_rate_manual
  )
  values (
    p_expense_date, v_shekels, t.category,
    public.recurring_expense_apply_tokens(t.description_template, p_key, p_expense_date),
    -- The template stores the domain as text; expenses.business_domain is an enum,
    -- and a text VARIABLE won't implicitly cast to it inside PL/pgSQL (only bare
    -- string literals do — which is why the old inline generator silently failed).
    coalesce(t.business_domain, 'general_business')::public.business_domain_enum, t.project_id, t.order_id, t.property_id, t.account_id,
    public.recurring_expense_apply_tokens(t.notes_template, p_key, p_expense_date),
    t.created_by, t.id, p_key,
    case when p_paid then 'paid' else 'not_paid' end,
    case when p_paid then v_shekels else 0 end,
    case when p_paid then p_expense_date else null end,
    v_currency,
    case when v_currency <> 'ILS' then t.amount end,
    case when v_currency <> 'ILS' then v_rate end,
    false
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

-- ── 3. an edited order's payment lines keep their currency ──────────────────
-- In place: the two insert column lists and the two value lists (payments,
-- then refunds) gain the currency columns; nothing else in the function moves.
do $mig$
declare
  v_def text := pg_get_functiondef(
    'public.update_sales_order(uuid,uuid,timestamp with time zone,text,numeric,numeric,numeric,text,uuid,text,jsonb,text,date,timestamp with time zone,date,uuid,jsonb,jsonb)'::regprocedure);
  v_old_cols text := 'recorded_by, account_id
    ) values (';
  v_new_cols text := 'recorded_by, account_id,
      currency, foreign_amount, fx_rate, fx_rate_manual
    ) values (';
  v_old_vals text := 'nullif(v_item->>''account_id'', '''')::uuid
    )
    returning id into v_payment_id;';
  v_new_vals text := 'nullif(v_item->>''account_id'', '''')::uuid,
      coalesce(nullif(upper(v_item->>''currency''), ''''), ''ILS''),
      nullif(v_item->>''foreign_amount'', '''')::numeric,
      nullif(v_item->>''fx_rate'', '''')::numeric,
      coalesce((v_item->>''fx_rate_manual'')::boolean, false)
    )
    returning id into v_payment_id;';
begin
  v_def := replace(v_def, E'\r\n', E'\n');
  if (length(v_def) - length(replace(v_def, v_old_cols, ''))) / length(v_old_cols) <> 2 then
    raise exception 'update_sales_order: the payments'' column list is not there twice';
  end if;
  if (length(v_def) - length(replace(v_def, v_old_vals, ''))) / length(v_old_vals) <> 2 then
    raise exception 'update_sales_order: the payments'' value list is not there twice';
  end if;
  execute replace(replace(v_def, v_old_cols, v_new_cols), v_old_vals, v_new_vals);
end
$mig$;
