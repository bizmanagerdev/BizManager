-- Reshape push_alert_config from the old single-row toggle table
-- (id=1, boolean flags) to the multi-row scheduler the app code expects
-- (title, enabled, send_hour_israel, schedule, recipient_user_ids, sort_order…).
--
-- The old table has NONE of the columns the config route / cron / settings UI
-- read, so every insert & select currently errors — which is why adding an
-- alert does nothing and scheduled alerts never fire. This is the DDL from
-- db/sql/create_push_alert_config.sql + the is_admin() RLS from
-- db/sql/fix_rls_access.sql, which were written but never applied to prod.
--
-- Idempotent: only reshapes when the new schema is not already present, so it
-- is safe to run against an already-fixed DB. The old table carries no real
-- data (a single defaults row), so dropping it loses nothing.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'push_alert_config'
      and column_name = 'title'
  ) then
    drop table if exists public.push_alert_config;

    create table public.push_alert_config (
      id                  uuid primary key default gen_random_uuid(),
      title               text not null,
      body                text not null default '',
      url                 text not null default '/alerts',
      -- 'overdue_tasks' | 'today_tasks' | 'tomorrow_tasks' | 'projects_starting' |
      -- 'projects_deadline' | 'deliveries' | 'weekly_summary' | null (custom static)
      alert_type          text,
      enabled             boolean not null default true,
      send_hour_israel    int not null default 8,            -- 0-23 Israel local time
      -- 'daily' | 'weekdays' (Sun-Thu) | 'sun'|'mon'|'tue'|'wed'|'thu'|'fri'|'sat'
      schedule            text not null default 'daily',
      recipient_user_ids  uuid[] not null default '{}',      -- empty = all subscribers
      sort_order          int not null default 0,
      created_at          timestamptz not null default now()
    );

    -- Seed the 7 built-in data-driven alerts
    insert into public.push_alert_config
      (title, body, url, alert_type, send_hour_israel, schedule)
    values
      ('משימות באיחור',           'משימות שעבר מועד הסיום שלהן',     '/tasks',    'overdue_tasks',     8,  'daily'),
      ('משימות להיום',            'משימות שצריך לסיים היום',         '/tasks',    'today_tasks',       8,  'daily'),
      ('משימות למחר',             'תזכורת ליום שאחרי',               '/tasks',    'tomorrow_tasks',    20, 'daily'),
      ('פרויקטים מתחילים השבוע', 'פרויקטים שמתחילים תוך שבוע',      '/projects', 'projects_starting', 8,  'daily'),
      ('פרויקטים קרובים לסיום',  'פרויקטים שמסתיימים תוך 3 ימים',   '/projects', 'projects_deadline', 8,  'daily'),
      ('משלוחים היום',            'הזמנות בדרך, לפי עיר',            '/sales',    'deliveries',        8,  'daily'),
      ('סיכום פרויקטים שבועי',   'כל הפרויקטים הפעילים השבוע',      '/projects', 'weekly_summary',    8,  'weekdays');
  end if;
end $$;

-- RLS: admin-only full CRUD, via is_admin(). The original "Admin only" policy
-- keyed on users.id = auth.uid() (matched nobody). Replace it idempotently.
alter table public.push_alert_config enable row level security;
drop policy if exists "Admin only" on public.push_alert_config;
drop policy if exists "push_alert_config_admin_full" on public.push_alert_config;
create policy "push_alert_config_admin_full"
  on public.push_alert_config
  for all to public
  using (is_admin())
  with check (is_admin());
