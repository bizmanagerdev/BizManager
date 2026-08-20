-- The reverse direction from add_worker_arabic_translation_columns: a task
-- authored in Hebrew (by office/admin, or a Hebrew-locale worker) that an
-- Arabic-locale worker views gets translated on first read and cached here,
-- rather than re-calling OpenAI on every board load. NULL = not translated
-- yet (no locale=ar viewer has read it) or the original is already Arabic
-- (see tasks.subject_he) — the read side falls back to the original in
-- either case.

alter table public.tasks
  add column if not exists subject_ar text;

alter table public.tasks
  add column if not exists description_ar text;

comment on column public.tasks.subject_ar is
  'Arabic translation of subject, lazily computed and cached the first time a locale=ar viewer reads a Hebrew-authored task.';
comment on column public.tasks.description_ar is
  'Arabic translation of description, lazily computed and cached the first time a locale=ar viewer reads a Hebrew-authored task.';
