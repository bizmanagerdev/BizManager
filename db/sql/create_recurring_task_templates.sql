create table if not exists public.recurring_task_templates (
  id uuid primary key default gen_random_uuid(),
  subject_template text not null,
  description_template text null,
  business_domain text not null check (
    business_domain in (
      'home',
      'charity',
      'general_business',
      'logistics_projects',
      'sales',
      'property_management',
      'spaceit'
    )
  ),
  project_id uuid null references public.projects (id) on delete set null,
  property_id uuid null references public.properties (id) on delete set null,
  default_priority text not null default 'medium' check (
    default_priority in ('low', 'medium', 'high', 'urgent')
  ),
  default_status text not null default 'todo' check (
    default_status in ('todo', 'in_progress', 'blocked', 'done', 'cancelled')
  ),
  frequency text not null default 'monthly' check (
    frequency in ('monthly')
  ),
  create_day_of_month integer not null default 1 check (
    create_day_of_month between 1 and 31
  ),
  due_day_of_month integer not null default 1 check (
    due_day_of_month between 1 and 31
  ),
  start_date date null,
  end_date date null,
  is_active boolean not null default true,
  created_by uuid null references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (
      business_domain = 'logistics_projects'
      and project_id is not null
      and property_id is null
    )
    or (
      business_domain = 'property_management'
      and project_id is null
      and property_id is not null
    )
    or (
      business_domain not in ('logistics_projects', 'property_management')
      and project_id is null
      and property_id is null
    )
  ),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table if not exists public.recurring_task_template_assignees (
  id uuid primary key default gen_random_uuid(),
  recurring_task_template_id uuid not null references public.recurring_task_templates (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (recurring_task_template_id, user_id)
);

alter table public.tasks
  add column if not exists recurring_task_template_id uuid null references public.recurring_task_templates (id) on delete set null;

alter table public.tasks
  add column if not exists recurrence_key text null;

create index if not exists recurring_task_templates_active_idx
  on public.recurring_task_templates (is_active, frequency, create_day_of_month);

create index if not exists recurring_task_templates_domain_idx
  on public.recurring_task_templates (business_domain);

create index if not exists recurring_task_template_assignees_template_idx
  on public.recurring_task_template_assignees (recurring_task_template_id);

create index if not exists recurring_task_template_assignees_user_idx
  on public.recurring_task_template_assignees (user_id);

create unique index if not exists tasks_recurring_template_key_assignee_uidx
  on public.tasks (recurring_task_template_id, recurrence_key, assigned_user_id)
  where recurring_task_template_id is not null and recurrence_key is not null;

alter table public.recurring_task_templates enable row level security;
alter table public.recurring_task_template_assignees enable row level security;

drop policy if exists "System users can read recurring task templates" on public.recurring_task_templates;
create policy "System users can read recurring task templates"
on public.recurring_task_templates
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.auth_user_id = auth.uid()
      and u.active = true
      and coalesce(u.system_access, false) = true
  )
);

drop policy if exists "Admins and office can manage recurring task templates" on public.recurring_task_templates;
create policy "Admins and office can manage recurring task templates"
on public.recurring_task_templates
for all
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.auth_user_id = auth.uid()
      and u.active = true
      and coalesce(u.system_access, false) = true
      and u.role in ('admin', 'office')
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.auth_user_id = auth.uid()
      and u.active = true
      and coalesce(u.system_access, false) = true
      and u.role in ('admin', 'office')
  )
);

drop policy if exists "System users can read recurring task assignees" on public.recurring_task_template_assignees;
create policy "System users can read recurring task assignees"
on public.recurring_task_template_assignees
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.auth_user_id = auth.uid()
      and u.active = true
      and coalesce(u.system_access, false) = true
  )
);

drop policy if exists "Admins and office can manage recurring task assignees" on public.recurring_task_template_assignees;
create policy "Admins and office can manage recurring task assignees"
on public.recurring_task_template_assignees
for all
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.auth_user_id = auth.uid()
      and u.active = true
      and coalesce(u.system_access, false) = true
      and u.role in ('admin', 'office')
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.auth_user_id = auth.uid()
      and u.active = true
      and coalesce(u.system_access, false) = true
      and u.role in ('admin', 'office')
  )
);

with salary_template as (
  insert into public.recurring_task_templates (
    subject_template,
    description_template,
    business_domain,
    default_priority,
    default_status,
    frequency,
    create_day_of_month,
    due_day_of_month,
    is_active
  )
  select
    'תשלום משכורות - {{month_label}}',
    'משימה חודשית אוטומטית: לשלם משכורות עד ה-10 לחודש.',
    'general_business',
    'high',
    'todo',
    'monthly',
    1,
    10,
    true
  where not exists (
    select 1
    from public.recurring_task_templates t
    where t.subject_template = 'תשלום משכורות - {{month_label}}'
      and t.business_domain = 'general_business'
      and t.frequency = 'monthly'
  )
  returning id
),
salary_template_id as (
  select id from salary_template
  union all
  select t.id
  from public.recurring_task_templates t
  where t.subject_template = 'תשלום משכורות - {{month_label}}'
    and t.business_domain = 'general_business'
    and t.frequency = 'monthly'
  limit 1
)
insert into public.recurring_task_template_assignees (
  recurring_task_template_id,
  user_id
)
select
  st.id,
  u.id
from salary_template_id st
join public.users u
  on u.active = true
 and coalesce(u.system_access, false) = true
 and u.role in ('admin', 'office')
where not exists (
  select 1
  from public.recurring_task_template_assignees a
  where a.recurring_task_template_id = st.id
    and a.user_id = u.id
);
