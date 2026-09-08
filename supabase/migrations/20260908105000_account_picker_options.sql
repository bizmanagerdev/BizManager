-- `accounts` has exactly one policy — "Staff manage accounts" (admin/office) —
-- so AccountSelect, which reads the table straight from the browser client
-- (lib/accounts/accountsClient.ts), comes back EMPTY for a worker.
--
-- That isn't just a cosmetic gap: the vehicle income dialog's guard is
--   if (incAccountsList.length > 0 && !incAccountId) → "יש לבחור חשבון"
-- (the length check exists so a business with no accounts configured yet isn't
-- blocked). An empty list therefore skips validation entirely and posts
-- account_id: null — a vehicles-access worker booking an expense or income on
-- a car silently files it against no account at all. Same dialog, same guard,
-- in ExpenseDialog.
--
-- The fix is deliberately NOT a select policy on `accounts`: that table carries
-- opening_balance, and handing every vehicles worker the company's account
-- balances is a much wider grant than "book this fuel receipt correctly". This
-- SECURITY DEFINER function returns only what a PICKER needs — id, name, kind,
-- sort order — for ACTIVE accounts, and only to someone who may use the picker.
-- Staff are included so the function is the one answer to "what belongs in an
-- account dropdown", rather than a worker-only side door.

create or replace function public.account_picker_options()
returns table (
  id uuid,
  name text,
  kind text,
  is_active boolean,
  sort_order integer
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.name, a.kind, a.is_active, a.sort_order
  from public.accounts a
  where a.is_active = true
    and exists (
      select 1 from public.users u
      where u.auth_user_id = (select auth.uid())
        and u.active = true
        and coalesce(u.system_access, false) = true
        and (
          u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum])
          or (u.role = 'worker'::user_role_enum and coalesce((u.section_access->>'vehicles')::boolean, false))
        )
    )
  order by a.sort_order, a.name;
$$;

grant execute on function public.account_picker_options() to authenticated;
