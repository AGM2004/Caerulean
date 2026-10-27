-- Caerulean database schema.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Tables:
--   profiles     one row per signed-in user (creator or brand)
--   connections  a request from one profile to another; messaging unlocks once accepted
--   messages     messages inside an accepted connection
--
-- Row level security makes sure users only ever see their own connections and
-- the messages in them, even though the anon key is public.

-- Profiles ------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('creator', 'brand')),
  display_name text not null check (char_length(display_name) between 1 and 80),
  handle text check (char_length(handle) <= 200),
  niche text check (char_length(niche) <= 120),
  bio text check (char_length(bio) <= 1000),
  avatar_url text check (char_length(avatar_url) <= 500),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Signed-in users can view profiles"
  on public.profiles for select to authenticated
  using (true);

create policy "Users can create their own profile"
  on public.profiles for insert to authenticated
  with check (id = auth.uid());

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Connections ---------------------------------------------------------------

create table public.connections (
  id bigint generated always as identity primary key,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);

-- At most one connection per pair of people, whichever side asked.
create unique index connections_pair_idx
  on public.connections (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

alter table public.connections enable row level security;

create policy "Users can view their own connections"
  on public.connections for select to authenticated
  using (auth.uid() in (requester_id, addressee_id));

create policy "Users can send connection requests"
  on public.connections for insert to authenticated
  with check (requester_id = auth.uid() and status = 'pending');

create policy "Recipients can accept requests"
  on public.connections for update to authenticated
  using (addressee_id = auth.uid())
  with check (addressee_id = auth.uid() and status = 'accepted');

-- Declining, cancelling and disconnecting all delete the row.
create policy "Either side can remove a connection"
  on public.connections for delete to authenticated
  using (auth.uid() in (requester_id, addressee_id));

-- Only the status column can ever be changed.
revoke update on public.connections from anon, authenticated;
grant update (status) on public.connections to authenticated;

-- Messages ------------------------------------------------------------------

create table public.messages (
  id bigint generated always as identity primary key,
  connection_id bigint not null references public.connections (id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index messages_connection_idx on public.messages (connection_id, created_at);

alter table public.messages enable row level security;

create policy "Connected users can read their messages"
  on public.messages for select to authenticated
  using (exists (
    select 1 from public.connections c
    where c.id = connection_id
      and c.status = 'accepted'
      and auth.uid() in (c.requester_id, c.addressee_id)
  ));

create policy "Connected users can send messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.connections c
      where c.id = connection_id
        and c.status = 'accepted'
        and auth.uid() in (c.requester_id, c.addressee_id)
    )
  );

revoke update, delete on public.messages from anon, authenticated;

-- Realtime ------------------------------------------------------------------

-- Live updates for new messages and connection changes (still filtered by RLS).
alter publication supabase_realtime add table public.messages, public.connections;
