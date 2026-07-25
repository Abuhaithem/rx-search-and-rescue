-- Supabase-specific setup: profile auto-creation + Row Level Security.
-- Idempotent: safe to re-run on every migrate.
--
-- NOTE ON AUTHORIZATION MODEL: all app data access goes through Next.js server
-- actions using the direct Postgres connection (bypasses RLS by design), where
-- role checks are enforced in code against the caller's Supabase session.
-- RLS here is defense-in-depth so the anon/authenticated PostgREST surface and
-- supabase-js clients can never read PHI directly.

-- ── Profile auto-creation on signup ─────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email, 'Agent'),
    'agent'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── Enable RLS everywhere; deny-by-default for anon/authenticated ──────────
do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- Profiles: users can read all profiles (needed for names in UI), update own.
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select to authenticated using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Reference data (non-PHI): readable by any authenticated user.
do $$
declare
  t text;
begin
  foreach t in array array[
    'carriers','formularies','formulary_entries','formulary_legends',
    'plans','plan_service_areas','plan_tier_costs','zip_counties',
    'pharmacies','plan_pharmacy_networks'
  ]
  loop
    execute format('drop policy if exists "%s_select_authenticated" on public.%I', t, t);
    execute format(
      'create policy "%s_select_authenticated" on public.%I for select to authenticated using (true)',
      t, t
    );
  end loop;
end;
$$;

-- PHI tables (clients, medications, analyses, …): NO anon/authenticated
-- policies at all — only the service-role/server path can touch them.
