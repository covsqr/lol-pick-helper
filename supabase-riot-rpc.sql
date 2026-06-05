create or replace function public.app_riot_queue_group(p_queue_id integer)
returns text
language sql
immutable
as $$
  select case
    when p_queue_id = 420 then 'solo_ranked'
    when p_queue_id = 440 then 'flex_ranked'
    when p_queue_id in (400, 430, 490) then 'normal'
    else 'other'
  end
$$;

create or replace function public.app_riot_account_id(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  select account_id
    into v_account_id
    from app_sessions
   where token = p_token
   limit 1;

  if v_account_id is null then
    raise exception 'Invalid session';
  end if;

  return v_account_id;
end;
$$;

create or replace function public.app_riot_save_sync(
  p_token text,
  p_account jsonb,
  p_matches jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_matches jsonb := coalesce(p_matches, '[]'::jsonb);
  v_result jsonb;
begin
  v_account_id := public.app_riot_account_id(p_token);

  insert into riot_accounts (
    account_id,
    game_name,
    tag_line,
    platform,
    puuid,
    summoner_id,
    profile_icon_id,
    summoner_level,
    updated_at
  )
  values (
    v_account_id,
    p_account->>'game_name',
    p_account->>'tag_line',
    coalesce(p_account->>'platform', 'kr'),
    p_account->>'puuid',
    p_account->>'summoner_id',
    nullif(p_account->>'profile_icon_id', '')::integer,
    nullif(p_account->>'summoner_level', '')::integer,
    now()
  )
  on conflict (account_id) do update set
    game_name = excluded.game_name,
    tag_line = excluded.tag_line,
    platform = excluded.platform,
    puuid = excluded.puuid,
    summoner_id = excluded.summoner_id,
    profile_icon_id = excluded.profile_icon_id,
    summoner_level = excluded.summoner_level,
    updated_at = now();

  insert into riot_match_summaries (
    account_id,
    match_id,
    queue_id,
    game_creation,
    game_duration,
    game_version,
    lane,
    my_champion_id,
    my_champion_name,
    enemy_champion_id,
    enemy_champion_name,
    win,
    kills,
    deaths,
    assists,
    cs,
    damage_to_champions,
    analyzed_at
  )
  select
    v_account_id,
    match_id,
    queue_id,
    game_creation,
    game_duration,
    game_version,
    lane,
    my_champion_id,
    my_champion_name,
    enemy_champion_id,
    enemy_champion_name,
    win,
    kills,
    deaths,
    assists,
    cs,
    damage_to_champions,
    now()
  from jsonb_to_recordset(v_matches) as x(
    match_id text,
    queue_id integer,
    game_creation bigint,
    game_duration integer,
    game_version text,
    lane text,
    my_champion_id integer,
    my_champion_name text,
    enemy_champion_id integer,
    enemy_champion_name text,
    win boolean,
    kills integer,
    deaths integer,
    assists integer,
    cs integer,
    damage_to_champions integer
  )
  where match_id is not null
  on conflict (account_id, match_id) do update set
    queue_id = excluded.queue_id,
    game_creation = excluded.game_creation,
    game_duration = excluded.game_duration,
    game_version = excluded.game_version,
    lane = excluded.lane,
    my_champion_id = excluded.my_champion_id,
    my_champion_name = excluded.my_champion_name,
    enemy_champion_id = excluded.enemy_champion_id,
    enemy_champion_name = excluded.enemy_champion_name,
    win = excluded.win,
    kills = excluded.kills,
    deaths = excluded.deaths,
    assists = excluded.assists,
    cs = excluded.cs,
    damage_to_champions = excluded.damage_to_champions,
    analyzed_at = now();

  delete from riot_champion_stats where account_id = v_account_id;

  insert into riot_champion_stats (
    account_id,
    queue_group,
    lane,
    champion_id,
    champion_name,
    games,
    wins,
    losses,
    updated_at
  )
  select
    v_account_id,
    public.app_riot_queue_group(queue_id),
    lane,
    my_champion_id,
    max(my_champion_name),
    count(*)::integer,
    count(*) filter (where win)::integer,
    count(*) filter (where not win)::integer,
    now()
  from riot_match_summaries
  where account_id = v_account_id
    and lane is not null
    and public.app_riot_queue_group(queue_id) <> 'other'
  group by public.app_riot_queue_group(queue_id), lane, my_champion_id;

  delete from riot_matchup_stats where account_id = v_account_id;

  insert into riot_matchup_stats (
    account_id,
    queue_group,
    lane,
    my_champion_id,
    my_champion_name,
    enemy_champion_id,
    enemy_champion_name,
    games,
    wins,
    losses,
    updated_at
  )
  select
    v_account_id,
    public.app_riot_queue_group(queue_id),
    lane,
    my_champion_id,
    max(my_champion_name),
    enemy_champion_id,
    max(enemy_champion_name),
    count(*)::integer,
    count(*) filter (where win)::integer,
    count(*) filter (where not win)::integer,
    now()
  from riot_match_summaries
  where account_id = v_account_id
    and lane is not null
    and enemy_champion_id is not null
    and public.app_riot_queue_group(queue_id) <> 'other'
  group by public.app_riot_queue_group(queue_id), lane, my_champion_id, enemy_champion_id;

  select public.app_riot_get_state(p_token) into v_result;
  return v_result;
end;
$$;

create or replace function public.app_riot_get_state(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_result jsonb;
begin
  v_account_id := public.app_riot_account_id(p_token);

  select jsonb_build_object(
    'account', (
      select to_jsonb(ra)
      from riot_accounts ra
      where ra.account_id = v_account_id
    ),
    'champion_stats', coalesce((
      select jsonb_agg(to_jsonb(rcs) - 'account_id' order by rcs.queue_group, rcs.lane, rcs.champion_name)
      from riot_champion_stats rcs
      where rcs.account_id = v_account_id
    ), '[]'::jsonb),
    'matchup_stats', coalesce((
      select jsonb_agg(to_jsonb(rms) - 'account_id' order by rms.queue_group, rms.lane, rms.my_champion_name, rms.enemy_champion_name)
      from riot_matchup_stats rms
      where rms.account_id = v_account_id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

grant execute on function public.app_riot_queue_group(integer) to anon, authenticated;
grant execute on function public.app_riot_account_id(text) to anon, authenticated;
grant execute on function public.app_riot_save_sync(text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.app_riot_get_state(text) to anon, authenticated;
