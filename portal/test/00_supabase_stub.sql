-- Local stand-in for the pieces Supabase provides. Test harness only.
create extension if not exists pgcrypto;

do $$ begin create role anon nologin;          exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin;  exception when duplicate_object then null; end $$;

create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique
);

-- Real Supabase reads the JWT. Locally we impersonate via a session GUC.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean not null default false
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null
);
alter table storage.objects enable row level security;

grant usage on schema public, auth, storage to anon, authenticated, service_role;

-- Reproduce Supabase's default privileges. This matters more than it looks:
-- a real Supabase project grants ALL on new objects in `public` to anon and
-- authenticated, so a schema that only ADDS a SELECT grant leaves the write
-- privileges in place. Without these two lines the local harness is more secure
-- than production and silently hides that whole class of bug — which is exactly
-- what happened, and was only caught by checking grants on the real project.
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
