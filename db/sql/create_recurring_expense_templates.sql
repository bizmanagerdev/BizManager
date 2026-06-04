create table if not exists public.recurring_expense_templates (
  id uuid primary key default gen_random_uuid(),
  template_name text not null,
  category text not null,
  amount numeric(12, 2) not null check (amount > 0),
  description_template text null,
  notes_template text null,
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
  order_id uuid null references public.orders (id) on delete set null,
  property_id uuid null references public.properties (id) on delete set null,
  included_in_base_price boolean not null default false,
  billed_to_customer boolean not null default false,
  project_expense_notes_template text null,
  frequency text not null default 'monthly' check (
    frequency in ('monthly', 'yearly')
  ),
  create_day_of_month integer not null default 1 check (
    create_day_of_month between 1 and 31
  ),
  expense_day_of_month integer not null default 1 check (
    expense_day_of_month between 1 and 31
  ),
  create_month_of_year integer null check (
    create_month_of_year between 1 and 12
  ),
  expense_month_of_year integer null check (
    expense_month_of_year between 1 and 12
  ),
  start_date date null,
  end_date date null,
  is_active boolean not null default true,
  created_by uuid null references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date),
  check (num_nonnulls(project_id, order_id, property_id) <= 1),
  check (
    (
      business_domain = 'logistics_projects'
      and project_id is not null
      and order_id is null
      and property_id is null
    )
    or (
      business_domain = 'property_management'
      and property_id is not null
      and project_id is null
      and order_id is null
    )
    or (
      business_domain not in ('logistics_projects', 'property_management')
      and project_id is null
      and property_id is null
    )
  ),
  check (
    (
      frequency = 'monthly'
      and create_month_of_year is null
      and expense_month_of_year is null
    )
    or (
      frequency = 'yearly'
      and create_month_of_year is not null
      and expense_month_of_year is not null
    )
  )
);

alter table public.expenses
  add column if not exists recurring_expense_template_id uuid null
  references public.recurring_expense_templates (id) on delete set null;

alter table public.expenses
  add column if not exists recurrence_key text null;

create index if not exists recurring_expense_templates_active_idx
  on public.recurring_expense_templates (is_active, frequency, create_day_of_month);

create index if not exists recurring_expense_templates_domain_idx
  on public.recurring_expense_templates (business_domain);

create index if not exists recurring_expense_templates_project_idx
  on public.recurring_expense_templates (project_id);

create index if not exists recurring_expense_templates_order_idx
  on public.recurring_expense_templates (order_id);

create index if not exists recurring_expense_templates_property_idx
  on public.recurring_expense_templates (property_id);

create unique index if not exists expenses_recurring_template_key_uidx
  on public.expenses (recurring_expense_template_id, recurrence_key)
  where recurring_expense_template_id is not null and recurrence_key is not null;

alter table public.recurring_expense_templates enable row level security;

drop policy if exists "System users can read recurring expense templates" on public.recurring_expense_templates;
create policy "System users can read recurring expense templates"
on public.recurring_expense_templates
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

drop policy if exists "Admins and office can manage recurring expense templates" on public.recurring_expense_templates;
create policy "Admins and office can manage recurring expense templates"
on public.recurring_expense_templates
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

create or replace function public.recurring_expense_apply_tokens(
  p_value text,
  p_period_key text,
  p_expense_date date
)
returns text
language sql
immutable
as $$
  select
    case
      when p_value is null then null
      else replace(
        replace(
          replace(
            p_value,
            '{{period_key}}',
            p_period_key
          ),
          '{{expense_date}}',
          to_char(p_expense_date, 'YYYY-MM-DD')
        ),
        '{{expense_month}}',
        to_char(p_expense_date, 'YYYY-MM')
      )
    end
$$;

create or replace function public.recurring_expense_clamped_date(
  p_year integer,
  p_month integer,
  p_day integer
)
returns date
language sql
immutable
as $$
  select make_date(
    p_year,
    p_month,
    least(
      greatest(p_day, 1),
      extract(
        day from (
          date_trunc('month', make_date(p_year, p_month, 1))
          + interval '1 month - 1 day'
        )
      )::integer
    )
  )
$$;

create or replace function public.generate_recurring_expenses_for_date(
  p_today date default current_date
)
returns integer
language plpgsql
as $$
declare
  template_row public.recurring_expense_templates%rowtype;
  create_date date;
  expense_date date;
  recurrence_key text;
  target_year integer := extract(year from p_today)::integer;
  expense_id uuid;
  created_count integer := 0;
begin
  for template_row in
    select *
    from public.recurring_expense_templates
    where is_active = true
    order by created_at asc
  loop
    if template_row.frequency = 'monthly' then
      recurrence_key := to_char(p_today, 'YYYY-MM');
      create_date := public.recurring_expense_clamped_date(
        target_year,
        extract(month from p_today)::integer,
        template_row.create_day_of_month
      );
      expense_date := public.recurring_expense_clamped_date(
        target_year,
        extract(month from p_today)::integer,
        template_row.expense_day_of_month
      );
    elsif template_row.frequency = 'yearly' then
      recurrence_key := to_char(
        public.recurring_expense_clamped_date(
          target_year,
          template_row.expense_month_of_year,
          template_row.expense_day_of_month
        ),
        'YYYY'
      );
      create_date := public.recurring_expense_clamped_date(
        target_year,
        template_row.create_month_of_year,
        template_row.create_day_of_month
      );
      expense_date := public.recurring_expense_clamped_date(
        target_year,
        template_row.expense_month_of_year,
        template_row.expense_day_of_month
      );
    else
      continue;
    end if;

    if p_today < create_date then
      continue;
    end if;

    if template_row.start_date is not null and expense_date < template_row.start_date then
      continue;
    end if;

    if template_row.end_date is not null and create_date > template_row.end_date then
      continue;
    end if;

    if exists (
      select 1
      from public.expenses e
      where e.recurring_expense_template_id = template_row.id
        and e.recurrence_key = recurrence_key
    ) then
      continue;
    end if;

    insert into public.expenses (
      expense_date,
      amount,
      category,
      description,
      business_domain,
      project_id,
      order_id,
      property_id,
      notes,
      recorded_by,
      recurring_expense_template_id,
      recurrence_key
    )
    values (
      expense_date,
      template_row.amount,
      template_row.category,
      public.recurring_expense_apply_tokens(
        template_row.description_template,
        recurrence_key,
        expense_date
      ),
      template_row.business_domain,
      template_row.project_id,
      template_row.order_id,
      template_row.property_id,
      public.recurring_expense_apply_tokens(
        template_row.notes_template,
        recurrence_key,
        expense_date
      ),
      template_row.created_by,
      template_row.id,
      recurrence_key
    )
    returning id into expense_id;

    if template_row.project_id is not null then
      insert into public.project_expenses (
        project_id,
        expense_id,
        included_in_base_price,
        billed_to_customer,
        notes
      )
      values (
        template_row.project_id,
        expense_id,
        template_row.included_in_base_price,
        template_row.billed_to_customer,
        public.recurring_expense_apply_tokens(
          template_row.project_expense_notes_template,
          recurrence_key,
          expense_date
        )
      );
    end if;

    created_count := created_count + 1;
  end loop;

  return created_count;
end;
$$;

grant execute on function public.generate_recurring_expenses_for_date(date) to authenticated;

comment on table public.recurring_expense_templates is
  'Template table for fixed recurring expenses. Supports monthly and yearly generation.';

comment on function public.generate_recurring_expenses_for_date(date) is
  'Creates expense rows from active recurring expense templates once their create date is reached.';
