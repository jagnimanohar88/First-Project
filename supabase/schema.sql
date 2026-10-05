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
  term_months integer check (term_months between 1 and 600),
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
  payment_type text not null default 'regular' check (payment_type in ('interest_only', 'regular')),
  note text not null default 'Repayment' check (char_length(note) between 1 and 60),
  created_at timestamptz not null default now(),
  constraint payments_owned_loan foreign key (loan_id, user_id)
    references public.loans (id, user_id) on delete cascade
);

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  loan_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  payment_date date not null default current_date check (payment_date <= current_date),
  payment_type text not null check (payment_type in ('interest_only', 'regular')),
  note text not null default 'Repayment' check (char_length(note) between 1 and 60),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint payment_requests_review_fields check (
    (status = 'pending' and reviewed_at is null)
    or (status in ('approved', 'rejected') and reviewed_at is not null)
  ),
  constraint payment_requests_owned_loan foreign key (loan_id, user_id)
    references public.loans (id, user_id) on delete cascade
);

create table if not exists public.loan_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null check (char_length(name) between 1 and 55),
  lender text not null check (char_length(lender) between 1 and 55),
  requested_amount numeric(14, 2) not null check (requested_amount > 0),
  term_months integer not null check (term_months between 1 and 600),
  annual_rate numeric(5, 2) check (annual_rate between 0 and 100),
  monthly_payment numeric(14, 2) check (monthly_payment > 0),
  start_date date,
  due_date date,
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

alter table public.loans add column if not exists term_months integer;
alter table public.loans drop constraint if exists loans_term_months_check;
alter table public.loans add constraint loans_term_months_check
  check (term_months is null or term_months between 1 and 600);

alter table public.payments add column if not exists payment_type text not null default 'regular';
alter table public.payments drop constraint if exists payments_payment_type_check;
alter table public.payments add constraint payments_payment_type_check
  check (payment_type in ('interest_only', 'regular'));

alter table public.loan_applications add column if not exists term_months integer;
alter table public.loan_applications alter column annual_rate drop not null;
alter table public.loan_applications alter column monthly_payment drop not null;
alter table public.loan_applications alter column start_date drop not null;
alter table public.loan_applications alter column due_date drop not null;
alter table public.loan_applications drop constraint if exists loan_applications_term_months_check;
alter table public.loan_applications add constraint loan_applications_term_months_check
  check (term_months is null or term_months between 1 and 600);

create index if not exists loans_user_id_idx on public.loans (user_id);
create index if not exists payments_user_id_date_idx on public.payments (user_id, payment_date desc);
create index if not exists payment_requests_status_created_idx on public.payment_requests (status, created_at desc);
create index if not exists payment_requests_user_created_idx on public.payment_requests (user_id, created_at desc);
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

drop function if exists public.review_loan_application(uuid, boolean);
create or replace function public.review_loan_application(
  target_application_id uuid,
  approve boolean,
  approved_term_months integer,
  approved_annual_rate numeric,
  approved_monthly_payment numeric,
  approved_due_date date
)
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
    if approved_term_months is null or approved_term_months < 1 or approved_term_months > 600 then
      raise exception 'Enter an approved repayment term between 1 and 600 months';
    end if;
    if approved_annual_rate is null or approved_annual_rate < 0 or approved_annual_rate > 100 then
      raise exception 'Enter an approved annual interest rate between 0 and 100';
    end if;
    if approved_monthly_payment is null or approved_monthly_payment <= 0 then
      raise exception 'Enter a positive approved monthly payment';
    end if;
    if approved_due_date is null or approved_due_date < current_date then
      raise exception 'The first payment due date must be today or later';
    end if;

    insert into public.loans (
      user_id, name, lender, principal, annual_rate, monthly_payment, start_date, due_date, term_months
    ) values (
      loan_request.user_id,
      loan_request.name,
      loan_request.lender,
      loan_request.requested_amount,
      approved_annual_rate,
      approved_monthly_payment,
      current_date,
      approved_due_date,
      approved_term_months
    );

    update public.loan_applications
    set term_months = approved_term_months,
        annual_rate = approved_annual_rate,
        monthly_payment = approved_monthly_payment,
        start_date = current_date,
        due_date = approved_due_date
    where id = loan_request.id;
  end if;

  update public.loan_applications
  set status = case when approve then 'approved' else 'rejected' end,
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = loan_request.id;
end;
$$;

create or replace function public.review_payment_request(
  target_payment_request_id uuid,
  approve boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_request public.payment_requests%rowtype;
  loan_record public.loans%rowtype;
  prior_payment record;
  remaining_principal numeric;
  accrued_interest numeric := 0;
  interest_payment numeric;
  principal_payment numeric;
  cursor_date date;
  remaining_balance numeric;
begin
  if not public.is_admin() then
    raise exception 'Only an approved administrator can review payment requests';
  end if;

  select * into payment_request
  from public.payment_requests
  where id = target_payment_request_id and status = 'pending'
  for update;

  if not found then
    raise exception 'The payment request no longer exists or has already been reviewed';
  end if;

  if approve then
    select * into loan_record
    from public.loans
    where id = payment_request.loan_id and user_id = payment_request.user_id
    for update;

    if not found then
      raise exception 'The loan for this payment request no longer exists';
    end if;
    if payment_request.payment_date < loan_record.start_date then
      raise exception 'The payment date cannot be before the loan start date';
    end if;

    remaining_principal := loan_record.principal;
    cursor_date := loan_record.start_date;
    for prior_payment in
      select amount, payment_date, payment_type
      from public.payments
      where loan_id = loan_record.id
        and user_id = loan_record.user_id
        and payment_date >= loan_record.start_date
        and payment_date <= payment_request.payment_date
      order by payment_date, created_at, id
    loop
      accrued_interest := accrued_interest
        + remaining_principal * loan_record.annual_rate / 100
          * (prior_payment.payment_date - cursor_date)::numeric / 365;
      cursor_date := prior_payment.payment_date;
      interest_payment := least(
        case
          when prior_payment.payment_type = 'interest_only' then round(accrued_interest, 2)
          else accrued_interest
        end,
        prior_payment.amount
      );
      accrued_interest := greatest(0, accrued_interest - interest_payment);

      if prior_payment.payment_type <> 'interest_only' then
        principal_payment := least(
          remaining_principal,
          greatest(0, prior_payment.amount - interest_payment)
        );
        remaining_principal := greatest(0, remaining_principal - principal_payment);
      end if;
    end loop;

    accrued_interest := accrued_interest
      + remaining_principal * loan_record.annual_rate / 100
        * (payment_request.payment_date - cursor_date)::numeric / 365;
    remaining_balance := remaining_principal + accrued_interest;

    if payment_request.payment_type = 'interest_only'
       and payment_request.amount > round(accrued_interest, 2) then
      raise exception 'The requested interest-only payment is greater than the accrued interest on that date';
    end if;
    if payment_request.payment_type = 'regular'
       and payment_request.amount > remaining_balance + 0.01 then
      raise exception 'The requested payment is greater than the remaining loan balance on that date';
    end if;

    insert into public.payments (user_id, loan_id, amount, payment_date, payment_type, note)
    values (
      payment_request.user_id,
      payment_request.loan_id,
      payment_request.amount,
      payment_request.payment_date,
      payment_request.payment_type,
      payment_request.note
    );
  end if;

  update public.payment_requests
  set status = case when approve then 'approved' else 'rejected' end,
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = payment_request.id;
end;
$$;

revoke all on function public.is_approved() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.create_profile_for_new_user() from public;
revoke all on function public.sync_profile_email() from public;
revoke all on function public.set_account_approval(uuid, boolean) from public;
revoke all on function public.review_loan_application(uuid, boolean, integer, numeric, numeric, date) from public;
revoke all on function public.review_payment_request(uuid, boolean) from public;
grant execute on function public.is_approved() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.set_account_approval(uuid, boolean) to authenticated;
grant execute on function public.review_loan_application(uuid, boolean, integer, numeric, numeric, date) to authenticated;
grant execute on function public.review_payment_request(uuid, boolean) to authenticated;

alter table public.profiles enable row level security;
alter table public.loans enable row level security;
alter table public.payments enable row level security;
alter table public.payment_requests enable row level security;
alter table public.loan_applications enable row level security;

revoke all on table public.profiles, public.loans, public.payments, public.payment_requests, public.loan_applications from anon, authenticated;
grant select on table public.profiles to authenticated;
grant select on table public.loans to authenticated;
grant insert (user_id, name, lender, principal, annual_rate, monthly_payment, start_date, due_date, color)
  on public.loans to authenticated;
grant update (due_date) on table public.loans to authenticated;
grant select on table public.payments to authenticated;
grant insert (user_id, loan_id, amount, payment_date, payment_type, note) on public.payments to authenticated;
grant select, insert on table public.payment_requests to authenticated;
grant select on table public.loan_applications to authenticated;
grant insert (name, lender, requested_amount, term_months)
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
drop policy if exists "Administrators update loan due dates" on public.loans;
create policy "Administrators update loan due dates"
  on public.loans for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Approved members read their payments" on public.payments;
create policy "Approved members read their payments"
  on public.payments for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_approved()));

drop policy if exists "Administrators read all member payments" on public.payments;
create policy "Administrators read all member payments"
  on public.payments for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "Approved members create their payments" on public.payments;
drop policy if exists "Administrators create their payments" on public.payments;
create policy "Administrators create their payments"
  on public.payments for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_admin()));

drop policy if exists "Members read their payment requests and admins read all" on public.payment_requests;
create policy "Members read their payment requests and admins read all"
  on public.payment_requests for select to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_approved()))
    or (select public.is_admin())
  );

drop policy if exists "Approved members submit payment requests" on public.payment_requests;
create policy "Approved members submit payment requests"
  on public.payment_requests for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and (select public.is_approved())
  );

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
    and term_months between 1 and 600
    and (select public.is_approved())
  );
