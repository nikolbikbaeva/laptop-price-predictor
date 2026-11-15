-- FairSpec database schema (Supabase / Postgres)
-- Run once in Supabase → SQL Editor on an empty project. It never deletes data; re-running fails harmlessly on existing tables.
--
-- Security model
--  * Row Level Security on every table: the public key in the website can only do what the policies allow.
--  * Emails live only in auth.users (never exposed). Buyers and sellers talk through the messages table.
--  * Users can only create, change or delete their own rows. Limits stop spam.

-- ───────────── profiles: public display name only ─────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "Profiles are visible to everyone" on public.profiles
  for select using (true);
create policy "Users update their own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- create a profile automatically when someone signs up
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)), 40)
  );
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────── listings: laptops for sale ─────────────
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  spec jsonb not null check (pg_column_size(spec) < 4000),
  price_usd numeric(10, 2) not null check (price_usd between 10 and 50000),
  fair_usd numeric(10, 2) not null check (fair_usd between 10 and 50000),
  region text not null check (region ~ '^[A-Z]{2}$'),
  city text not null check (char_length(city) between 1 and 80),
  note text check (note is null or char_length(note) <= 120),
  status text not null default 'active' check (status in ('active', 'sold', 'removed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
create index listings_active_idx on public.listings (status, created_at desc);
create index listings_seller_idx on public.listings (seller_id);
alter table public.listings enable row level security;

create policy "Active listings are public; sellers see their own" on public.listings
  for select using ((status = 'active' and expires_at > now()) or seller_id = (select auth.uid()));
create policy "Sellers create their own listings" on public.listings
  for insert to authenticated with check (seller_id = (select auth.uid()));
create policy "Sellers update their own listings" on public.listings
  for update to authenticated using (seller_id = (select auth.uid())) with check (seller_id = (select auth.uid()));
create policy "Sellers delete their own listings" on public.listings
  for delete to authenticated using (seller_id = (select auth.uid()));

-- anti-spam: at most 5 active listings per seller
create function public.limit_listings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.listings
      where seller_id = new.seller_id and status = 'active' and expires_at > now()) >= 5 then
    raise exception 'listing_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger listings_limit before insert on public.listings
  for each row execute function public.limit_listings();

-- ───────────── messages: buyer ↔ seller, no emails shared ─────────────
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index messages_recipient_idx on public.messages (recipient_id, created_at desc);
create index messages_sender_idx on public.messages (sender_id, created_at desc);
alter table public.messages enable row level security;

create policy "People read their own conversations" on public.messages
  for select to authenticated using ((select auth.uid()) in (sender_id, recipient_id));

-- You may write to the seller of a listing, or reply to someone who wrote to you about your listing.
create policy "Write to a seller, or reply to a buyer" on public.messages
  for insert to authenticated with check (
    messages.sender_id = (select auth.uid())
    and exists (
      select 1 from public.listings l
      where l.id = messages.listing_id
        and (
          l.seller_id = messages.recipient_id
          or (
            l.seller_id = (select auth.uid())
            and exists (
              select 1 from public.messages m
              where m.listing_id = l.id
                and m.sender_id = messages.recipient_id
                and m.recipient_id = (select auth.uid())
            )
          )
        )
    )
  );

-- recipients may only mark messages as read (no editing of text)
create policy "Recipients mark messages read" on public.messages
  for update to authenticated using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
revoke update on public.messages from authenticated, anon;
grant update (read_at) on public.messages to authenticated;

-- anti-spam: at most 30 messages per hour per sender
create function public.limit_messages() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.messages
      where sender_id = new.sender_id and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'message_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger messages_limit before insert on public.messages
  for each row execute function public.limit_messages();

-- anonymous visitors can read listings and profile names, nothing else
revoke all on public.messages from anon;
revoke insert, update, delete on public.listings, public.profiles from anon;
