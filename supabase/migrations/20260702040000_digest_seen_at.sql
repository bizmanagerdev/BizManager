-- "What you missed" dashboard digest — per-user anchor for the since-last-here
-- feed. Run in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- digest_seen_at = the moment the user last dismissed/read the digest. The bar
-- shows meaningful events (new orders/projects/customers/payments/…) created
-- AFTER this time. Dismissing advances it to now. NULL = never dismissed → the
-- feed falls back to the user's previous login time.

alter table public.users
  add column if not exists digest_seen_at timestamptz;

comment on column public.users.digest_seen_at is
  'When the user last dismissed the dashboard "what you missed" digest. NULL = never.';

-- Let any signed-in user advance ONLY their own digest_seen_at (self-scoped,
-- security definer — mirrors set_my_worklist_prefs). Passing NULL stamps now().
create or replace function public.set_my_digest_seen_at(p_at timestamptz default null)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz := coalesce(p_at, now());
begin
  update public.users
  set digest_seen_at = v_at
  where auth_user_id = auth.uid();

  return v_at;
end;
$$;

grant execute on function public.set_my_digest_seen_at(timestamptz) to authenticated;
