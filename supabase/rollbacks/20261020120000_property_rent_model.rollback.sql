-- Undoes supabase/migrations/20261020120000_property_rent_model.sql.
-- Drops the new columns (and whatever was filled into them) and the rent
-- alert's row. Take a copy of the filled columns first if they matter:
--   create table backup.payments_rent_periods as
--     select id, lease_id, rent_period_start, rent_periods from public.payments where lease_id is not null or rent_period_start is not null;

set lock_timeout = '5s';

delete from public.push_alert_config where rule_key = 'rent_due';

alter table public.push_alert_config
  drop constraint if exists push_alert_config_days_before_check,
  drop column if exists days_before;

alter table public.properties
  drop column if exists sort_order;

alter table public.lease_agreements
  drop constraint if exists lease_agreements_rent_calendar_check,
  drop constraint if exists lease_agreements_rent_hebrew_day_check,
  drop constraint if exists lease_agreements_hebrew_needs_day_check,
  drop constraint if exists lease_agreements_period_months_check,
  drop constraint if exists lease_agreements_area_sqm_check,
  drop column if exists rent_calendar,
  drop column if exists rent_hebrew_day,
  drop column if exists period_months,
  drop column if exists area_sqm,
  drop column if exists unit_label;

drop index if exists public.payments_lease_id_idx;

alter table public.payments
  drop constraint if exists payments_rent_periods_check,
  drop column if exists lease_id,
  drop column if exists rent_period_start,
  drop column if exists rent_periods,
  drop column if exists counts_as_rent;
