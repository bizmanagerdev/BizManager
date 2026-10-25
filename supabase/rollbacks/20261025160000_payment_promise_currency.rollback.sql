-- Rollback for 20261025160000_payment_promise_currency.sql.
--
-- A promise in US$ / C$ keeps its shekels (`amount`) but loses its dollars —
-- save them first:
--   create table backup.payment_promises_currency_<yyyymmdd_hhmm> as
--     select id, customer_id, amount, currency, foreign_amount, fx_rate, fx_rate_manual
--     from public.payment_promises where currency <> 'ILS';

-- 3. the search, back to shekels only for promises.
do $mig$
declare
  v_def text := replace(pg_get_functiondef('public.global_search(jsonb,text,text[],integer)'::regprocedure), E'\r\n', E'\n');
  v_new_info text := $t$jsonb_build_object('amount', pr.amount, 'currency', pr.currency, 'foreign_amount', pr.foreign_amount, 'date', pr.promised_date, 'status', pr.status),$t$;
  v_old_info text := $t$jsonb_build_object('amount', pr.amount, 'date', pr.promised_date, 'status', pr.status),$t$;
  v_new_cols text := $t$    null, null, null, '{}', '{}',
    case when pr.currency = 'USD' and pr.foreign_amount is not null then array['סכום'] else '{}'::text[] end,
    case when pr.currency = 'USD' and pr.foreign_amount is not null then array[pr.foreign_amount] else '{}'::numeric[] end,
    case when pr.currency = 'CAD' and pr.foreign_amount is not null then array['סכום'] else '{}'::text[] end,
    case when pr.currency = 'CAD' and pr.foreign_amount is not null then array[pr.foreign_amount] else '{}'::numeric[] end
  from payment_promises pr left join customers c on c.id = pr.customer_id$t$;
  v_old_cols text := $t$    null, null, null, '{}', '{}',
    '{}', '{}', '{}', '{}'
  from payment_promises pr left join customers c on c.id = pr.customer_id$t$;
begin
  execute replace(replace(v_def, v_new_info, v_old_info), v_new_cols, v_old_cols);
end
$mig$;

-- 2. no pricing on promises; fx_fill_amounts as it was.
drop trigger if exists trg_fx_amounts on public.payment_promises;

do $mig$
declare
  v_def text := replace(pg_get_functiondef('public.fx_fill_amounts()'::regprocedure), E'\r\n', E'\n');
begin
  v_def := replace(v_def, $t$    when 'payment_promises' then amount_col := 'amount'; day_col := 'promised_date';
$t$, '');
  v_def := replace(v_def, $t$  if (n ->> 'account_id') is not null
     and (tg_op = 'INSERT' or (n ->> 'account_id') is distinct from (o ->> 'account_id') or cur is distinct from old.currency) then
    select a.currency, a.name into account_cur, account_name from public.accounts a where a.id = (n ->> 'account_id')::uuid;$t$,
    $t$  if new.account_id is not null
     and (tg_op = 'INSERT' or new.account_id is distinct from old.account_id or cur is distinct from old.currency) then
    select a.currency, a.name into account_cur, account_name from public.accounts a where a.id = new.account_id;$t$);
  execute v_def;
end
$mig$;

-- 1. the columns.
alter table public.payment_promises drop constraint if exists payment_promises_currency_check;
alter table public.payment_promises
  drop column if exists fx_rate_manual,
  drop column if exists fx_rate,
  drop column if exists foreign_amount,
  drop column if exists currency;
