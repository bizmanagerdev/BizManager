-- A vehicle's טסט/ביטוח/רישוי date and the task that produced it ("do the
-- test") were causally linked but visually unrelated: the task shows as done
-- and struck through, the date shows as a fresh expiry, and nothing connects
-- the two. Lets the person updating a date (VehicleExpiryQuickEditDialog)
-- optionally point at the task that led to it, so the status row can link
-- back to it.
--
-- Three separate FK columns, mirroring the existing three separate date
-- columns (test_due_date / insurance_due_date / license_due_date) rather than
-- one polymorphic link — same one-column-per-kind shape the table already
-- uses. ON DELETE SET NULL: deleting the task (or the vehicle unlinking it)
-- must never block or cascade, it just drops the annotation.

alter table public.vehicles
  add column if not exists test_source_task_id uuid references public.tasks(id) on delete set null,
  add column if not exists insurance_source_task_id uuid references public.tasks(id) on delete set null,
  add column if not exists license_source_task_id uuid references public.tasks(id) on delete set null;
