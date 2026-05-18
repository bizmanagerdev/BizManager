-- Full-CRUD push notification scheduler.
-- Run once in Supabase SQL Editor (drops old table first).

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

alter table public.push_alert_config enable row level security;

create policy "Admin only"
  on public.push_alert_config
  for all
  using (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin' and active = true)
  )
  with check (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin' and active = true)
  );
