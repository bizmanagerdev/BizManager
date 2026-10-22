-- ════════════════════════════════════════════════════════════════════════════
-- Rent checks torn up, and rent paid for months ticked one by one (owner,
-- 2026-10-22).
--
--   payments.check_torn_at    when a check was torn up because its month was
--                             paid another way ("if he paid a different way
--                             that month, then we rip up that check … mark it
--                             as ripped … so that we could bring it back").
--                             Its status is 'rejected' too, so it counts
--                             nowhere; cleared when it's brought back.
--   payments.rent_allocation  the rent months a payment was recorded for and
--                             how much of it went to each — "I choose what
--                             months it will cover": [{"period":"YYYY-MM-DD",
--                             "amount":n}], each period that month's due date.
--                             Null: split evenly over rent_period_start and
--                             rent_periods, as before.
--
-- Both run on the live database 2026-10-22 (check_torn_at first, on its own).
-- Nothing already saved changes. Rollback: supabase/rollbacks/.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.payments add column if not exists check_torn_at timestamptz;

alter table public.payments add column if not exists rent_allocation jsonb;
comment on column public.payments.rent_allocation is 'Rent months ticked for this payment and how much went to each: [{"period":"YYYY-MM-DD","amount":n}]. Null: split evenly over rent_period_start + rent_periods (owner, 2026-10-22).';
