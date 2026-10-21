-- ════════════════════════════════════════════════════════════════════════════
-- Rent, as the property pages need it (owner, 2026-10-20 — the ניהול נכסים
-- card: "every rent payment says which month it covers", "a lease paid on the
-- Hebrew date … every א׳ of the month, that's when it's due", "storage: some
-- pay once a year, some once a month, how many meters", "drag the properties
-- into my own order", "admins choose to get the rent alert, and how many days
-- before"). Answers 2026-10-20: the הר יונה leases are paid on א׳ of each
-- Hebrew month, and a Hebrew leap year (two Adars) has 13 payments.
--
--   payments.lease_id            the lease this payment is rent for — empty
--                                for property income that isn't rent (a refund)
--   payments.rent_period_start   the first rent period it pays for: the day
--                                that period starts (1 Nov, or א׳ חשון's date)
--   payments.rent_periods        how many periods it pays (2 = "שולם לחודשיים")
--   payments.counts_as_rent      false for property income that isn't rent (a
--                                refund); everything else counts as rent, even
--                                when it came in without its lease (owner:
--                                "everything counts as rent unless marked")
--   lease_agreements.rent_calendar     'gregorian' | 'hebrew'
--   lease_agreements.rent_hebrew_day   the Hebrew day it's due (1–30)
--   lease_agreements.period_months     1 = monthly, 12 = yearly; the lease's
--                                      amount (monthly_rent_amount) is per period
--   lease_agreements.area_sqm          a storage spot's size
--   lease_agreements.unit_label        which spot: "תא 4", "מחסן ליד D4"
--   properties.sort_order              the list's order, dragged by hand
--   push_alert_config.days_before      how many days before an alert comes
--                                      (the rent alert's 2)
-- and the rent alert itself (rule_key rent_due), for admins at 8:00.
--
-- Only ADDS columns, with no default or a constant one, and one new alert row:
-- no existing row changes. The payments' periods are filled afterwards, from
-- a list the owner checks first.
--
-- The phone copy: the powersync publication has no column lists and the sync
-- rules select these tables with *, so the new columns reach devices without
-- a rules deploy; lib/powersync/schema.ts lists them where the app reads them.
--
-- ROLLBACK: supabase/rollbacks/20261020120000_property_rent_model.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

set lock_timeout = '5s';

alter table public.payments
  add column if not exists lease_id uuid references public.lease_agreements(id) on delete set null,
  add column if not exists rent_period_start date,
  add column if not exists rent_periods smallint not null default 1,
  add column if not exists counts_as_rent boolean not null default true;

alter table public.payments
  drop constraint if exists payments_rent_periods_check,
  add constraint payments_rent_periods_check check (rent_periods between 1 and 24);

create index if not exists payments_lease_id_idx on public.payments (lease_id) where lease_id is not null;

alter table public.lease_agreements
  add column if not exists rent_calendar text not null default 'gregorian',
  add column if not exists rent_hebrew_day smallint,
  add column if not exists period_months smallint not null default 1,
  add column if not exists area_sqm numeric,
  add column if not exists unit_label text;

alter table public.lease_agreements
  drop constraint if exists lease_agreements_rent_calendar_check,
  add constraint lease_agreements_rent_calendar_check check (rent_calendar in ('gregorian', 'hebrew')),
  drop constraint if exists lease_agreements_rent_hebrew_day_check,
  add constraint lease_agreements_rent_hebrew_day_check check (
    rent_hebrew_day is null or rent_hebrew_day between 1 and 30
  ),
  drop constraint if exists lease_agreements_hebrew_needs_day_check,
  add constraint lease_agreements_hebrew_needs_day_check check (
    rent_calendar <> 'hebrew' or rent_hebrew_day is not null
  ),
  drop constraint if exists lease_agreements_period_months_check,
  add constraint lease_agreements_period_months_check check (period_months in (1, 12)),
  drop constraint if exists lease_agreements_area_sqm_check,
  add constraint lease_agreements_area_sqm_check check (area_sqm is null or area_sqm > 0);

alter table public.properties
  add column if not exists sort_order integer;

alter table public.push_alert_config
  add column if not exists days_before smallint;

alter table public.push_alert_config
  drop constraint if exists push_alert_config_days_before_check,
  add constraint push_alert_config_days_before_check check (days_before is null or days_before between 0 and 30);

-- The rent alert: admins, 8:00, two days before the rent is due.
insert into public.push_alert_config
  (title, body, url, alert_type, enabled, send_hour_israel, schedule, recipient_user_ids, sort_order, mode, rule_key, audience_role, days_before)
select 'שכירות לגבייה', '', '/properties', null, true, 8, 'daily', '{}', 0, 'live', 'rent_due', 'admin', 2
where not exists (select 1 from public.push_alert_config where rule_key = 'rent_due');
