-- Clear the leftover placeholder values off customers (email / city / address).
--
-- Background: the old db/sql customers_required_delivery_fields.sql once forced
-- email/city/address NOT NULL and backfilled every blank one with a fake value —
-- 'missing@example.com' for email and 'לא הוגדר' ("not defined") for city and
-- address. The NOT NULL on email/address was already reverted (20260701000000);
-- city is still NOT NULL (20260701010000) and form-required, so it gets an empty
-- string rather than NULL. The app now stores NULL/empty for a blank field, so
-- these placeholders are stale data that make "no value" read as a fake value.
--
-- This restores blanks: email/address -> NULL, city -> '' (keeps NOT NULL valid).
-- Idempotent: a no-op once no row holds a placeholder.

update public.customers
  set email = null
  where trim(lower(email)) = 'missing@example.com';

update public.customers
  set address = null
  where trim(address) = 'לא הוגדר';

update public.customers
  set city = ''
  where trim(city) = 'לא הוגדר';
