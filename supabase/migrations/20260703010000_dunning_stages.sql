-- Dunning ladder: the staged collection-chase sequence (day 0 / +7 / +14 / +30…).
-- Run in the Supabase SQL Editor. Idempotent.
--
-- The collection_overdue rule reads these stages: for each still-overdue debt it
-- creates ONE reminder for the CURRENT stage (highest offset ≤ days overdue),
-- escalating severity as the debt ages. Admin-editable in Settings → התראות.

create table if not exists public.dunning_stages (
  id         uuid primary key default gen_random_uuid(),
  day_offset int not null,                    -- days after the due date
  label      text not null,
  severity   text not null default 'warning', -- info | warning | danger
  enabled    boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.dunning_stages drop constraint if exists dunning_stages_severity_check;
alter table public.dunning_stages
  add constraint dunning_stages_severity_check check (severity in ('info', 'warning', 'danger'));

-- Seed a sensible default ladder (only when empty).
insert into public.dunning_stages (day_offset, label, severity, sort_order)
select * from (values
  (0,  'תזכורת גבייה',  'warning', 0),
  (7,  'מעקב גבייה',    'warning', 1),
  (14, 'התראת גבייה',   'danger',  2),
  (30, 'התראה אחרונה',  'danger',  3)
) as v(day_offset, label, severity, sort_order)
where not exists (select 1 from public.dunning_stages);

alter table public.dunning_stages enable row level security;

drop policy if exists "Admin manage dunning stages" on public.dunning_stages;
create policy "Admin manage dunning stages"
  on public.dunning_stages for all to authenticated
  using (exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.role = 'admin' and u.active = true))
  with check (exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.role = 'admin' and u.active = true));
