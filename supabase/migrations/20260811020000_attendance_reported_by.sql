-- ════════════════════════════════════════════════════════════════════════════
-- phone_attendance_reports.reported_by — WHO filed this shift.
--
-- Since a worker can now clock a colleague in (20260811010000), "whose hours are
-- these" and "who says so" are two different questions, and the queue needs both
-- before approving. It was being smuggled into the free-text `notes` as
-- "נרשם ע״י …", which is unqueryable, easy to overwrite, and indistinguishable
-- from something the worker actually wrote about the shift.
--
-- Records the CREATOR of the report. Null means nobody claimed it: the phone
-- call-in webhook (source 'phone') is the worker himself dialling in, and every
-- row that existed before this migration. `reported_by = user_id` is a
-- self-report; the two differing is what the queue flags.
--
-- Idempotent / safe to re-run. Run in the Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.phone_attendance_reports
  add column if not exists reported_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'phone_attendance_reports_reported_by_fkey'
  ) then
    alter table public.phone_attendance_reports
      add constraint phone_attendance_reports_reported_by_fkey
      foreign key (reported_by) references public.users(id) on delete set null;
  end if;
end $$;

comment on column public.phone_attendance_reports.reported_by is
  'The user who filed this report (users.id). Null = self-reported by phone, or predates the column. Differs from user_id when someone clocked a colleague in.';

-- "What did this person file?" — the question an audit actually asks.
create index if not exists phone_attendance_reports_reported_by_idx
  on public.phone_attendance_reports (reported_by)
  where reported_by is not null;

-- ── A worker must sign his own name to it ────────────────────────────────────
-- Same policy as 20260811010000 plus the anti-forgery clause: he cannot file a
-- report and attribute it to somebody else. Everything else is verbatim.
drop policy if exists "phone_attendance_worker_insert" on public.phone_attendance_reports;
create policy "phone_attendance_worker_insert"
on public.phone_attendance_reports
for insert
to authenticated
with check (
  public.current_user_role() = 'worker'::user_role_enum
  and public.is_payroll_worker(user_id)
  and reported_by = public.current_app_user_id()
  and status in ('open', 'pending_review')
  and source = 'app'
  and (
    (status = 'open' and clock_out is null)
    or (status = 'pending_review' and clock_out is not null and clock_out > clock_in)
  )
);
