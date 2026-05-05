alter table public.tasks
  alter column project_id drop not null,
  alter column property_id drop not null;

alter table public.tasks
  drop constraint if exists tasks_business_domain_target_check;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_business_domain_target_check'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_business_domain_target_check
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
      ) not valid;
  end if;
end $$;
