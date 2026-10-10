-- Run once in the Supabase SQL editor for shared, persistent demo copy trading.
create table if not exists public.demo_copy_profiles (
  id uuid primary key,
  display_name text not null check (char_length(display_name) between 2 and 24),
  is_public boolean not null default false,
  current_trade jsonb,
  realized_pnl numeric not null default 0,
  total_trades integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.demo_copy_follows (
  follower_id uuid not null references public.demo_copy_profiles(id) on delete cascade,
  trader_id uuid not null references public.demo_copy_profiles(id) on delete cascade,
  enabled boolean not null default true,
  copy_scale numeric(5,2) not null default 100
    check (copy_scale between 10 and 200),
  created_at timestamptz not null default now(),
  primary key (follower_id, trader_id),
  check (follower_id <> trader_id)
);

create table if not exists public.demo_copy_events (
  id bigint generated always as identity primary key,
  trader_id uuid not null references public.demo_copy_profiles(id) on delete cascade,
  kind text not null check (kind in ('open', 'close')),
  trade jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists demo_copy_events_trader_id_id_idx
  on public.demo_copy_events (trader_id, id);
create index if not exists demo_copy_follows_trader_id_idx
  on public.demo_copy_follows (trader_id, enabled);

alter table public.demo_copy_profiles enable row level security;
alter table public.demo_copy_follows enable row level security;
alter table public.demo_copy_events enable row level security;
grant select, insert, update, delete on public.demo_copy_profiles to service_role;
grant select, insert, update, delete on public.demo_copy_follows to service_role;
grant select, insert, update, delete on public.demo_copy_events to service_role;
grant usage, select on sequence public.demo_copy_events_id_seq to service_role;

create or replace function public.demo_copy_snapshot(
  p_user_id uuid,
  p_after_event_id bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  event_cursor bigint;
begin
  select coalesce(max(id), 0) into event_cursor from public.demo_copy_events;
  return jsonb_build_object(
    'me', (select to_jsonb(p) from public.demo_copy_profiles p where p.id = p_user_id),
    'traders', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.updated_at desc)
      from public.demo_copy_profiles p
      where p.is_public
         or p.id = p_user_id
         or exists (
           select 1 from public.demo_copy_follows f
           where f.follower_id = p_user_id and f.trader_id = p.id
         )
    ), '[]'::jsonb),
    'follows', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.created_at desc)
      from public.demo_copy_follows f where f.follower_id = p_user_id
    ), '[]'::jsonb),
    'events', case when p_after_event_id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'traderId', e.trader_id,
        'kind', e.kind,
        'trade', e.trade,
        'createdAt', e.created_at,
        'displayName', p.display_name
      ) order by e.id)
      from public.demo_copy_events e
      join public.demo_copy_follows f on f.trader_id = e.trader_id
      join public.demo_copy_profiles p on p.id = e.trader_id
      where f.follower_id = p_user_id and e.id > p_after_event_id
    ), '[]'::jsonb) end,
    'cursor', event_cursor
  );
end;
$$;

create or replace function public.demo_copy_apply_event(
  p_actor_id uuid,
  p_kind text,
  p_trade jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.demo_copy_profiles%rowtype;
  created_event public.demo_copy_events%rowtype;
begin
  select * into actor from public.demo_copy_profiles
    where id = p_actor_id for update;
  if not found then raise exception 'Demo trader profile not found'; end if;
  if p_kind = 'open' then
    if not actor.is_public then raise exception 'Enable trade sharing before publishing demo positions'; end if;
    if p_trade->'position' is null or p_trade->>'accountBalance' is null then
      raise exception 'Invalid demo position';
    end if;
    if actor.current_trade->'position'->>'id' = p_trade->'position'->>'id' then
      return jsonb_build_object('id', 0, 'kind', 'open');
    end if;
    if actor.current_trade is not null then
      raise exception 'Close the active demo position before opening another';
    end if;
    update public.demo_copy_profiles
      set current_trade = p_trade, updated_at = now()
      where id = p_actor_id;
  elsif p_kind = 'close' then
    if actor.current_trade->'position'->>'id' is distinct from p_trade->>'positionId' then
      raise exception 'That demo position is no longer active';
    end if;
    update public.demo_copy_profiles
      set current_trade = null,
          realized_pnl = realized_pnl + coalesce((p_trade->>'pnl')::numeric, 0),
          total_trades = total_trades + 1,
          updated_at = now()
      where id = p_actor_id;
  else
    raise exception 'Invalid demo trade event';
  end if;
  insert into public.demo_copy_events (trader_id, kind, trade)
    values (p_actor_id, p_kind, p_trade)
    returning * into created_event;
  return jsonb_build_object(
    'id', created_event.id,
    'traderId', created_event.trader_id,
    'kind', created_event.kind,
    'trade', created_event.trade,
    'createdAt', created_event.created_at
  );
end;
$$;

revoke all on public.demo_copy_profiles from anon, authenticated;
revoke all on public.demo_copy_follows from anon, authenticated;
revoke all on public.demo_copy_events from anon, authenticated;
revoke all on function public.demo_copy_snapshot(uuid, bigint) from public, anon, authenticated;
revoke all on function public.demo_copy_apply_event(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.demo_copy_snapshot(uuid, bigint) to service_role;
grant execute on function public.demo_copy_apply_event(uuid, text, jsonb) to service_role;
