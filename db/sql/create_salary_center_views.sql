-- Optional reporting views for the Salary Center.
-- Apply in Supabase when you want reusable read models for payroll dashboards.

create or replace view public.worker_attendance_monthly_view as
select
  s.user_id,
  to_char(date_trunc('month', s.clock_in), 'YYYY-MM') as period_month,
  sum(coalesce(s.worked_minutes, 0)) as total_work_minutes,
  count(*) as sessions_count,
  count(*) filter (where s.clock_out is null) as open_sessions_count
from public.attendance_sessions s
group by s.user_id, date_trunc('month', s.clock_in);

create or replace view public.worker_project_hours_view as
select
  s.user_id,
  s.project_id,
  sum(coalesce(s.worked_minutes, 0)) as total_work_minutes,
  sum(coalesce(s.labor_cost, 0)) as total_labor_cost
from public.attendance_sessions s
where s.project_id is not null
group by s.user_id, s.project_id;

create or replace view public.current_salary_agreements_view as
select distinct on (a.user_id)
  a.id,
  a.user_id,
  a.salary_type,
  a.hourly_rate,
  a.monthly_salary,
  a.overtime_rate,
  a.standard_daily_hours,
  a.valid_from,
  a.valid_to,
  a.notes
from public.salary_agreements a
where a.valid_from <= current_date
  and (a.valid_to is null or a.valid_to >= current_date)
-- salary_agreements has no created_at column; a.id is a stable tiebreaker so
-- distinct on (user_id) deterministically picks the latest-starting agreement.
order by a.user_id, a.valid_from desc, a.id desc;

create or replace view public.payroll_period_summary_view as
select
  p.id,
  p.period_month,
  p.start_date,
  p.end_date,
  p.status,
  count(distinct ps.id) as payslips_count,
  count(distinct ps.id) filter (where p.status <> 'paid') as unpaid_payslips_count,
  sum(coalesce(ps.gross_salary, 0)) as gross_salary_total
from public.payroll_periods p
left join public.payslips ps on ps.payroll_period_id = p.id
group by p.id, p.period_month, p.start_date, p.end_date, p.status;

create or replace view public.salary_center_worker_overview_view as
with current_month as (
  select to_char(current_date, 'YYYY-MM') as period_month
),
attendance as (
  select
    w.user_id,
    w.total_work_minutes,
    w.sessions_count,
    w.open_sessions_count
  from public.worker_attendance_monthly_view w
  join current_month cm on cm.period_month = w.period_month
),
project_counts as (
  select
    s.user_id,
    count(distinct coalesce(s.project_id::text, s.property_id::text)) as current_month_links_count
  from public.attendance_sessions s
  join current_month cm
    on cm.period_month = to_char(date_trunc('month', s.clock_in), 'YYYY-MM')
  group by s.user_id
)
select
  u.id as user_id,
  u.full_name,
  u.email,
  u.phone,
  u.role,
  u.active,
  u.system_access,
  coalesce(a.total_work_minutes, 0) as current_month_work_minutes,
  coalesce(a.sessions_count, 0) as current_month_sessions_count,
  coalesce(a.open_sessions_count, 0) as current_month_open_sessions_count,
  coalesce(pc.current_month_links_count, 0) as current_month_links_count
from public.users u
left join attendance a on a.user_id = u.id
left join project_counts pc on pc.user_id = u.id
where u.role in ('worker', 'worker_no_access');
