-- ════════════════════════════════════════════════════════════════════════════
-- ישיבה שבועית — the weekly office meeting
--
-- The meeting is run FROM the app: a checklist the manager walks top to bottom
-- on a shared screen, every item linking to the page that answers it. Four
-- tables, and the split between the first two is the whole design:
--
--   meeting_templates  — the AGENDA ITSELF, as editable rows. The 12 agenda
--                        items and the 3 prep items are seeded here, NOT
--                        hardcoded in the page, because the user said plainly
--                        he will keep refining them. Add / edit / reorder /
--                        disable all happen here.
--   meetings           — one row per week: its date, its notes, the numbers as
--                        they stood that morning (frozen), and the collection
--                        target set for the week AFTER it.
--   meeting_items      — the template rows COPIED onto a meeting when it opens.
--                        A copy, not a join: editing the agenda next month must
--                        not rewrite what last month's meeting actually said.
--                        This is also where a carried-over item records where
--                        it came from.
--   meeting_task_links — which tasks came out of which meeting item. This is
--                        what feeds agenda item 0 ("התחייבויות משבוע שעבר"):
--                        last meeting's links, with each task's current status.
--
-- Admin + office manage; every system user may read (a worker can be assigned
-- a prep item and has to see it). Idempotent; safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. The configurable agenda ──────────────────────────────────────────────
create table if not exists public.meeting_templates (
  id uuid primary key default gen_random_uuid(),
  -- 'prep'   = done BEFORE the meeting by an assigned worker
  -- 'agenda' = walked through DURING the meeting
  kind text not null check (kind in ('prep', 'agenda')),
  -- Display order within its kind. Sparse (10, 20, 30…) so a row can be
  -- dropped between two others without renumbering the whole list.
  position integer not null default 0,
  title text not null,
  -- The short "what we actually check" lines under the title. An array rather
  -- than one text blob so the UI can render them as a list and the user can
  -- edit them one at a time.
  subpoints text[] not null default '{}',
  -- The page this item opens, filters and all (e.g. '/projects?view=closed').
  -- Relative app paths only — validated in the UI, not here, since a check
  -- constraint on a user-edited field is a support call waiting to happen.
  link_href text,
  link_label text,
  -- Prep rows only: who normally does this one. Copied onto each new meeting's
  -- item as its starting assignee; changing it there doesn't change the default.
  default_assignee_id uuid references public.users(id) on delete set null,
  -- A row the page renders specially instead of as a plain checkbox:
  --   'previous_tasks' — agenda item 0, auto-filled from last meeting's tasks.
  -- null = an ordinary item. Unknown values render as ordinary items, so a
  -- future value can be added here before the UI knows about it.
  auto_source text,
  -- Disabled rows stay in the table (and in the history of every meeting that
  -- already copied them) but are not copied onto new meetings.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 2. One weekly record ────────────────────────────────────────────────────
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  -- One meeting per date — the natural key, and what makes "this week's
  -- meeting" a lookup rather than a guess.
  meeting_date date not null unique,
  status text not null default 'open' check (status in ('open', 'closed')),
  -- The meeting's own free-text notes, separate from the per-item notes.
  notes text,
  -- The week's numbers, frozen at the moment the meeting was opened. Stored
  -- rather than recomputed so reopening a meeting from March still shows what
  -- was on screen in March, not what the same query returns today. Shape is
  -- lib/meetings/stats.ts's WeekStats.
  stats jsonb,
  -- The collection goal agreed AT this meeting, FOR the coming week. Next
  -- week's header strip reads it back off the previous meeting to show
  -- "נגבה השבוע vs היעד".
  collection_target numeric,
  -- When the next meeting is expected — the default due date for every task
  -- created from this one.
  next_meeting_date date,
  created_by uuid references public.users(id) on delete set null,
  closed_at timestamptz,
  closed_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 3. The items as they stood at THIS meeting ──────────────────────────────
create table if not exists public.meeting_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  -- Where it came from. set null (not cascade): deleting a template must not
  -- erase the item from meetings that already happened.
  template_id uuid references public.meeting_templates(id) on delete set null,
  kind text not null check (kind in ('prep', 'agenda')),
  position integer not null default 0,
  -- Title / subpoints / link are COPIED from the template, not read through it
  -- — see the table comment above.
  title text not null,
  subpoints text[] not null default '{}',
  link_href text,
  link_label text,
  auto_source text,
  is_done boolean not null default false,
  done_by uuid references public.users(id) on delete set null,
  done_at timestamptz,
  -- Prep rows: who owes this one. Agenda rows leave it null.
  assigned_user_id uuid references public.users(id) on delete set null,
  -- Free text: the mismatches found in prep, what was decided on an agenda item.
  notes text,
  -- Set when this item arrived unchecked from an earlier meeting, pointing at
  -- the meeting it failed to get done in.
  carried_over_from uuid references public.meetings(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One copy of a given template per meeting. Partial, because a hand-added item
-- (no template behind it) has a null template_id and several of those on one
-- meeting are perfectly legal — a plain unique constraint would not catch the
-- duplicate it is meant to catch anyway, since null <> null in SQL.
create unique index if not exists meeting_items_meeting_template_unique
  on public.meeting_items (meeting_id, template_id)
  where template_id is not null;

create index if not exists meeting_items_meeting_idx
  on public.meeting_items (meeting_id, kind, position);

-- ── 4. Tasks that came out of a meeting ─────────────────────────────────────
create table if not exists public.meeting_task_links (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  -- Which item it was raised under, so item 0 can group last week's tasks by
  -- the subject they came from. set null so deleting one item doesn't take the
  -- task's link to the meeting with it.
  meeting_item_id uuid references public.meeting_items(id) on delete set null,
  -- cascade: a deleted task has no status to report, so its link is noise.
  task_id uuid not null references public.tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint meeting_task_links_meeting_task_unique unique (meeting_id, task_id)
);

create index if not exists meeting_task_links_meeting_idx
  on public.meeting_task_links (meeting_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Admin + office only, for READ as much as for write.
--
-- Not "every system user can read": the meeting's notes are where the bank
-- discrepancies, the collection targets and the payroll-adjacent decisions get
-- written down, and a worker has no business reading them. The page itself is
-- behind requireStaffPage(), so a wider SELECT policy would grant nothing a
-- worker could use and everything an API call could scrape — exactly the shape
-- of leak the 2026-09-01 RLS audit closed elsewhere.
--
-- If a worker is ever to own a prep item, the way in is a TASK assigned to him
-- (which already has its own worker policies), not read access to the meeting.
alter table public.meeting_templates enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_items enable row level security;
alter table public.meeting_task_links enable row level security;

-- Written out one table at a time rather than generated in a loop: a policy
-- built with execute format() is invisible to the static RLS guard in
-- __tests__/security/rls-policies.test.ts, which exists to catch exactly the
-- "RLS enabled, no policy, everyone locked out" mistake. Four repetitions are
-- cheaper than a guard that cannot see this file.
--
-- The "System users can read …" drops are for narrowing an earlier install of
-- this same migration: RLS policies are OR-ed, so a stale permissive one left
-- in place would still let workers read the meeting.

drop policy if exists "System users can read meeting_templates" on public.meeting_templates;
drop policy if exists "Staff can manage meeting_templates" on public.meeting_templates;
create policy "Staff can manage meeting_templates"
on public.meeting_templates
for all
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.active = true
      and coalesce(u.system_access, false) = true
      and u.role in ('admin', 'office')
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.active = true
      and coalesce(u.system_access, false) = true
      and u.role in ('admin', 'office')
  )
);

drop policy if exists "System users can read meetings" on public.meetings;
drop policy if exists "Staff can manage meetings" on public.meetings;
create policy "Staff can manage meetings"
on public.meetings
for all
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.active = true
      and coalesce(u.system_access, false) = true
      and u.role in ('admin', 'office')
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.active = true
      and coalesce(u.system_access, false) = true
      and u.role in ('admin', 'office')
  )
);

drop policy if exists "System users can read meeting_items" on public.meeting_items;
drop policy if exists "Assignee can update own prep item" on public.meeting_items;
drop policy if exists "Staff can manage meeting_items" on public.meeting_items;
create policy "Staff can manage meeting_items"
on public.meeting_items
for all
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.active = true
      and coalesce(u.system_access, false) = true
      and u.role in ('admin', 'office')
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.active = true
      and coalesce(u.system_access, false) = true
      and u.role in ('admin', 'office')
  )
);

drop policy if exists "System users can read meeting_task_links" on public.meeting_task_links;
drop policy if exists "Staff can manage meeting_task_links" on public.meeting_task_links;
create policy "Staff can manage meeting_task_links"
on public.meeting_task_links
for all
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.active = true
      and coalesce(u.system_access, false) = true
      and u.role in ('admin', 'office')
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.active = true
      and coalesce(u.system_access, false) = true
      and u.role in ('admin', 'office')
  )
);

grant select, insert, update, delete on public.meeting_templates to authenticated;
grant select, insert, update, delete on public.meetings to authenticated;
grant select, insert, update, delete on public.meeting_items to authenticated;
grant select, insert, update, delete on public.meeting_task_links to authenticated;

-- ── Seed: the agenda as the user specified it ───────────────────────────────
-- Seeded once. Re-running the migration must NOT resurrect a row the user
-- deleted or undo a title he rewrote, so the guard is "is this table empty",
-- not a per-row upsert.
insert into public.meeting_templates (kind, position, title, subpoints, link_href, link_label, auto_source)
select * from (values
  -- הכנה לישיבה — done before the meeting.
  ('prep',   10, 'התאמת בנקים',
   array['השוואת היתרות בבנק מול המערכת', 'רישום כל פער שנמצא בהערות'],
   '/financial/bank', 'פתיחת חשבונות', null),
  ('prep',   20, 'צפי תזרים',
   array['סינון לשבוע הקרוב', 'הרצת "כמה צריך?"'],
   '/financial/payments-calendar?dir=all', 'פתיחת צפי תזרים', null),
  ('prep',   30, 'התחייבויות קבועות',
   array['מה חדש', 'מה השתנה', 'מה הסתיים', 'מה התייקר'],
   '/financial/payments-calendar?tab=recurring&dir=all', 'פתיחת קבועות', null),

  -- סדר היום — walked through during the meeting.
  ('agenda',  0, 'התחייבויות משבוע שעבר',
   array['מה נסגר ומה לא', 'מה ממשיך לשבוע הזה'],
   '/tasks?scope=all', 'פתיחת משימות', 'previous_tasks'),
  ('agenda', 10, 'חריגות בנק',
   array['מעבר על הפערים שנמצאו בהכנה', 'מה מוסבר ומה דורש בירור'],
   '/financial/bank', 'פתיחת חשבונות', null),
  ('agenda', 20, 'צפי תזרים',
   array['מה נכנס ומה יוצא השבוע', 'האם צפוי חוסר'],
   '/financial/payments-calendar?dir=all', 'פתיחת צפי תזרים', null),
  ('agenda', 30, 'גבייה',
   array['סימון חובות ששולמו בפועל', 'אישור שהיתר לא שולם',
         'בדיקה שסך הגבייה תואם את צפי תזרים לגבייה + באיחור',
         'קביעת יעד גבייה לשבוע הבא', 'חלוקת לקוחות בין העובדים'],
   '/collections', 'פתיחת גבייה', null),
  ('agenda', 40, 'צ׳קים השבוע',
   array['צ׳קים שמועד הפקדתם השבוע'],
   '/checks', 'פתיחת צ׳קים', null),
  ('agenda', 50, 'פרויקטים – שבוע שעבר',
   array['המערכת תואמת למציאות: פרויקטים, הוצאות, תשלומים, מסמכים',
         'סימון תשלומים שהתקבלו'],
   '/projects?view=closed&sort=recent', 'פתיחת פרויקטים שנסגרו', null),
  ('agenda', 60, 'פרויקטים – קדימה',
   array['הוספת פרויקטים קרובים', 'מה צריך להכין', 'משימות לעובדים'],
   '/projects?status=planned', 'פתיחת פרויקטים מתוכננים', null),
  ('agenda', 70, 'נכסים',
   array['התקדמות בנכסים', 'תיקונים דחופים ובעיות דיירים',
         'שכירות, משכנתא וחשבונות שולמו'],
   '/properties', 'פתיחת נכסים', null),
  ('agenda', 80, 'מכירות',
   array['הזמנות חריגות', 'מלאי נמוך ומשלוחים מארה״ב', 'משלוחים ישנים שתקועים'],
   '/sales', 'פתיחת מכירות', null),
  ('agenda', 90, 'משימות',
   array['משימות פתוחות, באיחור קודם', 'מי תקוע או חסר מסמכים'],
   '/tasks?scope=all', 'פתיחת משימות', null),
  ('agenda',100, 'משוב על המערכת',
   array['באגים', 'דברים מעצבנים', 'רעיונות מהצוות'],
   null, null, null),
  ('agenda',110, 'סבב התראות',
   array['סריקה אחרונה של ההתראות הפתוחות', 'לכל התראה פתוחה יש אחראי'],
   '/inbox', 'פתיחת התראות', null)
) as seed(kind, position, title, subpoints, link_href, link_label, auto_source)
where not exists (select 1 from public.meeting_templates);
