-- ════════════════════════════════════════════════════════════════════════════
-- A payment promise in US$ or C$ (owner, 2026-10-25: "the small gaps — payment
-- promises …"): "the customer promised $1,000 by the 1st".
--
-- 1. payment_promises gets the four currency columns the other money rows have
--    (20261023120001_money_currency.sql). Its `amount` stays the shekels — what
--    the cash forecast counts and takes off what the order or project is still
--    expected to bring. There are no promises yet, so no row is touched.
-- 2. The pricing trigger (fx_fill_amounts) prices a promise in US$ / C$ at the
--    latest Bank of Israel rate up to its promised date (a future date: the
--    newest rate there is). Patched in place: one more table in its list, and
--    its "a US$ account holds only its currency" check reads the row's account
--    through the row itself, so a table with no account (a promise) passes it.
-- 3. The search finds a promise by its dollars, and shows them (global_search,
--    patched in place).
--
-- ROLLBACK: supabase/rollbacks/20261025160000_payment_promise_currency.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. the columns ──────────────────────────────────────────────────────────
alter table public.payment_promises
  add column if not exists currency text not null default 'ILS',
  add column if not exists foreign_amount numeric(14, 2),
  add column if not exists fx_rate numeric(12, 6),
  add column if not exists fx_rate_manual boolean not null default false;

-- Shekels carry no foreign amount or rate; US$ and C$ always carry both.
alter table public.payment_promises drop constraint if exists payment_promises_currency_check;
alter table public.payment_promises add constraint payment_promises_currency_check check (
  (currency = 'ILS' and foreign_amount is null and fx_rate is null)
  or (currency in ('USD', 'CAD') and foreign_amount is not null and fx_rate > 0));

comment on column public.payment_promises.currency is
  'ILS | USD | CAD — the currency promised; `amount` is its shekels (foreign_amount × fx_rate).';

-- ── 2. priced like the other money rows ─────────────────────────────────────
do $mig$
declare
  v_def text := replace(pg_get_functiondef('public.fx_fill_amounts()'::regprocedure), E'\r\n', E'\n');
  v_old_case text := $t$    when 'worker_payments' then amount_col := 'amount'; day_col := 'payment_date';
$t$;
  v_new_case text := $t$    when 'worker_payments' then amount_col := 'amount'; day_col := 'payment_date';
    when 'payment_promises' then amount_col := 'amount'; day_col := 'promised_date';
$t$;
  v_old_account text := $t$  if new.account_id is not null
     and (tg_op = 'INSERT' or new.account_id is distinct from old.account_id or cur is distinct from old.currency) then
    select a.currency, a.name into account_cur, account_name from public.accounts a where a.id = new.account_id;$t$;
  v_new_account text := $t$  if (n ->> 'account_id') is not null
     and (tg_op = 'INSERT' or (n ->> 'account_id') is distinct from (o ->> 'account_id') or cur is distinct from old.currency) then
    select a.currency, a.name into account_cur, account_name from public.accounts a where a.id = (n ->> 'account_id')::uuid;$t$;
begin
  if position($t$when 'payment_promises'$t$ in v_def) > 0 then
    return; -- already there
  end if;
  if (length(v_def) - length(replace(v_def, v_old_case, ''))) / length(v_old_case) <> 1 then
    raise exception 'fx_fill_amounts: the worker_payments line is not there once';
  end if;
  if (length(v_def) - length(replace(v_def, v_old_account, ''))) / length(v_old_account) <> 1 then
    raise exception 'fx_fill_amounts: the account check is not there once';
  end if;
  execute replace(replace(v_def, v_old_case, v_new_case), v_old_account, v_new_account);
end
$mig$;

drop trigger if exists trg_fx_amounts on public.payment_promises;
create trigger trg_fx_amounts before insert or update on public.payment_promises
  for each row execute function public.fx_fill_amounts();

-- ── 3. the search: a promise's dollars ──────────────────────────────────────
do $mig$
declare
  v_def text := replace(pg_get_functiondef('public.global_search(jsonb,text,text[],integer)'::regprocedure), E'\r\n', E'\n');
  v_old_info text := $t$jsonb_build_object('amount', pr.amount, 'date', pr.promised_date, 'status', pr.status),$t$;
  v_new_info text := $t$jsonb_build_object('amount', pr.amount, 'currency', pr.currency, 'foreign_amount', pr.foreign_amount, 'date', pr.promised_date, 'status', pr.status),$t$;
  v_old_cols text := $t$    null, null, null, '{}', '{}',
    '{}', '{}', '{}', '{}'
  from payment_promises pr left join customers c on c.id = pr.customer_id$t$;
  v_new_cols text := $t$    null, null, null, '{}', '{}',
    case when pr.currency = 'USD' and pr.foreign_amount is not null then array['סכום'] else '{}'::text[] end,
    case when pr.currency = 'USD' and pr.foreign_amount is not null then array[pr.foreign_amount] else '{}'::numeric[] end,
    case when pr.currency = 'CAD' and pr.foreign_amount is not null then array['סכום'] else '{}'::text[] end,
    case when pr.currency = 'CAD' and pr.foreign_amount is not null then array[pr.foreign_amount] else '{}'::numeric[] end
  from payment_promises pr left join customers c on c.id = pr.customer_id$t$;
begin
  if (length(v_def) - length(replace(v_def, v_old_info, ''))) / length(v_old_info) <> 1 then
    raise exception 'global_search: the promises'' details are not there once';
  end if;
  if (length(v_def) - length(replace(v_def, v_old_cols, ''))) / length(v_old_cols) <> 1 then
    raise exception 'global_search: the promises'' currency columns are not there once';
  end if;
  execute replace(replace(v_def, v_old_info, v_new_info), v_old_cols, v_new_cols);
end
$mig$;
