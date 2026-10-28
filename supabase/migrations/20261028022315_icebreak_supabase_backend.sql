create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text not null default '',
  unallocated_cents bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  icon text not null default '◦',
  color text not null default '#537f72',
  target_percent numeric(5, 2) not null default 0 check (target_percent between 0 and 100),
  target_cents bigint not null default 0 check (target_cents >= 0),
  spent_cents bigint not null default 0 check (spent_cents >= 0),
  balance_cents bigint not null default 0,
  kind text not null check (kind in ('spending', 'savings')),
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  description text not null check (char_length(description) between 1 and 80),
  category_id uuid references public.categories (id) on delete set null,
  amount_cents bigint not null check (amount_cents > 0),
  type text not null check (type in ('income', 'expense')),
  source text not null default 'manual' check (source in ('manual', 'plaid')),
  plaid_transaction_id text,
  pending boolean not null default false,
  created_at timestamptz not null default now(),
  constraint transactions_plaid_id_per_user unique (user_id, plaid_transaction_id)
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 50),
  target_cents bigint not null check (target_cents > 0),
  saved_cents bigint not null default 0 check (saved_cents >= 0),
  due text not null default 'No date',
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- Plaid access tokens are available only to the Edge Function's service-role client.
create table if not exists public.plaid_items (
  user_id uuid primary key references auth.users (id) on delete cascade,
  access_token text not null,
  item_id text not null,
  cursor text,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz
);

create index if not exists categories_user_created_idx on public.categories (user_id, created_at, id);
create index if not exists transactions_user_created_idx on public.transactions (user_id, created_at desc, id);
create index if not exists goals_user_created_idx on public.goals (user_id, created_at, id);

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.goals enable row level security;
alter table public.plaid_items enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists categories_select_own on public.categories;
create policy categories_select_own on public.categories
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists transactions_select_own on public.transactions;
create policy transactions_select_own on public.transactions
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists goals_select_own on public.goals;
create policy goals_select_own on public.goals
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.profiles, public.categories, public.transactions, public.goals from anon, authenticated;
grant select on public.profiles, public.categories, public.transactions, public.goals to authenticated;
revoke all on public.plaid_items from public, anon, authenticated;
grant select, insert, update, delete on public.plaid_items to service_role;
grant select on public.categories to service_role;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;

  insert into public.categories (user_id, name, icon, color, target_percent, kind)
  values
    (new.id, 'Rent & bills', '⌂', '#537f72', 35, 'spending'),
    (new.id, 'Food & groceries', '✳', '#d89954', 20, 'spending'),
    (new.id, 'Transport', '↗', '#7397a0', 10, 'spending'),
    (new.id, 'Books & school', '▤', '#9d8bbc', 10, 'spending'),
    (new.id, 'Savings', '✿', '#739677', 15, 'savings'),
    (new.id, 'Just for fun', '☼', '#d17f78', 10, 'spending')
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated, service_role;
drop trigger if exists on_auth_user_created_icebreak on auth.users;
create trigger on_auth_user_created_icebreak
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.allocate_income(p_user_id uuid, p_amount_cents bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total_percent numeric;
  v_base_allocated bigint;
  v_target_allocated bigint;
  v_remaining bigint;
  v_rank bigint := 0;
  v_category record;
begin
  select coalesce(sum(c.target_percent), 0)
    into v_total_percent
    from public.categories as c
   where c.user_id = p_user_id;

  if v_total_percent > 100 then
    raise exception 'Category percentages must total 100%% or less.';
  end if;

  select coalesce(sum(floor(p_amount_cents * c.target_percent / 100)), 0)::bigint
    into v_base_allocated
    from public.categories as c
   where c.user_id = p_user_id;

  v_target_allocated := floor(p_amount_cents * v_total_percent / 100)::bigint;
  v_remaining := v_target_allocated - v_base_allocated;

  for v_category in
    select c.id,
           floor(p_amount_cents * c.target_percent / 100)::bigint as base_cents,
           (p_amount_cents * c.target_percent / 100) - floor(p_amount_cents * c.target_percent / 100) as remainder
      from public.categories as c
     where c.user_id = p_user_id and c.target_percent > 0
     order by remainder desc, c.id
     for update
  loop
    v_rank := v_rank + 1;
    update public.categories
       set balance_cents = balance_cents + v_category.base_cents + case when v_rank <= v_remaining then 1 else 0 end
     where id = v_category.id and user_id = p_user_id;
  end loop;

  return p_amount_cents - v_target_allocated;
end;
$$;

create or replace function private.create_transaction(
  p_amount_cents bigint,
  p_description text,
  p_type text,
  p_category_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_unallocated bigint;
  v_category_balance bigint;
  v_id uuid;
begin
  if v_user_id is null then raise exception 'Sign in to use your budget.'; end if;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 10000000000 then
    raise exception 'Amount must be a positive whole-cent value.';
  end if;
  if p_description is null or char_length(trim(p_description)) not between 1 and 80 then
    raise exception 'Description must be 1 to 80 characters.';
  end if;
  if p_type is null or p_type not in ('income', 'expense') then raise exception 'Transaction type is invalid.'; end if;

  select p.unallocated_cents into v_unallocated
    from public.profiles as p where p.id = v_user_id for update;
  if not found then raise exception 'Budget profile is missing.'; end if;

  if p_type = 'income' then
    v_unallocated := private.allocate_income(v_user_id, p_amount_cents);
    update public.profiles set unallocated_cents = unallocated_cents + v_unallocated where id = v_user_id;
  elsif p_category_id is null then
    if p_amount_cents > v_unallocated then raise exception 'That exceeds your Safe to Spend balance.'; end if;
    update public.profiles set unallocated_cents = unallocated_cents - p_amount_cents where id = v_user_id;
  else
    select c.balance_cents into v_category_balance
      from public.categories as c
     where c.id = p_category_id and c.user_id = v_user_id
     for update;
    if not found then raise exception 'Choose one of your categories.'; end if;
    if p_amount_cents > v_category_balance then raise exception 'That exceeds this category''s remaining balance.'; end if;
    update public.categories
       set balance_cents = balance_cents - p_amount_cents,
           spent_cents = spent_cents + p_amount_cents
     where id = p_category_id and user_id = v_user_id;
  end if;

  insert into public.transactions (user_id, description, category_id, amount_cents, type, source)
  values (v_user_id, trim(p_description), case when p_type = 'income' then null else p_category_id end, p_amount_cents, p_type, 'manual')
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.create_category(p_name text, p_target_percent numeric, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_total_percent numeric;
  v_color text;
  v_id uuid;
begin
  if v_user_id is null then raise exception 'Sign in to use your budget.'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 40 then raise exception 'Category name must be 1 to 40 characters.'; end if;
  if p_target_percent is null or p_target_percent < 0 or p_target_percent > 100 then raise exception 'Percentage must be between 0 and 100.'; end if;
  if p_kind is null or p_kind not in ('spending', 'savings') then raise exception 'Category type is invalid.'; end if;

  perform 1 from public.profiles as p where p.id = v_user_id for update;
  if not found then raise exception 'Budget profile is missing.'; end if;
  select coalesce(sum(c.target_percent), 0) into v_total_percent from public.categories as c where c.user_id = v_user_id;
  if v_total_percent + p_target_percent > 100 then raise exception 'Category percentages cannot exceed 100%%.'; end if;

  select (array['#537f72', '#d89954', '#7397a0', '#9d8bbc', '#d17f78', '#739677'])[(count(*)::int % 6) + 1]
    into v_color from public.categories as c where c.user_id = v_user_id;
  insert into public.categories (user_id, name, icon, color, target_percent, kind)
  values (v_user_id, trim(p_name), '◦', coalesce(v_color, '#537f72'), p_target_percent, p_kind)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.create_goal(p_name text, p_target_cents bigint, p_due text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_id uuid;
begin
  if v_user_id is null then raise exception 'Sign in to use your budget.'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 50 then raise exception 'Goal name must be 1 to 50 characters.'; end if;
  if p_target_cents is null or p_target_cents < 1 or p_target_cents > 10000000000 then raise exception 'Target must be a positive whole-cent value.'; end if;
  insert into public.goals (user_id, name, target_cents, due)
  values (v_user_id, trim(p_name), p_target_cents, coalesce(nullif(trim(p_due), ''), 'No date'))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.contribute_to_goal(p_goal_id uuid, p_amount_cents bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_unallocated bigint;
  v_goal_id uuid;
  v_savings_id uuid;
  v_savings_balance bigint;
begin
  if v_user_id is null then raise exception 'Sign in to use your budget.'; end if;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 10000000000 then raise exception 'Amount must be a positive whole-cent value.'; end if;
  select p.unallocated_cents into v_unallocated from public.profiles as p where p.id = v_user_id for update;
  if not found then raise exception 'Budget profile is missing.'; end if;
  select g.id into v_goal_id from public.goals as g where g.id = p_goal_id and g.user_id = v_user_id for update;
  if not found then raise exception 'Savings goal was not found.'; end if;

  select c.id, c.balance_cents into v_savings_id, v_savings_balance
    from public.categories as c
   where c.user_id = v_user_id and c.kind = 'savings' and c.balance_cents >= p_amount_cents
   order by c.created_at, c.id
   limit 1 for update;
  if found then
    update public.categories set balance_cents = balance_cents - p_amount_cents where id = v_savings_id and user_id = v_user_id;
  else
    if p_amount_cents > v_unallocated then raise exception 'There is not enough Safe to Spend or savings balance for this contribution.'; end if;
    update public.profiles set unallocated_cents = unallocated_cents - p_amount_cents where id = v_user_id;
  end if;

  update public.goals
     set saved_cents = saved_cents + p_amount_cents, updated_at = now()
   where id = v_goal_id and user_id = v_user_id;
  return true;
end;
$$;

create or replace function private.import_plaid_transaction(
  p_user_id uuid,
  p_plaid_transaction_id text,
  p_description text,
  p_amount_cents bigint,
  p_type text,
  p_category_id uuid,
  p_pending boolean,
  p_created_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_unallocated bigint;
  v_rows_updated bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Not authorized.'; end if;
  if p_user_id is null or p_plaid_transaction_id is null or p_plaid_transaction_id = '' then raise exception 'Plaid transaction details are invalid.'; end if;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 10000000000 then raise exception 'Transaction amount is invalid.'; end if;
  if p_type is null or p_type not in ('income', 'expense') then raise exception 'Transaction type is invalid.'; end if;

  insert into public.transactions (user_id, description, category_id, amount_cents, type, source, plaid_transaction_id, pending, created_at)
  values (p_user_id, left(coalesce(nullif(trim(p_description), ''), 'Bank transaction'), 80),
          case when p_type = 'income' then null else p_category_id end,
          p_amount_cents, p_type, 'plaid', p_plaid_transaction_id, coalesce(p_pending, false), coalesce(p_created_at, now()))
  on conflict (user_id, plaid_transaction_id) do nothing
  returning id into v_id;
  if v_id is null then return false; end if;

  select p.unallocated_cents into v_unallocated from public.profiles as p where p.id = p_user_id for update;
  if not found then raise exception 'Budget profile is missing.'; end if;
  if p_type = 'income' then
    v_unallocated := private.allocate_income(p_user_id, p_amount_cents);
    update public.profiles set unallocated_cents = unallocated_cents + v_unallocated where id = p_user_id;
  elsif p_category_id is null then
    update public.profiles set unallocated_cents = unallocated_cents - p_amount_cents where id = p_user_id;
  else
    update public.categories
       set balance_cents = balance_cents - p_amount_cents,
           spent_cents = spent_cents + p_amount_cents
     where id = p_category_id and user_id = p_user_id;
    get diagnostics v_rows_updated = row_count;
    if v_rows_updated = 0 then
      update public.transactions set category_id = null where id = v_id;
      update public.profiles set unallocated_cents = unallocated_cents - p_amount_cents where id = p_user_id;
    end if;
  end if;
  return true;
end;
$$;

revoke all on function private.allocate_income(uuid, bigint) from public, anon, authenticated, service_role;
revoke all on function private.create_transaction(bigint, text, text, uuid) from public, anon;
revoke all on function private.create_category(text, numeric, text) from public, anon;
revoke all on function private.create_goal(text, bigint, text) from public, anon;
revoke all on function private.contribute_to_goal(uuid, bigint) from public, anon;
revoke all on function private.import_plaid_transaction(uuid, text, text, bigint, text, uuid, boolean, timestamptz) from public, anon, authenticated;
grant execute on function private.create_transaction(bigint, text, text, uuid) to authenticated;
grant execute on function private.create_category(text, numeric, text) to authenticated;
grant execute on function private.create_goal(text, bigint, text) to authenticated;
grant execute on function private.contribute_to_goal(uuid, bigint) to authenticated;
grant execute on function private.import_plaid_transaction(uuid, text, text, bigint, text, uuid, boolean, timestamptz) to service_role;

create or replace function public.create_transaction(p_amount_cents bigint, p_description text, p_type text, p_category_id uuid default null)
returns uuid language sql security invoker set search_path = ''
as $$ select private.create_transaction(p_amount_cents, p_description, p_type, p_category_id); $$;

create or replace function public.create_category(p_name text, p_target_percent numeric, p_kind text)
returns uuid language sql security invoker set search_path = ''
as $$ select private.create_category(p_name, p_target_percent, p_kind); $$;

create or replace function public.create_goal(p_name text, p_target_cents bigint, p_due text default null)
returns uuid language sql security invoker set search_path = ''
as $$ select private.create_goal(p_name, p_target_cents, p_due); $$;

create or replace function public.contribute_to_goal(p_goal_id uuid, p_amount_cents bigint)
returns boolean language sql security invoker set search_path = ''
as $$ select private.contribute_to_goal(p_goal_id, p_amount_cents); $$;

create or replace function public.import_plaid_transaction(
  p_user_id uuid, p_plaid_transaction_id text, p_description text, p_amount_cents bigint,
  p_type text, p_category_id uuid, p_pending boolean, p_created_at timestamptz
)
returns boolean language sql security invoker set search_path = ''
as $$ select private.import_plaid_transaction(p_user_id, p_plaid_transaction_id, p_description, p_amount_cents, p_type, p_category_id, p_pending, p_created_at); $$;

revoke all on function public.create_transaction(bigint, text, text, uuid) from public, anon;
revoke all on function public.create_category(text, numeric, text) from public, anon;
revoke all on function public.create_goal(text, bigint, text) from public, anon;
revoke all on function public.contribute_to_goal(uuid, bigint) from public, anon;
revoke all on function public.import_plaid_transaction(uuid, text, text, bigint, text, uuid, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.create_transaction(bigint, text, text, uuid) to authenticated;
grant execute on function public.create_category(text, numeric, text) to authenticated;
grant execute on function public.create_goal(text, bigint, text) to authenticated;
grant execute on function public.contribute_to_goal(uuid, bigint) to authenticated;
grant execute on function public.import_plaid_transaction(uuid, text, text, bigint, text, uuid, boolean, timestamptz) to service_role;

do $$
declare
  v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array['profiles', 'categories', 'transactions', 'goals'] loop
      if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end;
$$;
