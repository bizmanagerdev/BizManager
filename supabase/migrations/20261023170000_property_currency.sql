-- Money in US$ and C$, step 7 of 9: a property's currency (owner, 2026-10-23:
-- the Canada buildings — "I want the totals here to show the shekel, the
-- dollar, and the Canadian").
--
-- The currency its money is usually in: what a new expense or income on its
-- page starts in, what its purchase price and purchase tax are in, and — for
-- US$ or C$ — that its page sums its money in ₪, $ and C$, each movement at its
-- own day's rate. Its rows keep their own currency (supabase/migrations/
-- 20261023120000_money_currency.sql); this changes none of them, so it can be
-- changed at any time.
--
-- Every property stays ₪: a constant default is only written to the catalog,
-- no row is rewritten.

alter table public.properties
  add column if not exists currency text not null default 'ILS';

alter table public.properties drop constraint if exists properties_currency_check;
alter table public.properties
  add constraint properties_currency_check check (currency in ('ILS', 'USD', 'CAD'));

comment on column public.properties.currency is
  'ILS | USD | CAD — its money''s usual currency: new rows on its page start in it, its purchase price and tax are in it, and a US$/C$ property''s page totals show ₪, $ and C$.';
