-- ════════════════════════════════════════════════════════════════════════════
-- LOGIN/LOGOUT TRACKING — allow every user to record their own access events
-- Run in the Supabase SQL Editor.
--
-- The app writes a row into public.audit_logs on each login/logout, using the
-- signed-in user's own JWT. If the audit_logs RLS only lets admin/office insert,
-- worker logins would be silently dropped. This policy lets ANY authenticated
-- user insert ONLY their own auth login/logout rows (table_name = 'auth',
-- changed_by = their own users.id) — nothing else.
-- ════════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'audit_logs'
      and policyname = 'audit_self_login_events'
  ) then
    execute $pol$
      create policy audit_self_login_events
        on public.audit_logs
        for insert
        to authenticated
        with check (
          table_name = 'auth'
          and action in ('login', 'logout')
          and changed_by = (
            select u.id from public.users u
            where u.auth_user_id = auth.uid()
          )
        )
    $pol$;
  end if;
end$$;
