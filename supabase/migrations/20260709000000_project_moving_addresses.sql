-- Structured origin → destination addresses for moving projects.
--
-- Until now a move's "from where → to where" was buried in the free-text notes
-- field (e.g. "מרח יונה 16 קומה 4 ללא מעלית לרח עמוס 24 קומה 1 לא מעלית").
-- These columns let a moving project capture each endpoint's address + floor +
-- elevator as its own field, so the details view and the worker sheet can show
-- them cleanly. All nullable; non-moving projects leave them null.
alter table public.projects
  add column if not exists origin_address text,
  add column if not exists origin_floor text,
  add column if not exists origin_has_elevator boolean,
  add column if not exists destination_address text,
  add column if not exists destination_floor text,
  add column if not exists destination_has_elevator boolean;

comment on column public.projects.origin_address is 'Moving projects: pickup (from) street address.';
comment on column public.projects.origin_floor is 'Moving projects: pickup floor (free text — allows "קרקע", "-1", etc.).';
comment on column public.projects.origin_has_elevator is 'Moving projects: elevator at pickup (true/false/null=unspecified).';
comment on column public.projects.destination_address is 'Moving projects: drop-off (to) street address.';
comment on column public.projects.destination_floor is 'Moving projects: drop-off floor (free text).';
comment on column public.projects.destination_has_elevator is 'Moving projects: elevator at drop-off (true/false/null=unspecified).';
