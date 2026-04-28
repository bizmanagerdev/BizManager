begin;

alter table public.users
  add column if not exists auth_user_id uuid;

update public.users
set auth_user_id = id
where auth_user_id is null;

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where constraint_schema = 'public'
      and table_name = 'users'
      and constraint_name = 'users_auth_fk'
  ) then
    alter table public.users drop constraint users_auth_fk;
  end if;
end
$$;

alter table public.users
  add constraint users_auth_user_id_fk
  foreign key (auth_user_id)
  references auth.users (id)
  on delete set null;

create unique index if not exists users_auth_user_id_unique
  on public.users (auth_user_id)
  where auth_user_id is not null;

create or replace function public.users_fill_auth_user_id_from_existing_auth()
returns trigger
language plpgsql
as $$
begin
  if new.auth_user_id is null
     and exists (
       select 1
       from auth.users
       where id = new.id
     ) then
    new.auth_user_id := new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_users_fill_auth_user_id on public.users;

create trigger trg_users_fill_auth_user_id
before insert or update on public.users
for each row
execute function public.users_fill_auth_user_id_from_existing_auth();

comment on column public.users.auth_user_id is
  'Nullable link to auth.users for system-access accounts. worker_no_access rows can keep this null.';

commit;
