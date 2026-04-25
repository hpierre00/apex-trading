-- APEX Waitlist Table Setup
-- Already applied to the apex-production Supabase project:
--   Project ID:  soghksmuocrgtttmnete
--   Project URL: https://soghksmuocrgtttmnete.supabase.co
--   Region:      us-east-1
--
-- Netlify env vars (already set via MCP):
--   SUPABASE_URL     = https://soghksmuocrgtttmnete.supabase.co
--   SUPABASE_ANON_KEY = (set as secret in Netlify dashboard)
--
-- If you ever need to re-run this (e.g. on a new project), paste into
-- Supabase Dashboard > SQL Editor > New query > Run.

create table if not exists public.waitlist (
  id bigserial primary key,
  email text unique not null,
  source text,
  created_at timestamptz default now(),
  ip_hash text,
  user_agent text
);

create index if not exists waitlist_created_at_idx
  on public.waitlist (created_at desc);

alter table public.waitlist enable row level security;

drop policy if exists "anon_insert_waitlist" on public.waitlist;
create policy "anon_insert_waitlist"
  on public.waitlist
  for insert
  to anon
  with check (true);

-- To view the waitlist:
-- select email, source, created_at from waitlist order by created_at desc;
