create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 80),
  email text not null,
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  role text not null default 'member'
    check (role in ('member', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 55),
  lender text not null check (char_length(lender) between 1 and 55),
  principal numeric(14, 2) not null check (principal > 0),
  annual_rate numeric(5, 2) not null check (annual_rate between 0 and 100),
  monthly_payment numeric(14, 2) not null check (monthly_payment > 0),
  start_date date not null,
  due_date date not null,
  color text not null default 'green' check (color in ('green', 'blue', 'amber')),
  created_at timestamptz not null default now(),
  constraint loans_start_before_due check (start_date <= due_date),
  constraint loans_id_user_unique unique (id, user_id)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  loan_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  payment_date date not null default current_date check (payment_date <= current_date),
  note text not null default 'Repayment' check (char_length(note) between 1 and 60),
  created_at timestamptz not null default now(),
  constraint payments_owned_loan foreign key (loan_id, user_id)
    references public.loans (id, user_id) on delete cascade
);

create table if not exists public.loan_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null check (char_length(name) between 1 and 55),
  lender text not null check (char_length(lender) between 1 and 55),
  requested_amount numeric(14, 2) not null check (requested_amount > 0),
  annual_rate numeric(5, 2) not null check (annual_rate between 0 and 100),
  monthly_payment numeric(14, 2) not null check (monthly_payment > 0),
  start_date date not null,
  due_date date not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint loan_applications_start_before_due check (start_date <= due_date),
  constraint loan_applications_review_fields check (
    (status = 'pending' and reviewed_at is null)
    or (status in ('approved', 'rejected') and reviewed_at is not null)
  ),
  constraint loan_applications_id_user_unique unique (id, user_id),
  constraint loan_applications_user_id_fkey foreign key (user_id)
    references public.profiles (id) on delete cascade
);

create index if not exists loans_user_id_idx on public.loans (user_id);
create index if not exists payments_user_id_date_idx on public.payments (user_id, payment_date desc);
create index if not exists loan_applications_status_created_idx on public.loan_applications (status, created_at desc);
create index if not exists loan_applications_user_created_idx on public.loan_applications (user_id, created_at desc);

create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and approval_status = 'approved'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and approval_status = 'approved'
      and role = 'admin'
  );
$$;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    case
      when char_length(trim(coalesce(new.raw_user_meta_data ->> 'full_name', ''))) between 2 and 80
        then trim(new.raw_user_meta_data ->> 'full_name')
      else 'New member'
    end,
    new.email
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.sync_profile_email();

create or replace function public.set_account_approval(target_user_id uuid, approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an approved administrator can review account requests';
  end if;

  if target_user_id = (select auth.uid()) then
    raise exception 'You cannot change your own account approval';
  end if;

  update public.profiles
  set approval_status = case when approve then 'approved' else 'rejected' end
  where id = target_user_id and approval_status = 'pending';

  if not found then
    raise exception 'The account request no longer exists or has already been reviewed';
  end if;
end;
$$;

create or replace function public.review_loan_application(target_application_id uuid, approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  loan_request public.loan_applications%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Only an approved administrator can review loan applications';
  end if;

  select * into loan_request
  from public.loan_applications
  where id = target_application_id and status = 'pending'
  for update;

  if not found then
    raise exception 'The loan application no longer exists or has already been reviewed';
  end if;

  if approve then
    insert into public.loans (
      user_id, name, lender, principal, annual_rate, monthly_payment, start_date, due_date
    ) values (
      loan_request.user_id,
      loan_request.name,
      loan_request.lender,
      loan_request.requested_amount,
      loan_request.annual_rate,
      loan_request.monthly_payment,
      loan_request.start_date,
      loan_request.due_date
    );
  end if;

  update public.loan_applications
  set status = case when approve then 'approved' else 'rejected' end,
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = loan_request.id;
end;
$$;

revoke all on function public.is_approved() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.create_profile_for_new_user() from public;
revoke all on function public.sync_profile_email() from public;
revoke all on function public.set_account_approval(uuid, boolean) from public;
revoke all on function public.review_loan_application(uuid, boolean) from public;
grant execute on function public.is_approved() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.set_account_approval(uuid, boolean) to authenticated;
grant execute on function public.review_loan_application(uuid, boolean) to authenticated;

alter table public.profiles enable row level security;
alter table public.loans enable row level security;
alter table public.payments enable row level security;
alter table public.loan_applications enable row level security;

revoke all on table public.profiles, public.loans, public.payments, public.loan_applications from anon, authenticated;
grant select on table public.profiles to authenticated;
grant select on table public.loans to authenticated;
grant insert (user_id, name, lender, principal, annual_rate, monthly_payment, start_date, due_date, color)
  on public.loans to authenticated;
grant update (due_date) on table public.loans to authenticated;
grant select, insert on table public.payments to authenticated;
grant select on table public.loan_applications to authenticated;
grant insert (name, lender, requested_amount, annual_rate, monthly_payment, start_date, due_date)
  on public.loan_applications to authenticated;

drop policy if exists "Read own profile or profiles as an admin" on public.profiles;
create policy "Read own profile or profiles as an admin"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Approved members read their loans" on public.loans;
create policy "Approved members read their loans"
  on public.loans for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()));

drop policy if exists "Administrators read all member loans" on public.loans;
create policy "Administrators read all member loans"
  on public.loans for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "Approved members create their loans" on public.loans;
drop policy if exists "Administrators create loans" on public.loans;
create policy "Administrators create loans"
  on public.loans for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_admin()));

drop policy if exists "Approved members update their loans" on public.loans;
create policy "Approved members update their loans"
  on public.loans for update to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()))
  with check (user_id = (select auth.uid()) and (select public.is_approved()));

drop policy if exists "Approved members read their payments" on public.payments;
create policy "Approved members read their payments"
  on public.payments for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()));

drop policy if exists "Administrators read all member payments" on public.payments;
create policy "Administrators read all member payments"
  on public.payments for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "Approved members create their payments" on public.payments;
create policy "Approved members create their payments"
  on public.payments for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_approved()));

drop policy if exists "Members read their loan applications and admins read all" on public.loan_applications;
create policy "Members read their loan applications and admins read all"
  on public.loan_applications for select to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_approved()))
    or (select public.is_admin())
  );

drop policy if exists "Approved members submit loan applications" on public.loan_applications;
create policy "Approved members submit loan applications"
  on public.loan_applications for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and start_date >= current_date
    and (select public.is_approved())
  );
