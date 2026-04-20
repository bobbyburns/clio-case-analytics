-- Clio Case Analytics Schema

create table public.clio_matters (
  id                    serial primary key,
  unique_id             text unique not null,
  display_number        text,
  description           text,
  status                text not null default 'Open',
  open_date             date,
  close_date            date,
  duration_days         integer,
  county                text,
  practice_area         text,
  case_type             text,
  number_of_children    integer,
  date_of_marriage      date,
  responsible_attorney  text,
  originating_attorney  text,
  opposing_counsel      text,
  has_opposing_counsel  boolean generated always as (opposing_counsel is not null and opposing_counsel != '') stored,
  retainer_type         text,
  scope_of_representation text,
  case_number           text,
  clients               text,
  billable              boolean default true,
  -- denormalized cost aggregates
  total_billable        numeric default 0,
  total_nonbillable     numeric default 0,
  total_expenses        numeric default 0,
  total_hours           numeric default 0,
  activity_count        integer default 0,
  created_at            timestamptz default now()
);

create index idx_matters_status on public.clio_matters (status);
create index idx_matters_case_type on public.clio_matters (case_type);
create index idx_matters_county on public.clio_matters (county);
create index idx_matters_attorney on public.clio_matters (responsible_attorney);
create index idx_matters_open_date on public.clio_matters (open_date);
create index idx_matters_close_date on public.clio_matters (close_date);
create index idx_matters_practice_area on public.clio_matters (practice_area);

alter table public.clio_matters enable row level security;
create policy "authenticated read" on public.clio_matters
  for select using (auth.role() = 'authenticated');
create policy "service insert" on public.clio_matters
  for insert with check (true);
create policy "service update" on public.clio_matters
  for update using (true);

create table public.clio_activities (
  id                  serial primary key,
  clio_id             text,
  type                text not null,
  activity_date       date,
  hours               numeric default 0,
  description         text,
  matter_display_number text not null,
  matter_unique_id    text references clio_matters(unique_id),
  flat_rate           boolean default false,
  rate                numeric default 0,
  billable_amount     numeric default 0,
  nonbillable_amount  numeric default 0,
  user_name           text,
  bill_state          text,
  bill_number         text,
  expense_category    text,
  created_at          timestamptz default now()
);

create index idx_activities_matter on public.clio_activities (matter_unique_id);
create index idx_activities_matter_display on public.clio_activities (matter_display_number);
create index idx_activities_date on public.clio_activities (activity_date);
create index idx_activities_type on public.clio_activities (type);
create index idx_activities_user on public.clio_activities (user_name);

alter table public.clio_activities enable row level security;
create policy "authenticated read" on public.clio_activities
  for select using (auth.role() = 'authenticated');
create policy "service insert" on public.clio_activities
  for insert with check (true);
