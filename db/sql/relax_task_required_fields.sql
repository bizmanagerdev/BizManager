-- Run this in Supabase SQL Editor. Safe to re-run (idempotent).
--
-- A task can now be created with only a name (subject). All other details
-- (due date, assignee, etc.) are optional and can be filled in later by opening
-- the card. Drop the NOT NULL constraints on the fields the UI no longer forces.
--
-- business_domain stays NOT NULL — the app always supplies a value (it defaults
-- to 'general_business' when the user doesn't pick a domain), and the
-- tasks_business_domain_target_check constraint relies on it.

do $$
begin
  alter table public.tasks alter column due_date drop not null;
exception when others then
  null; -- already nullable
end $$;

do $$
begin
  alter table public.tasks alter column assigned_user_id drop not null;
exception when others then
  null; -- already nullable
end $$;
