-- Unify all alerts into ONE registry (push_alert_config). Run in the Supabase
-- SQL Editor. Safe to re-run (idempotent).
--
-- Before: two systems — scheduled digests here + hardcoded live rules / nightly
-- review in code. After: every alert is a row here, with a `mode`:
--   scheduled = timed digest push (existing 7 built-ins; daily-alerts cron)
--   live      = event-driven worklist rule (reminders rules engine)
--   night     = windowed reminder (nightly-review cron), e.g. 23:00–01:00
-- The engine + crons read `enabled` (on/off) and `audience_role` from here.

alter table public.push_alert_config
  add column if not exists mode text not null default 'scheduled',
  add column if not exists rule_key text,
  add column if not exists audience_role text,               -- all | office | admin (live/night)
  add column if not exists send_hour_end_israel int;          -- window end (night alerts)

-- One config row per rule → makes the seed idempotent and lookups unique.
create unique index if not exists push_alert_config_rule_key_uniq
  on public.push_alert_config (rule_key)
  where rule_key is not null;

-- Existing scheduled digests keep mode='scheduled' (the column default).

-- Seed the live worklist rules + the nightly review. ON CONFLICT keeps re-runs
-- and manual edits intact.
insert into public.push_alert_config (title, body, url, mode, rule_key, audience_role, enabled, send_hour_israel, send_hour_end_israel)
values
  ('משימות באיחור',              '', '/alerts',                              'live',  'task_overdue',             null,     true, 8, null),
  ('משימות לביצוע בקרוב',        '', '/tasks',                               'live',  'task_due_soon',            null,     true, 8, null),
  ('פרויקטים לקראת דדליין',      '', '/projects',                            'live',  'project_deadline',         'office', true, 8, null),
  ('פרויקטים שמתחילים בקרוב',    '', '/projects',                            'live',  'project_starting',         'office', true, 8, null),
  ('חשבוניות לא משולמות',        '', '/invoices',                            'live',  'invoice_unpaid',           'office', true, 8, null),
  ('גבייה באיחור',               '', '/collections?view=debtors',            'live',  'collection_overdue',       'office', true, 8, null),
  ('שכר עובדים באיחור',          '', '/payroll',                             'live',  'wage_overdue',             'admin',  true, 8, null),
  ('רכבים — טסט/ביטוח/רישוי',    '', '/vehicles',                            'live',  'vehicle_expiry',           'office', true, 8, null),
  ('צ׳קים לפירעון',              '', '/checks',                              'live',  'check_deposit_due',        'office', true, 8, null),
  ('תשלומים לגבייה היום',        '', '/collections?view=today',              'live',  'payment_due_today',        'office', true, 8, null),
  ('הבטחות תשלום שהופרו',        '', '/collections?view=debtors',            'live',  'promise_broken',           'office', true, 8, null),
  ('אישור הוצאות קבועות',        '', '/financial',                           'live',  'recurring_expense_confirm','office', true, 8, null),
  ('מלאי נמוך',                  '', '/inventory',                           'live',  'low_stock',                'office', true, 8, null),
  ('הוצאות לא מעובדות',          '', '/financial/statements',                'live',  'unprocessed_items',        'office', true, 8, null),
  ('שעות עבודה לשיוך',           '', '/payroll',                             'live',  'session_unallocated',      'admin',  true, 8, null),
  ('פרויקטים פעילים',            '', '/projects',                            'live',  'active_projects',          'all',    true, 8, null),
  ('עדכון הובלות ופרויקטים (לילה)', 'הובלות ופרויקטים חדשים מהיום לעדכון', '/sales', 'night', 'nightly_review', 'office', true, 23, 1)
-- The partial unique index requires its predicate here for ON CONFLICT inference.
on conflict (rule_key) where rule_key is not null do nothing;
