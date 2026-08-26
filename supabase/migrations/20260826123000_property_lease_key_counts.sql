-- Keys: how many the apartment HAS, and how many the tenant GOT.
--
-- Two different facts that must not collapse into one number. The property's
-- count is a permanent attribute of the asset (the full set the office holds);
-- the lease's count is what was handed over to THIS tenant at move-in, which is
-- what you check against at move-out, and what stays on the record after the
-- tenant leaves. A property with 4 keys can have a tenant holding 2.
alter table public.properties
  add column if not exists key_count integer;

alter table public.lease_agreements
  add column if not exists keys_handed_over integer;
