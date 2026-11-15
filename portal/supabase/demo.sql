-- FairSpec presentation demo: shared demo purchases and seller chats (run once in Supabase → SQL Editor).
-- Everyone who opens the site sees the same demo purchases and chats, so a presentation looks identical
-- on every phone and laptop. Demo only: no real money, no accounts, no personal data.
-- Card numbers are never stored; at most the last 4 digits of the public test card (4242).

create table public.demo_orders (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null check (listing_id ~ '^d[0-9]+_[0-9]+$'),
  title text not null check (char_length(title) between 1 and 120),
  price_usd numeric(10, 2) not null check (price_usd between 1 and 50000),
  seller text not null check (char_length(seller) between 1 and 40),
  city text not null check (char_length(city) between 1 and 60),
  last4 text check (last4 is null or last4 = '4242'),
  delivery text not null check (delivery in ('meet', 'ship')),
  status text not null default 'paid' check (status in ('paid', 'done', 'refunded')),
  created_at timestamptz not null default now()
);
create index demo_orders_created_idx on public.demo_orders (created_at desc);

create table public.demo_messages (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null check (listing_id ~ '^d[0-9]+_[0-9]+$'),
  from_seller boolean not null default false,
  body text not null check (char_length(body) between 1 and 600),
  created_at timestamptz not null default now()
);
create index demo_messages_listing_idx on public.demo_messages (listing_id, created_at);

alter table public.demo_orders enable row level security;
alter table public.demo_messages enable row level security;

create policy "Demo purchases are visible to everyone" on public.demo_orders for select using (true);
create policy "Anyone can make a demo purchase" on public.demo_orders for insert with check (status = 'paid');
create policy "Paid demo purchases can be completed or refunded" on public.demo_orders
  for update using (status = 'paid') with check (status in ('done', 'refunded'));
create policy "Demo chats are visible to everyone" on public.demo_messages for select using (true);
create policy "Anyone can write in a demo chat" on public.demo_messages for insert with check (true);

revoke all on public.demo_orders, public.demo_messages from anon, authenticated;
grant select, insert on public.demo_orders, public.demo_messages to anon, authenticated;
grant update (status) on public.demo_orders to anon, authenticated;

-- anti-spam: at most & 120 new demo rows per minute per table across everyone
create function public.limit_demo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if tg_table_name = 'demo_orders' then
    select count(*) into n from public.demo_orders where created_at > now() - interval '1 minute';
  else
    select count(*) into n from public.demo_messages where created_at > now() - interval '1 minute';
  end if;
  if n >= 120 then raise exception 'demo_busy' using errcode = 'P0001'; end if;
  return new;
end;
$$;
create trigger demo_orders_limit before insert on public.demo_orders for each row execute function public.limit_demo();
create trigger demo_messages_limit before insert on public.demo_messages for each row execute function public.limit_demo();
