-- ════════════════════════════════════════════════════════════════════════════
-- document_categories — the admin-editable registry behind documents.document_type
--
-- WHY
-- `documents.document_type` is free text with no constraint, and it has been
-- carrying FOUR different vocabularies at once: a controlled Hebrew list, 11
-- English *source* codes written by upload routes (task_attachment, …), the
-- `morning_<id>` numerics from GreenInvoice, and whatever anyone typed. On top
-- of that a category could never DO anything — the table has no date, so
-- "ביטוח" could not expire and "מסמכי רכישה" could not be a checklist item.
--
-- This table turns a category into a row that carries BEHAVIOR:
--   tracks_expiry  → feeds the document_expiry alert rule
--   required_for   → feeds the "מסמכים חסרים" checklist on an entity page
--   is_money_doc   → must end up tied to an expense/payment row
--
-- `code` IS THE STORED VALUE and is immutable; `label` is what admins rename.
-- For the 17 existing controlled categories the code IS the Hebrew string, so
-- this migration needs no backfill of `documents` at all and the archive reads
-- identically the moment it runs.
--
-- NOT an FK from documents.document_type. Thousands of rows hold values outside
-- any registry, `morning_*` codes are minted at runtime by an external
-- integration, and `vehicle_photo` is an RLS predicate — an FK there would turn
-- one careless cascade into a silent revocation of worker access.
--
-- Idempotent. db/sql is frozen; new schema goes here.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.document_categories (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,              -- immutable; lands in documents.document_type
  label            text not null,                     -- Hebrew, admin-renameable
  kind             text not null default 'user',      -- user | system (system = locked in the editor)
  tracks_expiry    boolean not null default false,
  expiry_lead_days int not null default 30,
  required_for     text[] not null default '{}',      -- vehicle | property | project | customer
  is_money_doc     boolean not null default false,
  is_photo         boolean not null default false,
  active           boolean not null default true,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.document_categories drop constraint if exists document_categories_kind_check;
alter table public.document_categories
  add constraint document_categories_kind_check check (kind in ('user', 'system'));

alter table public.document_categories drop constraint if exists document_categories_lead_days_check;
alter table public.document_categories
  add constraint document_categories_lead_days_check check (expiry_lead_days between 0 and 365);

create index if not exists document_categories_active_idx
  on public.document_categories (active, sort_order);

-- ── Seed ────────────────────────────────────────────────────────────────────
-- `on conflict (code) do nothing` so re-running never clobbers admin edits.

-- The 17 controlled Hebrew categories (codes verbatim from lib/documents.ts).
-- Expiry is on ביטוח / תעודה-רישיון / חוזה-הסכם only.
-- required_for is seeded for VEHICLES and PROPERTIES only — projects and
-- customers get the checklist UI with nothing required until an admin says so.
insert into public.document_categories
  (code, label, kind, tracks_expiry, is_money_doc, is_photo, required_for, sort_order)
values
  ('חשבונית',          'חשבונית',          'user', false, true,  false, '{}',        10),
  ('חשבונית מס/קבלה',  'חשבונית מס/קבלה',  'user', false, true,  false, '{}',        20),
  ('קבלה',             'קבלה',             'user', false, true,  false, '{}',        30),
  ('הצעת מחיר',        'הצעת מחיר',        'user', false, true,  false, '{}',        40),
  ('הזמנה',            'הזמנה',            'user', false, false, false, '{}',        50),
  ('חוזה/הסכם',        'חוזה/הסכם',        'user', true,  false, false, '{}',        60),
  ('ביטוח',            'ביטוח',            'user', true,  false, false, '{vehicle}', 70),
  ('מסמכי רכישה',      'מסמכי רכישה',      'user', false, false, false, '{property}', 80),
  ('נסח טאבו',         'נסח טאבו',         'user', false, false, false, '{property}', 90),
  ('תעודת משלוח',      'תעודת משלוח',      'user', false, false, false, '{}',        100),
  ('אישור תשלום',      'אישור תשלום',      'user', false, true,  false, '{}',        110),
  ('צק',               'צק',               'user', false, true,  false, '{}',        120),
  ('תעודה/רישיון',     'תעודה/רישיון',     'user', true,  false, false, '{vehicle}', 130),
  ('קנס',              'קנס',              'user', false, true,  false, '{}',        140),
  ('צילום',            'צילום',            'user', false, false, true,  '{}',        150),
  ('מסמך כללי',        'מסמך כללי',        'user', false, false, false, '{}',        160),
  ('אחר',              'אחר',              'user', false, false, false, '{}',        170)
on conflict (code) do nothing;

-- Two new money categories, so a statement stops being filed under its source code.
insert into public.document_categories (code, label, kind, is_money_doc, sort_order)
values
  ('דף חיוב אשראי', 'דף חיוב אשראי', 'user', true, 180),
  ('דף עובר ושב',   'דף עובר ושב',   'user', true, 190)
on conflict (code) do nothing;

-- ── System codes ────────────────────────────────────────────────────────────
-- Registered so the archive can label them from the table instead of a
-- hardcoded map. kind='system' → label-only in the editor, never deletable.
--
-- 🔴 `vehicle_photo` IS A SECURITY PREDICATE. The RLS policies
-- `documents_worker_select_vehicle_photo` / `documents_worker_delete_vehicle_photo`
-- (baseline + 20260908083000_worker_vehicle_photo_rls.sql) match this literal
-- string. Renaming the CODE revokes worker access to vehicle photos. The label
-- is safe to change; the code is not.
insert into public.document_categories (code, label, kind, is_photo, sort_order)
values
  ('order_delivery_image', 'צילום משלוח',      'system', true,  500),
  ('project_photo',        'צילום פרויקט',     'system', true,  510),
  ('vehicle_photo',        'צילום רכב',        'system', true,  520),
  ('project_document',     'מסמך פרויקט',      'system', false, 530),
  ('session_attachment',   'צרופת דיווח שעות', 'system', false, 540),
  ('expense_attachment',   'צרופת הוצאה',      'system', false, 550),
  ('payment_attachment',   'אסמכתת תשלום',     'system', false, 560),
  ('task_attachment',      'צרופת משימה',      'system', false, 570),
  ('card_statement',       'דף חיוב אשראי',    'system', false, 580),
  ('bank_statement',       'דף עובר ושב',      'system', false, 590),
  ('loan_document',        'מסמך הלוואה',      'system', false, 600),
  ('general_document',     'מסמך כללי',        'system', false, 610)
on conflict (code) do nothing;

-- Morning / GreenInvoice document type ids, stored as `morning_<id>`.
insert into public.document_categories (code, label, kind, is_money_doc, sort_order)
values
  ('morning_10',  'הצעת מחיר',       'system', true, 700),
  ('morning_305', 'חשבונית מס',      'system', true, 710),
  ('morning_320', 'חשבונית מס/קבלה', 'system', true, 720),
  ('morning_400', 'קבלה',            'system', true, 730)
on conflict (code) do nothing;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.document_categories enable row level security;

-- Staff READ. Workers are included deliberately: they upload vehicle photos and
-- the UI renders category labels from this table. Mirrors the tags read policy
-- (20260901092153) — role + active + system_access, not bare `authenticated`.
drop policy if exists "Read document categories" on public.document_categories;
create policy "Read document categories" on public.document_categories
  for select to authenticated
  using (exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid()
      and u.role in ('admin', 'office', 'worker')
      and u.active = true
      and coalesce(u.system_access, false) = true
  ));

-- Admin WRITE only, matching the dunning_stages precedent.
drop policy if exists "Admin manage document categories" on public.document_categories;
create policy "Admin manage document categories" on public.document_categories
  for all to authenticated
  using (exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid() and u.role = 'admin' and u.active = true
  ))
  with check (exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid() and u.role = 'admin' and u.active = true
  ));
