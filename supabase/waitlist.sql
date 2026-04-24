-- APEX Waitlist Table Setup
-- Run this ONCE in your Supabase SQL editor (SQL > New Query > paste > Run).
-- Required before the /.netlify/functions/waitlist endpoint can insert records.
--
-- Uses the project you already have connected:
--   SUPABASE_URL=https://mxyepucitjzleaziizkr.supabase.co  (verify yours)
--   SUPABASE_ANON_KEY=...  (get from Supabase dashboard, Settings > API)
--
-- Both env vars must be set in Netlify:
--   Netlify dashboard > Site settings > Environment variables > Add variable
--   SUPABASE_URL and SUPABASE_ANON_KEY
--   Trigger a fresh deploy after adding them.

-- 1) Table definition
create table if not exists public.waitlist (
  id bigserial primary key,
  email text unique not null,
  source text,
  created_at timestamptz default now(),
  ip_hash text,
  user_agent text
);

-- 2) Index for quick sort-by-date queries
create index if not exists waitlist_created_at_idx on public.waitlist (created_at desc);

-- 3) Row-Level Security: allow anonymous inserts, block reads/updates.
alter table public.waitlist enable row level security;

-- 4) Insert policy: anyone can insert (that's how the form works).
drop policy if exists "anon_insert_waitlist" on public.waitlist;
create policy "anon_insert_waitlist"
  on public.waitlist
  for insert
  to anon
  with check (true);

-- NOTE: no select/update/delete policies for `anon` role. This means:
--   - Visitors (via the website) can ADD emails to the waitlist
--   - Visitors CANNOT read, update, or delete anyone's email
--   - Only you (Supabase dashboard, service role, or authenticated admin)
--     can see the list

-- 5) To view the waitlist, go to Supabase Dashboard > Table Editor > waitlist.
--    Or run: select email, source, created_at from waitlist order by created_at desc;
