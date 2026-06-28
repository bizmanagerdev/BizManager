-- ════════════════════════════════════════════════════════════════════════════
-- Generic tags backbone + Vehicles (רכבים) on top of it.
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- WHY a generic layer (the "hybrid"):
--   • `tags`        = the backbone. One row per "thing to track". kind='vehicle'
--                     for now; future kinds (campaign, equipment, event…) drop in
--                     here with NO new code.
--   • `vehicles`    = the STRUCTURED detail for kind='vehicle' (plate, טסט/ביטוח/
--                     רישוי dates). 1:1 with a tag. A plain tag can't hold these;
--                     a car needs them (and they feed the alerts engine later).
--   • `entity_tags` = the cross-cut. Polymorphic many-to-many: attach ANY tag to
--                     ANY entity (task / expense / payment / document / session).
--                     Modeled on the existing documents + document_links pattern,
--                     so NO columns are added to tasks/expenses/payments/etc.
--
-- Result: "search רכבים → see every cost, income, task & doc for the cars", and
-- pick one car to drill in. The domain (שוטף) stays put; the tag is orthogonal.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. tags: the generic backbone ──────────────────────────────────────────
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  -- 'vehicle' now; room for 'general' | 'campaign' | 'equipment' | 'event' | …
  kind text not null default 'general'
    check (kind in ('general', 'vehicle', 'campaign', 'equipment', 'event', 'vendor')),
  name text not null,                 -- "רכבים" or a specific car "טויוטה 12-345-67"
  color text null,                    -- badge tint (matches the outline-badge system)
  is_active boolean not null default true,
  notes text null,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 2. vehicles: structured detail for kind='vehicle' (1:1 with a tag) ───────
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  tag_id uuid not null unique references public.tags(id) on delete cascade,
  license_plate text null,            -- מספר רישוי
  make_model text null,               -- יצרן/דגם
  year integer null,                  -- שנת ייצור
  test_due_date date null,            -- טסט הבא
  insurance_due_date date null,       -- ביטוח עד
  license_due_date date null,         -- רישוי עד
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 3. entity_tags: the polymorphic cross-cut (many-to-many) ─────────────────
create table if not exists public.entity_tags (
  id uuid primary key default gen_random_uuid(),
  tag_id uuid not null references public.tags(id) on delete cascade,
  entity_type text not null
    check (entity_type in ('task', 'expense', 'payment', 'document', 'work_session')),
  entity_id uuid not null,
  -- for documents: which year this file is FOR (e.g. a 2026 טסט) → "search by year"
  ref_year integer null,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tag_id, entity_type, entity_id)
);

create index if not exists tags_kind_idx on public.tags (kind);
create index if not exists tags_active_idx on public.tags (is_active);
create index if not exists vehicles_tag_idx on public.vehicles (tag_id);
create index if not exists vehicles_test_due_idx on public.vehicles (test_due_date);
create index if not exists vehicles_insurance_due_idx on public.vehicles (insurance_due_date);
create index if not exists vehicles_license_due_idx on public.vehicles (license_due_date);
create index if not exists entity_tags_tag_idx on public.entity_tags (tag_id);
create index if not exists entity_tags_entity_idx on public.entity_tags (entity_type, entity_id);

-- ── 4. RLS ──────────────────────────────────────────────────────────────────
alter table public.tags        enable row level security;
alter table public.vehicles    enable row level security;
alter table public.entity_tags enable row level security;

-- tags & vehicles: any authenticated user may READ (so a worker sees which car a
-- task is about); only admin/office with system_access MANAGE them.
drop policy if exists "Read tags" on public.tags;
create policy "Read tags" on public.tags
  for select to authenticated using (true);

drop policy if exists "Staff manage tags" on public.tags;
create policy "Staff manage tags" on public.tags
  for all to authenticated
  using (exists (select 1 from public.users u
    where u.auth_user_id = auth.uid() and u.role in ('admin','office')
      and u.active = true and coalesce(u.system_access,false) = true))
  with check (exists (select 1 from public.users u
    where u.auth_user_id = auth.uid() and u.role in ('admin','office')
      and u.active = true and coalesce(u.system_access,false) = true));

drop policy if exists "Read vehicles" on public.vehicles;
create policy "Read vehicles" on public.vehicles
  for select to authenticated using (true);

drop policy if exists "Staff manage vehicles" on public.vehicles;
create policy "Staff manage vehicles" on public.vehicles
  for all to authenticated
  using (exists (select 1 from public.users u
    where u.auth_user_id = auth.uid() and u.role in ('admin','office')
      and u.active = true and coalesce(u.system_access,false) = true))
  with check (exists (select 1 from public.users u
    where u.auth_user_id = auth.uid() and u.role in ('admin','office')
      and u.active = true and coalesce(u.system_access,false) = true));

-- entity_tags: any authenticated user may read/attach/detach (so the tag picker
-- works wherever a user can already create/edit a task, expense, doc, …).
drop policy if exists "Authenticated use entity_tags" on public.entity_tags;
create policy "Authenticated use entity_tags" on public.entity_tags
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.tags        to authenticated;
grant select, insert, update, delete on public.vehicles    to authenticated;
grant select, insert, update, delete on public.entity_tags to authenticated;

-- ── 5. Per-tag rollup (SECURITY DEFINER to dodge the invoker-aggregate gotcha:
--     a SECURITY INVOKER aggregate over RLS tables would return per-role numbers.
--     DEFINER => one global figure. Admin/office are the only callers anyway.) ─
create or replace function public.tag_rollup()
returns table (
  tag_id uuid,
  total_expense_amount numeric,   -- all expenses tagged here (booked)
  paid_expense_amount  numeric,   -- the cash actually spent
  total_income_amount  numeric,   -- payments tagged here
  task_count           bigint,
  open_task_count      bigint,
  document_count       bigint
)
language sql
security definer
set search_path = public
as $$
  select
    t.id as tag_id,
    coalesce(ex.total_amount, 0),
    coalesce(ex.paid_amount, 0),
    coalesce(pm.income_amount, 0),
    coalesce(tk.task_count, 0),
    coalesce(tk.open_task_count, 0),
    coalesce(dc.document_count, 0)
  from public.tags t
  left join (
    select et.tag_id,
           sum(e.amount) as total_amount,
           sum(case when e.payment_status = 'paid' then e.amount
                    else coalesce(e.paid_amount, 0) end) as paid_amount
    from public.entity_tags et
    join public.expenses e on e.id = et.entity_id
    where et.entity_type = 'expense'
    group by et.tag_id
  ) ex on ex.tag_id = t.id
  left join (
    select et.tag_id, sum(p.amount_total) as income_amount
    from public.entity_tags et
    join public.payments p on p.id = et.entity_id
    where et.entity_type = 'payment'
    group by et.tag_id
  ) pm on pm.tag_id = t.id
  left join (
    select et.tag_id,
           count(*) as task_count,
           count(*) filter (
             where coalesce(ts.status,'todo') not in ('done','cancelled')
           ) as open_task_count
    from public.entity_tags et
    join public.tasks ts on ts.id = et.entity_id
    where et.entity_type = 'task'
    group by et.tag_id
  ) tk on tk.tag_id = t.id
  left join (
    select et.tag_id, count(*) as document_count
    from public.entity_tags et
    where et.entity_type = 'document'
    group by et.tag_id
  ) dc on dc.tag_id = t.id;
$$;

revoke all on function public.tag_rollup() from public;
grant execute on function public.tag_rollup() to authenticated;
