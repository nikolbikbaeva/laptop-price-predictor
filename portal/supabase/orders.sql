-- FairSpec: buying listed laptops (run once in Supabase → SQL Editor, after schema.sql). It never deletes data.
--
-- How a purchase works
--  1. A signed-in buyer presses "Buy" → an order with status 'requested' at the listing's exact price.
--  2. The seller accepts (listing becomes 'sold', other requests are declined) or declines.
--  3. They meet, the buyer checks the laptop and pays the seller. Either side can cancel; a cancelled
--     accepted order puts the listing back on sale.
-- No money passes through FairSpec yet, and no emails are shared: only display names, through RLS.

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  buyer_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  price_usd numeric(10, 2) not null check (price_usd between 10 and 50000),
  status text not null default 'requested' check (status in ('requested', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (buyer_id <> seller_id)
);
create unique index orders_one_open_per_buyer on public.orders (listing_id, buyer_id) where status in ('requested', 'accepted');
create unique index orders_one_accepted on public.orders (listing_id) where status = 'accepted';
create index orders_buyer_idx on public.orders (buyer_id, created_at desc);
create index orders_seller_idx on public.orders (seller_id, created_at desc);
alter table public.orders enable row level security;

create policy "Buyer and seller see their orders" on public.orders
  for select to authenticated using ((select auth.uid()) in (buyer_id, seller_id));

-- Only for an active listing, someone else's, at exactly the listed price and title.
create policy "Buyers request active listings" on public.orders
  for insert to authenticated with check (
    orders.buyer_id = (select auth.uid())
    and orders.status = 'requested'
    and exists (
      select 1 from public.listings l
      where l.id = orders.listing_id
        and l.status = 'active' and l.expires_at > now()
        and l.seller_id = orders.seller_id
        and l.seller_id <> (select auth.uid())
        and l.price_usd = orders.price_usd
        and l.title = orders.title
    )
  );

create policy "Buyer and seller update their orders" on public.orders
  for update to authenticated
  using ((select auth.uid()) in (buyer_id, seller_id))
  with check ((select auth.uid()) in (buyer_id, seller_id));
revoke update on public.orders from authenticated, anon;
grant update (status) on public.orders to authenticated;
revoke all on public.orders from anon;

-- anti-spam: at most 10 purchase requests per buyer per day
create function public.limit_orders() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.orders
      where buyer_id = new.buyer_id and created_at > now() - interval '1 day') >= 10 then
    raise exception 'order_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger orders_limit before insert on public.orders
  for each row execute function public.limit_orders();

-- who may move an order where
create function public.check_order_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if new.status = old.status then return new; end if;
  if old.status = 'requested' and new.status in ('accepted', 'declined') and me = old.seller_id then null;
  elsif old.status = 'requested' and new.status = 'cancelled' and me = old.buyer_id then null;
  elsif old.status = 'accepted' and new.status = 'cancelled' and me in (old.buyer_id, old.seller_id) then null;
  else raise exception 'order_state' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger orders_check before update on public.orders
  for each row execute function public.check_order_change();

-- accepted → listing sold, other requests declined; accepted then cancelled → back on sale
create function public.apply_order_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'accepted' and old.status <> 'accepted' then
    update public.listings set status = 'sold' where id = new.listing_id and status = 'active';
    update public.orders set status = 'declined', updated_at = now()
      where listing_id = new.listing_id and id <> new.id and status = 'requested';
  elsif old.status = 'accepted' and new.status = 'cancelled' then
    update public.listings set status = 'active' where id = new.listing_id and status = 'sold';
  end if;
  return null;
end;
$$;
create trigger orders_apply after update on public.orders
  for each row execute function public.apply_order_change();

-- once a listing is sold it is hidden from the buyer, so let buyer and seller of an order keep talking
create policy "Buyer and seller of an order write to each other" on public.messages
  for insert to authenticated with check (
    messages.sender_id = (select auth.uid())
    and exists (
      select 1 from public.orders o
      where o.listing_id = messages.listing_id
        and ((o.buyer_id = (select auth.uid()) and o.seller_id = messages.recipient_id)
          or (o.seller_id = (select auth.uid()) and o.buyer_id = messages.recipient_id))
    )
  );
