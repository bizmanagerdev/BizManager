-- ════════════════════════════════════════════════════════════════════════════
-- LOCAL DEV / E2E SEED ONLY. Run automatically by `supabase start` and
-- `supabase db reset` against the LOCAL Docker stack — never applied to the
-- linked remote project (db:push does not touch this file). Safe to re-run:
-- every insert is idempotent (on conflict do nothing / upsert by fixed id).
--
-- Seeds one login per role so Playwright specs (see playwright/) can sign in
-- without ever touching production data. Fixed, well-known ids/emails/
-- passwords on purpose — this is a throwaway local database, not a secret.
-- ════════════════════════════════════════════════════════════════════════════

-- Standard local-dev pattern for creating a real, sign-in-able Supabase Auth
-- user via raw SQL (pgcrypto's crypt()/gen_salt() are what GoTrue itself uses
-- to hash passwords) — bypasses the Auth API entirely, which is fine here
-- since seed.sql runs as the postgres superuser before RLS/anything else.
do $$
declare
  v_users jsonb := '[
    {"id": "00000000-0000-0000-0000-0000000e2e01", "email": "e2e-admin@bizh.test",  "full_name": "E2E Admin",  "role": "admin"},
    {"id": "00000000-0000-0000-0000-0000000e2e02", "email": "e2e-office@bizh.test", "full_name": "E2E Office", "role": "office"},
    {"id": "00000000-0000-0000-0000-0000000e2e03", "email": "e2e-worker@bizh.test", "full_name": "E2E Worker", "role": "worker"}
  ]';
  v_row jsonb;
  v_id uuid;
begin
  for v_row in select * from jsonb_array_elements(v_users) loop
    v_id := (v_row->>'id')::uuid;

    insert into auth.instances (id) values ('00000000-0000-0000-0000-000000000000')
    on conflict (id) do nothing;

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_id,
      'authenticated',
      'authenticated',
      v_row->>'email',
      -- Every seeded user shares this password: e2e-test-password-123
      crypt('e2e-test-password-123', gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      '{}',
      '', '', '', ''
    )
    on conflict (id) do update set encrypted_password = excluded.encrypted_password;

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      v_id, v_id, v_id,
      jsonb_build_object('sub', v_id::text, 'email', v_row->>'email'),
      'email', now(), now(), now()
    )
    on conflict (provider_id, provider) do nothing;

    -- users.id IS the auth uid (see [[users-identity-auth-user-id]] project memory)
    -- — auth_user_id is kept in sync too since a couple of routes match on it.
    insert into public.users (id, auth_user_id, full_name, email, role, active, system_access, payroll_worker_type)
    values (v_id, v_id, v_row->>'full_name', v_row->>'email', (v_row->>'role')::user_role_enum, true, true, 'monthly_payslip')
    on conflict (id) do update set
      auth_user_id = excluded.auth_user_id,
      role = excluded.role,
      active = true,
      system_access = true;
  end loop;
end $$;
