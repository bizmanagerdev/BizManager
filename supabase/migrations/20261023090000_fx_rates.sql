-- ════════════════════════════════════════════════════════════════════════════
-- Exchange rates (שער יציג) for money in US$ and C$ (owner, 2026-10-22: "We
-- need to start dealing with dollars here. We have a Chase account in the
-- States … dollar to shekel and Canada to shekel"; plan approved 2026-10-23).
--
-- One row per currency per business day: how many shekels one unit was worth,
-- as the Bank of Israel published it (its official representative rate, the
-- one Israeli books use). The bank publishes Monday to Friday at about 15:30,
-- and not on Israeli holidays; a day with no rate of its own takes the last
-- one before it (fx_rate_on below).
--
-- Filled by /api/cron/fx-rates (lib/fx/rates.ts), which also loads the history
-- back to 2015 the first time. Nothing reads the table yet: the money rows get
-- their currency in the next step, and each will keep its own rate, so a
-- later change to a row here never changes an amount already saved.
--
-- Readable by anyone signed in (the rate is public information); written only
-- by the server's job. Idempotent; safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.fx_rates (
  id uuid primary key default gen_random_uuid(),
  currency text not null check (currency in ('USD', 'CAD')),
  rate_date date not null,
  -- Shekels per one unit of the currency: 3.107 for US$ on 22/10/2026.
  rate numeric(12, 6) not null check (rate > 0),
  source text not null default 'boi',
  fetched_at timestamptz not null default now(),
  constraint fx_rates_currency_date_unique unique (currency, rate_date)
);

alter table public.fx_rates enable row level security;

drop policy if exists "Signed-in users can read exchange rates" on public.fx_rates;
create policy "Signed-in users can read exchange rates"
on public.fx_rates
for select
to authenticated
using (true);

grant select on public.fx_rates to authenticated;
grant select, insert, update, delete on public.fx_rates to service_role;

-- The rate of a currency on a day: that day's own, else the last one before
-- it (a weekend, a holiday, or today before 15:30). 1 for shekels. Null when
-- there is none that early — the caller asks for the rate by hand then.
create or replace function public.fx_rate_on(p_currency text, p_date date)
returns numeric
language sql
stable
set search_path = public
as $$
  select case
    when upper(p_currency) = 'ILS' then 1::numeric
    else (
      select r.rate
      from public.fx_rates r
      where r.currency = upper(p_currency)
        and r.rate_date <= p_date
      order by r.rate_date desc
      limit 1
    )
  end;
$$;

grant execute on function public.fx_rate_on(text, date) to authenticated, service_role;
