-- "No charge" projects: donations / favors / internal jobs that legitimately
-- have no price. Marks a completed project as intentionally unpriced so the
-- "פרויקטים סגורים ללא חיוב" alert (project_closed_unbilled) skips it instead of
-- nagging. Run in the Supabase SQL Editor. Idempotent.

alter table public.projects
  add column if not exists no_charge boolean not null default false;
