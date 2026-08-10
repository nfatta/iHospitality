\set ON_ERROR_STOP on
\pset pager off

-- ============================================================
-- Fixtures: two brands that must never see each other.
-- ============================================================
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'blue@test'),
  ('22222222-2222-2222-2222-222222222222', 'starr@test'),
  ('33333333-3333-3333-3333-333333333333', 'nicholas@test');

insert into brands (id, name, slug) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Blue Run',  'blue-run'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Starr Rum', 'starr-rum');

insert into profiles (user_id, brand_id, full_name, role) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Blue Run Client',  'brand_user'),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000002', 'Starr Rum Client', 'brand_user'),
  ('33333333-3333-3333-3333-333333333333', null,                                    'Nicholas',         'staff');

insert into venues (id, name, city, market, hubspot_company_id) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'The Sailfish Club', 'Palm Beach', 'palm_beach_county', 'hs-1'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Wall Street Bar',   'Orlando',    'central_florida',   'hs-2');

insert into activities (id, brand_id, venue_id, activity_type_id, activity_date, quantity, notes, brand_visible_summary, hubspot_deal_id)
select 'cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
       'bbbbbbbb-0000-0000-0000-000000000001', id, current_date - 10, 2,
       'INTERNAL: GM was difficult, do not bring the rep back', 'Tasting held, two cases placed.', 'deal-1'
from activity_types where code = 'case_sale';

insert into activities (id, brand_id, venue_id, activity_type_id, activity_date, quantity, notes, brand_visible_summary, hubspot_deal_id)
select 'cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
       'bbbbbbbb-0000-0000-0000-000000000002', id, current_date - 5, 1,
       'INTERNAL: competitor pouring next month', 'Staff training completed.', 'deal-2'
from activity_types where code = 'staff_training';

insert into photos (activity_id, storage_path, caption) values
  ('cccccccc-0000-0000-0000-000000000001', 'blue-run/2026/08/a.jpg',  'Blue Run back bar'),
  ('cccccccc-0000-0000-0000-000000000002', 'starr-rum/2026/08/b.jpg', 'Starr Rum training');

\echo ''
\echo '=== TRIGGER CHECK: brand_venue_status auto-populated from activities? ==='
select b.name, v.name as venue, s.status, s.first_placed_on is not null as has_placed_date
from brand_venue_status s
join brands b on b.id = s.brand_id join venues v on v.id = s.venue_id
order by b.name;

-- ============================================================
-- Attack 1: log in as Blue Run, try to read everything.
-- ============================================================
\echo ''
\echo '=== AS BLUE RUN CLIENT (expect: only Blue Run rows, count 1 each) ==='
set role authenticated;
set app.current_user_id = '11111111-1111-1111-1111-111111111111';

select 'brands'     as tbl, count(*) from brands
union all select 'activities',        count(*) from activities
union all select 'venues',            count(*) from venues
union all select 'photos',            count(*) from photos
union all select 'brand_venue_status',count(*) from brand_venue_status
union all select 'profiles',          count(*) from profiles
union all select 'view: activity_log',count(*) from v_brand_activity_log
union all select 'view: monthly',     count(*) from v_brand_monthly_summary
union all select 'view: venues',      count(*) from v_brand_venue_counts;

\echo ''
\echo '--- Attack 1a: name the other brand explicitly (expect 0 rows) ---'
select count(*) as leaked from activities where brand_id = 'aaaaaaaa-0000-0000-0000-000000000002';
select count(*) as leaked from brands     where slug = 'starr-rum';
select count(*) as leaked from photos     where storage_path like 'starr-rum%';
select count(*) as leaked from venues     where hubspot_company_id = 'hs-2';

\echo ''
\echo '--- Attack 1b: does the brand-facing view expose internal notes? ---'
\d v_brand_activity_log

\echo ''
\echo '--- Attack 1c: what does Blue Run actually see in the log? ---'
select venue_name, activity_type, summary, photo_count from v_brand_activity_log;

\echo ''
\echo '--- Attack 1d: try to WRITE (expect: permission denied) ---'
\set ON_ERROR_STOP off
insert into activities (brand_id, venue_id, activity_type_id, activity_date)
values ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',1,current_date);
update activities set quantity = 999 where brand_id = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from activities;
update profiles set brand_id = 'aaaaaaaa-0000-0000-0000-000000000002' where user_id = auth.uid();
\set ON_ERROR_STOP on

-- ============================================================
-- Attack 2: the same, as Starr Rum. Mirror image.
-- ============================================================
\echo ''
\echo '=== AS STARR RUM CLIENT (expect: only Starr Rum rows) ==='
set app.current_user_id = '22222222-2222-2222-2222-222222222222';
select venue_name, activity_type, summary from v_brand_activity_log;
select 'blue run rows visible' as check, count(*) from activities where brand_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- ============================================================
-- Attack 3: no session / unauthenticated.
-- ============================================================
\echo ''
\echo '=== AS UNAUTHENTICATED (auth.uid() null — expect 0 everywhere) ==='
set app.current_user_id = '';
select 'brands' as tbl, count(*) from brands
union all select 'activities', count(*) from activities
union all select 'photos',     count(*) from photos;

-- ============================================================
-- Staff should see everything.
-- ============================================================
\echo ''
\echo '=== AS STAFF (expect: all rows, both brands) ==='
set app.current_user_id = '33333333-3333-3333-3333-333333333333';
select 'brands' as tbl, count(*) from brands
union all select 'activities', count(*) from activities
union all select 'photos',     count(*) from photos
union all select 'venues',     count(*) from venues;

reset role;

-- ============================================================
-- Constraint checks: the guards should actually fire.
-- ============================================================
\echo ''
\echo '=== CONSTRAINTS (each of these MUST fail) ==='
\set ON_ERROR_STOP off
\echo '-- future-dated activity:'
insert into activities (brand_id, venue_id, activity_type_id, activity_date)
values ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',1,current_date + 30);
\echo '-- south_florida as a market:'
insert into venues (name, market) values ('Nope', 'south_florida');
\echo '-- brand_user with no brand:'
insert into profiles (user_id, role) values ('33333333-3333-3333-3333-333333333333','brand_user');
\echo '-- duplicate hubspot deal id:'
insert into activities (brand_id, venue_id, activity_type_id, activity_date, hubspot_deal_id)
values ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',1,current_date,'deal-1');
\echo '-- bad slug:'
insert into brands (name, slug) values ('Bad','Not A Slug');
\set ON_ERROR_STOP on

\echo ''
\echo '=== Two NULL hubspot ids must coexist (field-created rows) ==='
insert into venues (name, market) values ('Field Venue A','central_florida'), ('Field Venue B','central_florida');
select count(*) as field_created_venues from venues where hubspot_company_id is null;


-- ============================================================
-- Admin-managed taxonomy. An import must never lose a row just
-- because the admin has not defined that activity type yet.
-- ============================================================
\echo ''
\echo '=== TAXONOMY: resolve_activity_type ==='

\echo '-- known alias resolves to the existing type, creates nothing:'
select (select count(*) from activity_types) as types_before,
       resolve_activity_type('  Account Visit  ') = (select id from activity_types where code='account_visit') as matched_existing,
       (select count(*) from activity_types) as types_after;

\echo '-- unknown value is created, flagged for review, NOT dropped:'
select resolve_activity_type('Sponsored Brunch Takeover') as new_id;
select code, label, needs_review from activity_types where code = 'sponsored_brunch_takeover';

\echo '-- same unknown value twice does not create a second type:'
select resolve_activity_type('sponsored brunch takeover') = resolve_activity_type('Sponsored Brunch Takeover') as stable;
select count(*) as should_be_1 from activity_types where code = 'sponsored_brunch_takeover';

\echo '-- messy punctuation still yields a legal code:'
select resolve_activity_type('Drink List 3!!  (PK)') as id;
select code from activity_types where needs_review and code like 'drink_list_3%';

\echo '-- blank/null routes to unclassified rather than inventing a type:'
select resolve_activity_type('') = resolve_activity_type(null) as both_unclassified;
select code, needs_review from activity_types where code = 'unclassified';

\echo ''
\echo '-- admin review queue:'
select code, label, activity_count from v_activity_types_needing_review;

\echo ''
\echo '=== TAXONOMY: merge_activity_type ==='
-- Give the invented type some activities, then fold it into a real one.
insert into activities (brand_id, venue_id, activity_type_id, activity_date)
select 'aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',
       id, current_date - 3
from activity_types where code = 'sponsored_brunch_takeover';

select count(*) as activities_on_source_before
from activities where activity_type_id = (select id from activity_types where code='sponsored_brunch_takeover');

select merge_activity_type('sponsored_brunch_takeover', 'tasting_event');

select count(*) as activities_on_source_after
from activities where activity_type_id = (select id from activity_types where code='sponsored_brunch_takeover');
select is_active as source_retired_not_deleted, needs_review
from activity_types where code = 'sponsored_brunch_takeover';

\echo '-- the old raw string now resolves to the MERGE TARGET, not a fresh type:'
select resolve_activity_type('Sponsored Brunch Takeover') = (select id from activity_types where code='tasting_event') as follows_merge;

\echo '-- merge guards:'
\set ON_ERROR_STOP off
select merge_activity_type('does_not_exist', 'tasting_event');
select merge_activity_type('tasting_event', 'tasting_event');
\set ON_ERROR_STOP on

\echo ''
\echo '=== A BRAND USER MUST NOT BE ABLE TO CALL THESE (expect permission denied) ==='
set role authenticated;
set app.current_user_id = '11111111-1111-1111-1111-111111111111';
\set ON_ERROR_STOP off
select resolve_activity_type('Backdoor Type');
select merge_activity_type('tasting_event','account_visit');
\set ON_ERROR_STOP on
reset role;

\echo ''
\echo '-- confirm the brand user created nothing:'
select count(*) as backdoor_types from activity_types where code = 'backdoor_type';
