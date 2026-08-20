-- When a worker with locale='ar' writes free text that office/admin (Hebrew-only)
-- need to read, the app auto-translates it and stores the Hebrew alongside the
-- original here. NULL = not translated (Hebrew writer, or translation failed) --
-- read-side code falls back to the original column in that case.

alter table public.tasks
  add column if not exists subject_he text;

alter table public.tasks
  add column if not exists description_he text;

alter table public.task_comments
  add column if not exists body_he text;

-- The worker-facing attendance flow (clock-in/out, whole-shift report, and the
-- "correct an approved shift" request) all write into phone_attendance_reports
-- — that's the real free-text entry point, not attendance_sessions directly.
-- attendance_sessions only gets a `notes` value when an admin approves a report
-- (app/api/attendance/phone-reports/approve copies it verbatim), so notes_he is
-- added there too, to carry the translation the same way.
alter table public.phone_attendance_reports
  add column if not exists notes_he text;

alter table public.attendance_sessions
  add column if not exists notes_he text;

comment on column public.tasks.subject_he is
  'Hebrew translation of subject, auto-filled when authored by a locale=ar worker.';
comment on column public.tasks.description_he is
  'Hebrew translation of description, auto-filled when authored by a locale=ar worker.';
comment on column public.task_comments.body_he is
  'Hebrew translation of body, auto-filled when authored by a locale=ar worker.';
comment on column public.phone_attendance_reports.notes_he is
  'Hebrew translation of notes, auto-filled when authored by a locale=ar worker.';
comment on column public.attendance_sessions.notes_he is
  'Hebrew translation of notes, copied from phone_attendance_reports.notes_he when an admin approves the report.';
