-- Adds the 'spaceit' business domain everywhere the value is enumerated in the
-- database, for an EXISTING install. (The create_* table files already include
-- 'spaceit', but `create table if not exists` will not alter tables that already
-- exist, so this migration patches the live constraints.)
--
-- The main tables (expenses, tasks, work_sessions, ...) use the
-- business_domain_enum type. Make sure the value exists on the enum. If the enum
-- currently has the misspelled 'spaceita', rename it first:
--   alter type public.business_domain_enum rename value 'spaceita' to 'spaceit';
alter type public.business_domain_enum add value if not exists 'spaceit';

-- recurring_expense_templates / recurring_task_templates use a text column with a
-- CHECK constraint (not the enum). Refresh the constraint to allow 'spaceit'.
-- The unnamed inline column check is auto-named "<table>_business_domain_check".
alter table public.recurring_expense_templates
  drop constraint if exists recurring_expense_templates_business_domain_check;
alter table public.recurring_expense_templates
  add constraint recurring_expense_templates_business_domain_check
  check (
    business_domain in (
      'home',
      'charity',
      'general_business',
      'logistics_projects',
      'sales',
      'property_management',
      'spaceit'
    )
  );

alter table public.recurring_task_templates
  drop constraint if exists recurring_task_templates_business_domain_check;
alter table public.recurring_task_templates
  add constraint recurring_task_templates_business_domain_check
  check (
    business_domain in (
      'home',
      'charity',
      'general_business',
      'logistics_projects',
      'sales',
      'property_management',
      'spaceit'
    )
  );
