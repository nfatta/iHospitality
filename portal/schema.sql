-- =============================================================================
-- iHospitality Brand Portal — schema
-- Target: Supabase (PostgreSQL 15+). Apply via the Supabase SQL editor.
--
-- Design intent (from PORTAL_PLAN.md): this is the SYSTEM OF RECORD, not a
-- HubSpot mirror. Every hubspot_* column is nullable, so a row created in the
-- field with no HubSpot origin is a first-class citizen. That single decision
-- is what makes the Phase 6 cutover possible without a schema change.
--
-- Safe to re-run: everything is IF NOT EXISTS / idempotent.
-- =============================================================================


-- =============================================================================
-- SECTION 1 — Extensions and enums
-- =============================================================================

-- gen_random_uuid() lives here. Supabase enables this by default, but be explicit.
create extension if not exists pgcrypto;


-- The positioning rule from the work log, enforced by the database.
-- There is no 'south_florida' value, so the term cannot leak into brand-facing
-- output no matter what the application code does. Adding a value later is a
-- deliberate act (ALTER TYPE), which is exactly the friction we want.
do $$ begin
  create type market_enum as enum ('central_florida', 'palm_beach_county');
exception when duplicate_object then null;
end $$;


-- Where a brand stands with a venue. Ordered loosely from cold to committed.
do $$ begin
  create type account_status_enum as enum (
    'prospect',      -- identified, not yet pitched
    'pitched',       -- meeting or tasting happened, no order
    'placed',        -- first case sold — the moment that matters commercially
    'reordering',    -- placed and has bought again
    'dormant',       -- was active, nothing in 90+ days
    'lost'           -- explicitly declined or delisted
  );
exception when duplicate_object then null;
end $$;


-- Who a login belongs to.
--   brand_user  — a client. Sees only their own brand. RLS-restricted.
--   staff       — iHospitality. Sees everything.
do $$ begin
  create type profile_role_enum as enum ('brand_user', 'staff');
exception when duplicate_object then null;
end $$;


-- =============================================================================
-- SECTION 2 — Core tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- brands — the spirits brands represented.
-- -----------------------------------------------------------------------------
create table if not exists brands (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  -- slug is the URL-safe form ('blue-run'). Constrained so it can never contain
  -- a character that would need escaping in a URL or a storage path.
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  logo_url    text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);


-- -----------------------------------------------------------------------------
-- venues — bars, restaurants, clubs. HubSpot Companies.
-- -----------------------------------------------------------------------------
create table if not exists venues (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  city                text,
  county              text,
  market              market_enum,
  venue_type          text,          -- 'bar' | 'restaurant' | 'club' | 'retail' ...
                                     -- deliberately free text until the real
                                     -- vocabulary settles; promote to a lookup
                                     -- table once it does.
  -- Nullable AND unique. Nullable because field-created venues have no HubSpot
  -- record; unique because two rows must never claim the same HubSpot company.
  -- In Postgres, NULLs do not collide under a unique constraint, so any number
  -- of non-HubSpot venues coexist happily. This pattern repeats below.
  hubspot_company_id  text unique,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Venue names arrive inconsistently from HubSpot ('The Sailfish' vs 'Sailfish
-- Club'). This index does not fix that, but it makes the dedupe pass in
-- seed_from_csv.py fast, and it makes accidental exact duplicates visible.
create index if not exists venues_name_lower_idx on venues (lower(name));
create index if not exists venues_market_idx     on venues (market);


-- -----------------------------------------------------------------------------
-- activity_types — a LOOKUP TABLE, not an enum.
--
-- Why: the live HubSpot data contains 23 distinct 'Activity Type' strings that
-- represent roughly 10 real activities ('Account Visit' / 'account visit (PK)',
-- 'Tasting Event' / 'tasting event N/C', 'Drink List 1' / 'drink list 2' /
-- 'drink list N/C'). An enum would force a migration every time a new spelling
-- appears. A table lets the mess be cleaned in data rather than in DDL.
-- -----------------------------------------------------------------------------
create table if not exists activity_types (
  id              smallint primary key generated always as identity,
  code            text not null unique check (code ~ '^[a-z0-9_]+$'),
  label           text not null,          -- what a brand sees
  -- Some activities are performed at no charge (market favors, N/C tastings).
  -- Worth distinguishing: brands ask what they got for free.
  is_billable     boolean not null default true,
  -- Does this activity represent product actually moving?
  is_depletion    boolean not null default false,
  sort_order      smallint not null default 100,
  is_active       boolean not null default true
);

insert into activity_types (code, label, is_billable, is_depletion, sort_order) values
  ('account_visit',     'Account Visit',        true,  false, 10),
  ('tasting_event',     'Tasting Event',        true,  false, 20),
  ('staff_training',    'Staff Training',       true,  false, 30),
  ('drink_development', 'Drink Development',    true,  false, 40),
  ('drink_list',        'Drink List Placement', true,  false, 50),
  ('printed_feature',   'Printed Feature',      true,  false, 60),
  ('case_sale',         'Case Sale',            true,  true,  70),
  ('tap_placement',     'Tap Placement',        true,  true,  80),
  ('tap_maintenance',   'Tap Maintenance',      true,  false, 90),
  ('barrel_prep',       'Barrel Prep',          true,  false, 100),
  ('day_buyout',        'Day Buy-Out',          true,  false, 110),
  ('market_favor',      'Market Favor',         false, false, 120),
  ('market_needs',      'Market Needs',         false, false, 130),
  ('zoom_call',         'Video Call',           false, false, 140),
  ('mileage',           'Mileage',              true,  false, 150)
on conflict (code) do nothing;


-- -----------------------------------------------------------------------------
-- activity_type_aliases — the cleaning layer.
--
-- Maps every raw string seen in a HubSpot export to a canonical activity_type.
-- seed_from_csv.py and sync_hubspot.py look up here; anything NOT found is
-- reported rather than silently dropped, so new HubSpot spellings surface as a
-- warning instead of becoming missing data.
-- -----------------------------------------------------------------------------
create table if not exists activity_type_aliases (
  -- Stored lowercased and trimmed; the loader normalizes before lookup.
  raw_value        text primary key,
  activity_type_id smallint not null references activity_types(id)
);

insert into activity_type_aliases (raw_value, activity_type_id)
select v.raw_value, t.id
from (values
  ('account visit',        'account_visit'),
  ('account visit (pk)',   'account_visit'),
  ('tasting event',        'tasting_event'),
  ('tasting event n/c',    'tasting_event'),
  ('staff training',       'staff_training'),
  ('drink development',    'drink_development'),
  ('drink list 1',         'drink_list'),
  ('drink list 2',         'drink_list'),
  ('drink list n/c',       'drink_list'),
  ('printed feature',      'printed_feature'),
  ('1st case sale',        'case_sale'),
  ('second case',          'case_sale'),
  ('half case sale',       'case_sale'),
  ('account sold',         'case_sale'),
  ('tap w/2 cases',        'tap_placement'),
  ('tap maintenance',      'tap_maintenance'),
  ('barrel prep',          'barrel_prep'),
  ('day buy-out',          'day_buyout'),
  ('day buy-out split',    'day_buyout'),
  ('market favors n/c',    'market_favor'),
  ('market needs',         'market_needs'),
  ('zoom call no charge',  'zoom_call'),
  ('mileage',              'mileage')
) as v(raw_value, code)
join activity_types t on t.code = v.code
on conflict (raw_value) do nothing;

-- OPEN QUESTION (PORTAL_PLAN.md): 'account sold' is mapped to case_sale on the
-- assumption it means the first case moved. Confirm against the live pipeline
-- before seeding — if it actually means "account agreed to stock", it belongs
-- with brand_venue_status, not here.


-- -----------------------------------------------------------------------------
-- activities — the backbone. One row per visit / tasting / placement.
-- HubSpot Deals map here.
-- -----------------------------------------------------------------------------
create table if not exists activities (
  id                uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references brands(id) on delete restrict,
  venue_id          uuid     references venues(id) on delete restrict,
  activity_type_id  smallint not null references activity_types(id),
  activity_date     date not null,
  quantity          numeric(10,2) check (quantity is null or quantity >= 0),
  amount            numeric(10,2) check (amount   is null or amount   >= 0),

  -- TWO note fields, deliberately. This is the recommendation from the plan's
  -- open questions, made structural:
  --   notes                  — internal, candid, never exposed by RLS.
  --   brand_visible_summary  — what the client reads.
  -- Separating them means internal candour can never be published by accident;
  -- the brand-facing view below simply does not select `notes`.
  notes                 text,
  brand_visible_summary text,

  hubspot_deal_id   text unique,   -- nullable: field-created rows have none
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- No activity can be dated in the future. Cheap guard that catches a whole
  -- class of import and data-entry errors.
  constraint activities_date_not_future check (activity_date <= current_date)
);

-- The three access patterns the portal actually uses:
--   1. "this brand's activity, newest first"      (activity.html)
--   2. "everything at this venue"                 (venue detail)
--   3. "this month across brands"                 (admin)
create index if not exists activities_brand_date_idx on activities (brand_id, activity_date desc);
create index if not exists activities_venue_idx      on activities (venue_id);
create index if not exists activities_date_idx       on activities (activity_date desc);


-- -----------------------------------------------------------------------------
-- photos — always tied to the activity that produced them.
--
-- There is no brand_id column here on purpose: a photo's brand is whatever its
-- activity's brand is, and storing it twice invites the two copies to disagree.
-- RLS reaches the brand through the join instead.
-- -----------------------------------------------------------------------------
create table if not exists photos (
  id                uuid primary key default gen_random_uuid(),
  activity_id       uuid not null references activities(id) on delete cascade,
  -- Path within the Supabase Storage bucket, e.g. 'blue-run/2026/03/abc123.jpg'.
  storage_path      text not null unique,
  caption           text,
  -- Carried forward from GALLERY_PLAN.md: photos with identifiable people need
  -- consent tracked. Defaults to false — a photo is not publishable until
  -- somebody says it is.
  consent_confirmed boolean not null default false,
  hubspot_file_id   text unique,
  taken_at          timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists photos_activity_idx on photos (activity_id);


-- -----------------------------------------------------------------------------
-- brand_venue_status — the account list. Derived, but stored.
--
-- Stored rather than computed because the status is a JUDGEMENT ('dormant',
-- 'lost') that no query can infer reliably, and because brands will ask why a
-- venue is listed the way it is. The dates below are maintained by the trigger
-- at the bottom of this file so they cannot drift from the activity log.
-- -----------------------------------------------------------------------------
create table if not exists brand_venue_status (
  brand_id        uuid not null references brands(id) on delete cascade,
  venue_id        uuid not null references venues(id) on delete cascade,
  status          account_status_enum not null default 'prospect',
  first_placed_on date,
  last_touched_on date,
  notes           text,      -- internal
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- One status per brand/venue pair. The composite primary key IS the rule.
  primary key (brand_id, venue_id)
);

create index if not exists bvs_brand_status_idx on brand_venue_status (brand_id, status);


-- -----------------------------------------------------------------------------
-- profiles — maps a Supabase auth user to a brand. The hinge of the whole
-- security model.
-- -----------------------------------------------------------------------------
create table if not exists profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  brand_id    uuid references brands(id) on delete restrict,
  full_name   text,
  role        profile_role_enum not null default 'brand_user',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- A brand_user without a brand could see nothing — or, with a policy bug,
  -- everything. Make the invalid state unrepresentable.
  constraint profiles_brand_user_needs_brand
    check (role <> 'brand_user' or brand_id is not null)
);

create index if not exists profiles_brand_idx on profiles (brand_id);


-- =============================================================================
-- SECTION 3 — Row-level security
--
-- This is the most important section in the file. Isolation is enforced by
-- Postgres, so a bug in the portal's JavaScript CANNOT leak one brand's data to
-- another. Read every policy below as: "which rows does this user even exist to?"
-- =============================================================================

-- Two helper functions. They exist so policies stay readable and, critically,
-- so a policy on `profiles` doesn't have to query `profiles` — which would
-- recurse infinitely. SECURITY DEFINER makes these run as the owner, bypassing
-- RLS on the profiles lookup itself.
--
-- STABLE tells the planner the result cannot change within a statement, so it
-- is evaluated once per query rather than once per row. On a 10,000-row activity
-- table that is the difference between fast and unusable.

create or replace function auth_brand_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select brand_id from profiles
  where user_id = auth.uid() and is_active
$$;

create or replace function is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'staff' from profiles where user_id = auth.uid() and is_active),
    false
  )
$$;


alter table brands              enable row level security;
alter table venues              enable row level security;
alter table activities          enable row level security;
alter table photos              enable row level security;
alter table brand_venue_status  enable row level security;
alter table profiles            enable row level security;
alter table activity_types      enable row level security;
alter table activity_type_aliases enable row level security;

-- Drop-then-create so this file stays re-runnable while policies are iterated on.
drop policy if exists brands_select        on brands;
drop policy if exists venues_select        on venues;
drop policy if exists activities_select    on activities;
drop policy if exists photos_select        on photos;
drop policy if exists bvs_select           on brand_venue_status;
drop policy if exists profiles_select_self on profiles;
drop policy if exists lookup_select        on activity_types;
drop policy if exists alias_select         on activity_type_aliases;

-- A brand user sees exactly one brand: their own.
create policy brands_select on brands
  for select using (is_staff() or id = auth_brand_id());

-- The backbone policy. Everything else follows from it.
create policy activities_select on activities
  for select using (is_staff() or brand_id = auth_brand_id());

-- Venues are shared across brands, so a venue is visible only if the requesting
-- brand has some relationship with it. Without this, a brand could enumerate
-- every account iHospitality works — a real competitive leak, not a theoretical
-- one. Written as EXISTS rather than a join so it short-circuits on first hit.
create policy venues_select on venues
  for select using (
    is_staff()
    or exists (
      select 1 from brand_venue_status bvs
      where bvs.venue_id = venues.id and bvs.brand_id = auth_brand_id()
    )
    or exists (
      select 1 from activities a
      where a.venue_id = venues.id and a.brand_id = auth_brand_id()
    )
  );

-- Photos inherit their brand through the activity. Note this reads `activities`
-- directly rather than relying on that table's own policy — RLS policies do not
-- chain, so the check must be explicit here.
create policy photos_select on photos
  for select using (
    is_staff()
    or exists (
      select 1 from activities a
      where a.id = photos.activity_id and a.brand_id = auth_brand_id()
    )
  );

create policy bvs_select on brand_venue_status
  for select using (is_staff() or brand_id = auth_brand_id());

-- A user can read their own profile row and nothing else. Not even other users
-- at the same brand — there is no reason for a client to enumerate logins.
create policy profiles_select_self on profiles
  for select using (is_staff() or user_id = auth.uid());

-- Reference data: readable by any authenticated user, contains nothing private.
create policy lookup_select on activity_types
  for select to authenticated using (true);
create policy alias_select on activity_type_aliases
  for select to authenticated using (true);

-- Grants are the OTHER half of the lock, and they are easy to forget because
-- Supabase grants them implicitly to new tables in `public`. Being explicit
-- means this file describes the real permission state rather than relying on a
-- project setting that could differ.
--
-- Grant SELECT only. RLS then narrows those reads to the caller's own brand.
-- Both layers must pass: no grant means no access even where a policy allows it,
-- and a grant alone opens nothing while RLS is on with no matching policy.
grant select on
  brands, venues, activities, photos, brand_venue_status, profiles,
  activity_types, activity_type_aliases
to authenticated;

-- (The views are granted at the end of Section 4, once they exist.)

-- (`anon` is locked out at the very end of this file, after the views exist.)

-- NOTE ON WRITES: no INSERT/UPDATE/DELETE policies are defined anywhere above.
-- With RLS enabled and no write policy, all writes from the portal's anon/
-- authenticated key are DENIED by default. Writes happen only through the
-- Streamlit admin and the sync script, which use the service_role key and
-- bypass RLS entirely. Brands have a read-only portal, structurally.
-- If Phase 6 adds field entry through a brand-facing surface, write policies
-- get added here — deliberately, one at a time.


-- =============================================================================
-- SECTION 4 — Views for the dashboard
--
-- The summary numbers are SQL, not JavaScript arithmetic. The portal issues a
-- single SELECT against a view instead of pulling rows and adding them up in
-- the browser — faster, and it means the numbers are defined in exactly one
-- place.
--
-- security_invoker = true is essential: it makes the view run with the CALLING
-- user's permissions, so the RLS policies above still apply through the view.
-- Without it (the Postgres default) a view is a hole straight through RLS.
-- =============================================================================

-- Activity per brand per month — the dashboard's headline numbers.
create or replace view v_brand_monthly_summary
with (security_invoker = true) as
select
  a.brand_id,
  b.name                                    as brand_name,
  date_trunc('month', a.activity_date)::date as month,
  count(*)                                  as activity_count,
  count(distinct a.venue_id)                as venues_touched,
  -- FILTER is the clean way to conditionally aggregate — no CASE WHEN needed.
  count(*) filter (where t.is_depletion)     as depletion_events,
  coalesce(sum(a.quantity) filter (where t.is_depletion), 0) as units_moved,
  coalesce(sum(a.amount), 0)                as total_amount,
  coalesce(ph.photo_count, 0)               as photo_count
from activities a
join brands b          on b.id = a.brand_id
join activity_types t  on t.id = a.activity_type_id
-- Photos are counted in a subquery aggregated to the SAME grain (brand, month)
-- and then joined, rather than joined row-by-row. Joining photos directly would
-- fan out one activity into N rows and silently multiply every sum() above —
-- the classic way an aggregate query starts lying.
left join (
  select pa.brand_id,
         date_trunc('month', pa.activity_date)::date as month,
         count(*) as photo_count
  from photos p
  join activities pa on pa.id = p.activity_id
  group by pa.brand_id, date_trunc('month', pa.activity_date)
) ph on ph.brand_id = a.brand_id
    and ph.month    = date_trunc('month', a.activity_date)::date
group by a.brand_id, b.name, date_trunc('month', a.activity_date), ph.photo_count;


-- The account list, as the venues page renders it.
create or replace view v_brand_venue_counts
with (security_invoker = true) as
select
  bvs.brand_id,
  bvs.venue_id,
  v.name          as venue_name,
  v.city,
  v.market,
  v.venue_type,
  bvs.status,
  bvs.first_placed_on,
  bvs.last_touched_on,
  count(a.id)                       as activity_count,
  max(a.activity_date)              as most_recent_activity,
  -- Days since anyone was in the room. The single most useful number on the
  -- page, and the one that starts conversations.
  current_date - max(a.activity_date) as days_since_activity
from brand_venue_status bvs
join venues v on v.id = bvs.venue_id
-- LEFT JOIN so a prospect venue with zero activities still appears, with a
-- count of 0. An inner join would silently hide exactly the venues that need
-- attention most.
left join activities a
  on a.venue_id = bvs.venue_id and a.brand_id = bvs.brand_id
group by bvs.brand_id, bvs.venue_id, v.name, v.city, v.market, v.venue_type,
         bvs.status, bvs.first_placed_on, bvs.last_touched_on;


-- The activity log, brand-safe. Note what is ABSENT: a.notes. The portal reads
-- this view rather than the table, so internal notes have no path to a client
-- screen even if a page is written carelessly.
create or replace view v_brand_activity_log
with (security_invoker = true) as
select
  a.id,
  a.brand_id,
  a.activity_date,
  t.label            as activity_type,
  t.code             as activity_type_code,
  v.name             as venue_name,
  v.city,
  v.market,
  a.quantity,
  a.brand_visible_summary as summary,
  (select count(*) from photos p where p.activity_id = a.id) as photo_count
from activities a
join activity_types t on t.id = a.activity_type_id
left join venues v    on v.id = a.venue_id
order by a.activity_date desc;


grant select on
  v_brand_monthly_summary, v_brand_venue_counts, v_brand_activity_log
to authenticated;


-- =============================================================================
-- SECTION 5 — Triggers
-- =============================================================================

-- Keep updated_at honest. One function, reused by every table that has the
-- column — this is why the column is named identically everywhere.
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['brands','venues','activities','brand_venue_status','profiles']
  loop
    execute format('drop trigger if exists %I_set_updated_at on %I', t, t);
    execute format(
      'create trigger %I_set_updated_at before update on %I
         for each row execute function set_updated_at()', t, t);
  end loop;
end $$;


-- Keep brand_venue_status.last_touched_on / first_placed_on in step with the
-- activity log automatically. Without this the account list drifts out of date
-- the moment someone forgets to update it by hand — and a stale account list is
-- worse than none, because it gets quoted to a client.
create or replace function sync_brand_venue_status()
returns trigger language plpgsql as $$
declare
  is_depletion_activity boolean;
begin
  if new.venue_id is null then
    return new;
  end if;

  select t.is_depletion into is_depletion_activity
  from activity_types t where t.id = new.activity_type_id;

  insert into brand_venue_status (brand_id, venue_id, status, last_touched_on, first_placed_on)
  values (
    new.brand_id,
    new.venue_id,
    case when is_depletion_activity then 'placed'::account_status_enum
         else 'pitched'::account_status_enum end,
    new.activity_date,
    case when is_depletion_activity then new.activity_date else null end
  )
  on conflict (brand_id, venue_id) do update set
    -- GREATEST so a backfilled older activity never drags the date backwards.
    last_touched_on = greatest(brand_venue_status.last_touched_on, excluded.last_touched_on),
    -- LEAST so the FIRST placement wins, whatever order rows are imported in.
    first_placed_on = least(
      coalesce(brand_venue_status.first_placed_on, excluded.first_placed_on),
      coalesce(excluded.first_placed_on, brand_venue_status.first_placed_on)
    ),
    -- Only ever advance the status automatically, and only up to 'placed'.
    -- 'reordering', 'dormant' and 'lost' are human judgements the trigger must
    -- not overwrite — hence the explicit list of statuses it may replace.
    status = case
      when is_depletion_activity and brand_venue_status.status in ('prospect','pitched')
        then 'placed'::account_status_enum
      when brand_venue_status.status = 'prospect'
        then 'pitched'::account_status_enum
      else brand_venue_status.status
    end,
    updated_at = now();

  return new;
end $$;

drop trigger if exists activities_sync_bvs on activities;
create trigger activities_sync_bvs
  after insert or update of venue_id, brand_id, activity_date, activity_type_id
  on activities
  for each row execute function sync_brand_venue_status();


-- =============================================================================
-- SECTION 6 — Storage
-- =============================================================================

-- Private bucket for activation photos. `false` is the whole point: objects are
-- unreachable without a signed URL, so a leaked storage path is not a leaked
-- photo. The portal requests signed URLs at render time.
insert into storage.buckets (id, name, public)
values ('activation-photos', 'activation-photos', false)
on conflict (id) do nothing;

drop policy if exists photos_storage_select on storage.objects;
create policy photos_storage_select on storage.objects
  for select using (
    bucket_id = 'activation-photos'
    and (
      is_staff()
      or exists (
        select 1
        from photos p
        join activities a on a.id = p.activity_id
        where p.storage_path = storage.objects.name
          and a.brand_id = auth_brand_id()
      )
    )
  );


-- =============================================================================
-- SECTION 7 — Final lockdown
--
-- Deliberately LAST in the file. Supabase applies default privileges that grant
-- `anon` access to newly created tables and views in `public`, so revoking
-- earlier would miss everything defined after that point — including the three
-- dashboard views. Running this at the end catches all of it.
--
-- `anon` is the key embedded in the portal's public HTML. It needs to reach
-- exactly one thing: the login endpoint, which lives in Supabase's auth schema,
-- not here. It gets nothing from `public`.
-- =============================================================================

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- And stop future objects from re-opening the hole.
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
