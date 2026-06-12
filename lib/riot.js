const RIOT_API_KEY = process.env.RIOT_API_KEY;

const PLATFORM_REGIONS = {
  kr: 'asia',
  jp1: 'asia',
  na1: 'americas',
  br1: 'americas',
  la1: 'americas',
  la2: 'americas',
  euw1: 'europe',
  eun1: 'europe',
  tr1: 'europe',
  ru: 'europe',
  oc1: 'sea',
  ph2: 'sea',
  sg2: 'sea',
  th2: 'sea',
  tw2: 'sea',
  vn2: 'sea'
};

const POSITION_TO_LANE = {
  TOP: 'top',
  JUNGLE: 'jungle',
  MIDDLE: 'mid',
  BOTTOM: 'adc',
  UTILITY: 'support'
};

function normalizePlatform(value) {
  const platform = String(value || 'kr').trim().toLowerCase();
  return platform === 'kr1' ? 'kr' : platform;
}

function regionalRoute(platform) {
  return PLATFORM_REGIONS[platform] || 'asia';
}

function queueGroup(queueId) {
  if (queueId === 420) return 'solo_ranked';
  if (queueId === 440) return 'flex_ranked';
  if ([400, 430, 490].includes(queueId)) return 'normal';
  return 'other';
}

function normalizeLane(participant) {
  return POSITION_TO_LANE[participant.teamPosition] || POSITION_TO_LANE[participant.individualPosition] || null;
}

async function riotFetch(url) {
  if (!RIOT_API_KEY) {
    throw new Error('RIOT_API_KEY 환경변수가 설정되지 않았습니다.');
  }

  const response = await fetch(url, {
    headers: {
      'X-Riot-Token': RIOT_API_KEY
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.status?.message || `Riot API request failed: ${response.status}`;
    if (/unknown apikey|api key|apikey/i.test(message)) {
      throw new Error('Riot API key가 만료되었거나 올바르지 않습니다. Vercel의 RIOT_API_KEY를 새 RGAPI 키로 교체해 주세요.');
    }
    throw new Error(message);
  }
  return body;
}

function encodePath(value) {
  return encodeURIComponent(String(value || '').trim());
}

async function fetchRiotAccount({ gameName, tagLine, platform }) {
  const route = regionalRoute(platform);
  const account = await riotFetch(
    `https://${route}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodePath(gameName)}/${encodePath(tagLine)}`
  );
  const summoner = await riotFetch(
    `https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${encodePath(account.puuid)}`
  ).catch(() => null);

  return {
    game_name: account.gameName,
    tag_line: account.tagLine,
    platform,
    puuid: account.puuid,
    summoner_id: summoner?.id || null,
    profile_icon_id: summoner?.profileIconId || null,
    summoner_level: summoner?.summonerLevel || null
  };
}

async function fetchMatchIds({ puuid, platform, count }) {
  const route = regionalRoute(platform);
  const safeCount = Math.max(5, Math.min(80, Number(count || 30)));
  return riotFetch(
    `https://${route}.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodePath(puuid)}/ids?start=0&count=${safeCount}`
  );
}

async function fetchMatch(matchId, platform) {
  const route = regionalRoute(platform);
  return riotFetch(`https://${route}.api.riotgames.com/lol/match/v5/matches/${encodePath(matchId)}`);
}

function analyzeMatch(match, puuid) {
  const info = match.info;
  const me = info?.participants?.find((participant) => participant.puuid === puuid);
  if (!me) return null;

  const lane = normalizeLane(me);
  const group = queueGroup(Number(info.queueId));
  if (!lane || group === 'other') return null;

  const enemy = info.participants.find((participant) => {
    return participant.teamId !== me.teamId && normalizeLane(participant) === lane;
  });

  const cs = Number(me.totalMinionsKilled || 0) + Number(me.neutralMinionsKilled || 0);

  return {
    match_id: match.metadata?.matchId,
    queue_id: Number(info.queueId),
    queue_group: group,
    game_creation: Number(info.gameCreation || 0),
    game_duration: Number(info.gameDuration || 0),
    game_version: info.gameVersion || null,
    lane,
    my_champion_id: Number(me.championId),
    my_champion_name: me.championName,
    enemy_champion_id: enemy ? Number(enemy.championId) : null,
    enemy_champion_name: enemy?.championName || null,
    win: Boolean(me.win),
    kills: Number(me.kills || 0),
    deaths: Number(me.deaths || 0),
    assists: Number(me.assists || 0),
    cs,
    damage_to_champions: Number(me.totalDamageDealtToChampions || 0)
  };
}

async function mapLimited(items, limit, mapper) {
  const results = [];
  for (let index = 0; index < items.length; index += limit) {
    const chunk = items.slice(index, index + limit);
    const settled = await Promise.allSettled(chunk.map(mapper));
    results.push(...settled);
  }
  return results;
}

function aggregateStats(matches) {
  const championMap = new Map();
  const matchupMap = new Map();

  for (const match of matches) {
    const championKey = `${match.queue_group}:${match.lane}:${match.my_champion_id}`;
    const champion = championMap.get(championKey) || {
      queue_group: match.queue_group,
      lane: match.lane,
      champion_id: match.my_champion_id,
      champion_name: match.my_champion_name,
      games: 0,
      wins: 0,
      losses: 0
    };
    champion.games += 1;
    champion.wins += match.win ? 1 : 0;
    champion.losses += match.win ? 0 : 1;
    championMap.set(championKey, champion);

    if (!match.enemy_champion_id) continue;
    const matchupKey = `${match.queue_group}:${match.lane}:${match.my_champion_id}:${match.enemy_champion_id}`;
    const matchup = matchupMap.get(matchupKey) || {
      queue_group: match.queue_group,
      lane: match.lane,
      my_champion_id: match.my_champion_id,
      my_champion_name: match.my_champion_name,
      enemy_champion_id: match.enemy_champion_id,
      enemy_champion_name: match.enemy_champion_name,
      games: 0,
      wins: 0,
      losses: 0
    };
    matchup.games += 1;
    matchup.wins += match.win ? 1 : 0;
    matchup.losses += match.win ? 0 : 1;
    matchupMap.set(matchupKey, matchup);
  }

  return {
    champion_stats: [...championMap.values()],
    matchup_stats: [...matchupMap.values()]
  };
}

async function getRiotMatchSeed({ gameName, tagLine, platform = 'kr', count = 30 }) {
  if (!gameName || !tagLine) throw new Error('Riot ID와 태그를 입력해 주세요.');

  const normalizedPlatform = normalizePlatform(platform);
  const account = await fetchRiotAccount({ gameName, tagLine, platform: normalizedPlatform });
  const matchIds = await fetchMatchIds({ puuid: account.puuid, platform: normalizedPlatform, count });

  return {
    account,
    requested: matchIds.length,
    match_ids: matchIds
  };
}

async function analyzeRiotMatchIds({ puuid, platform = 'kr', matchIds = [] }) {
  if (!puuid) throw new Error('PUUID가 필요합니다.');
  if (!Array.isArray(matchIds) || !matchIds.length) throw new Error('분석할 matchId가 없습니다.');

  const normalizedPlatform = normalizePlatform(platform);
  const settled = await mapLimited(matchIds, 5, (matchId) => fetchMatch(matchId, normalizedPlatform));
  const matches = settled
    .filter((result) => result.status === 'fulfilled')
    .map((result) => analyzeMatch(result.value, puuid))
    .filter(Boolean);
  const stats = aggregateStats(matches);

  return {
    requested: matchIds.length,
    analyzed: matches.length,
    matches,
    champion_stats: stats.champion_stats,
    matchup_stats: stats.matchup_stats
  };
}

async function syncRiotAccount({ gameName, tagLine, platform = 'kr', count = 30 }) {
  const seed = await getRiotMatchSeed({ gameName, tagLine, platform, count });
  const analyzed = await analyzeRiotMatchIds({
    puuid: seed.account.puuid,
    platform: seed.account.platform,
    matchIds: seed.match_ids
  });
  return {
    account: seed.account,
    requested: seed.requested,
    analyzed: analyzed.analyzed,
    matches: analyzed.matches,
    champion_stats: analyzed.champion_stats,
    matchup_stats: analyzed.matchup_stats
  };
}

export {
  analyzeRiotMatchIds,
  aggregateStats,
  getRiotMatchSeed,
  queueGroup,
  syncRiotAccount
};
