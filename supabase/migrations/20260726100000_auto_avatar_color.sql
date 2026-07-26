-- Every user should ALWAYS have an avatar color, so the same person shows the
-- same color on every screen (online bar, activity feed/table, tasks, comments,
-- dashboard). If a user never picked one, the system assigns a stable color from
-- the shared palette — derived from a hash of their id, so it's deterministic —
-- and saves it. It persists until they choose a different one in their profile.
--
-- The palette mirrors AVATAR_COLORS in components/dashboard/InitialsAvatar.tsx.
-- Idempotent: only fills a NULL/blank avatar_color, never overwrites a real choice.

create or replace function public.assign_default_avatar_color()
returns trigger
language plpgsql
as $$
declare
  palette text[] := array[
    '#2563EB','#EA580C','#16A34A','#DB2777','#9333EA','#0D9488','#DC2626','#4F46E5'
  ];
begin
  if new.avatar_color is null or btrim(new.avatar_color) = '' then
    new.avatar_color := palette[(abs(hashtext(new.id::text)) % array_length(palette, 1)) + 1];
  end if;
  return new;
end;
$$;

-- Future users: fill the color at insert time.
drop trigger if exists trg_assign_default_avatar_color on public.users;
create trigger trg_assign_default_avatar_color
  before insert on public.users
  for each row
  execute function public.assign_default_avatar_color();

-- Existing users who still have no color: backfill with the same deterministic map.
update public.users
set avatar_color = (array[
    '#2563EB','#EA580C','#16A34A','#DB2777','#9333EA','#0D9488','#DC2626','#4F46E5'
  ])[(abs(hashtext(id::text)) % 8) + 1]
where avatar_color is null or btrim(avatar_color) = '';
