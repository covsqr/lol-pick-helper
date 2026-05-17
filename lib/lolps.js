const LANE_IDS = {
  top: 0,
  jungle: 1,
  mid: 2,
  adc: 3,
  support: 4
};

const REGION_KR = 0;
const DEFAULT_TIER = 1;
const BOOTSTRAP_CHAMPION_ID = 893;
const LOLPS_TIMEOUT_MS = 10000;
const LOLPS_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const META_CACHE_TTL_MS = 1000 * 60 * 60;
const cache = new Map();

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[.'`’\s-]/g, '');
}

function parseNumberList(value) {
  if (!value || !value.trim()) return [];
  return value.split(',').map((item) => Number(item.trim())).filter(Number.isFinite);
}

function parseTextList(value) {
  if (!value || !value.trim()) return [];
  return value.split(',').map((item) => item.trim().replace(/^"|"$/g, ''));
}

function getMatch(text, pattern, fallback = null) {
  const match = text.match(pattern);
  return match ? match[1] : fallback;
}

function parseChampionCatalog(html) {
  const champions = new Map();
  const championBlock = getMatch(html, /championNames:\{([\s\S]*?)\},versionInfo:/);
  if (!championBlock) throw new Error('championNames block not found');

  const championPattern =
    /"(\d+)":\{nameKr:"([^"]*)",nameUs:"([^"]*)",nameCn:"([^"]*)"\}/g;
  for (const match of championBlock.matchAll(championPattern)) {
    champions.set(Number(match[1]), {
      id: Number(match[1]),
      nameKr: match[2],
      nameUs: match[3],
      nameCn: match[4]
    });
  }

  const versions = [];
  const versionPattern =
    /\{versionId:(\d+),description:"([^"]+)",patchDate:"([^"]+)",isActive:(true|false)/g;
  for (const match of html.matchAll(versionPattern)) {
    versions.push({
      id: Number(match[1]),
      description: match[2],
      patchDate: match[3],
      isActive: match[4] === 'true'
    });
  }

  const search = {};
  for (const champion of champions.values()) {
    for (const name of [champion.nameKr, champion.nameUs, champion.nameCn]) {
      if (name) search[normalizeName(name)] = champion.id;
    }
    if (champion.nameUs) search[normalizeName(champion.nameUs.replace(/[^a-z0-9]/gi, ''))] = champion.id;
  }

  return {
    champions: [...champions.values()].sort((a, b) => a.nameKr.localeCompare(b.nameKr, 'ko')),
    versions,
    search
  };
}

function parseChampionSummary(html) {
  const summaryStart = html.indexOf('champSummary:[');
  if (summaryStart < 0) throw new Error('champSummary block not found');
  const summaryEnd = html.indexOf('],championArguments:', summaryStart);
  if (summaryEnd < 0) throw new Error('champSummary terminator not found');
  const block = html.slice(summaryStart, summaryEnd);

  if (block.includes('champSummary:[]')) return null;

  const hardIds = parseNumberList(getMatch(block, /counterChampionIdList:\[([^\]]*)\]/, ''));
  const hardWinrates = parseNumberList(getMatch(block, /counterWinrateList:\[([^\]]*)\]/, ''));
  const hardCounts = parseNumberList(getMatch(block, /counterCountList:\[([^\]]*)\]/, ''));
  const easyIds = parseNumberList(getMatch(block, /counterEasyChampionIdList:\[([^\]]*)\]/, ''));
  const easyWinrates = parseNumberList(getMatch(block, /counterEasyWinrateList:\[([^\]]*)\]/, ''));
  const easyCounts = parseNumberList(getMatch(block, /counterEasyCountList:\[([^\]]*)\]/, ''));

  return {
    winRate: Number(getMatch(block, /winRate:"([^"]*)"/, 0)),
    pickRate: Number(getMatch(block, /pickRate:"([^"]*)"/, 0)),
    banRate: Number(getMatch(block, /banRate:"([^"]*)"/, 0)),
    psScore: Number(getMatch(block, /psScore:"([^"]*)"/, 0)),
    ranking: Number(getMatch(block, /ranking:(\d+)/, 0)),
    count: Number(getMatch(block, /count:(\d+)/, 0)),
    psTier: Number(getMatch(block, /psTier:(\d+)/, 0)),
    skillMasterList: parseTextList(getMatch(block, /skillMasterList:\[([^\]]*)\]/, '')),
    hardIds,
    hardWinrates,
    hardCounts,
    easyIds,
    easyWinrates,
    easyCounts
  };
}

function readCache(key, ttlMs) {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.time < ttlMs) return cached.value;
  cache.delete(key);
  return null;
}

function writeCache(key, value) {
  cache.set(key, { time: Date.now(), value });
}

async function fetchText(url, ttlMs = LOLPS_CACHE_TTL_MS) {
  const cachedValue = readCache(url, ttlMs);
  if (cachedValue !== null) return cachedValue;

  const response = await fetchLolps(url, {
    'user-agent': 'Mozilla/5.0 lolps-pick-helper/0.1',
    accept: 'text/html,application/xhtml+xml'
  });
  if (!response.ok) throw new Error(`lol.ps request failed: ${response.status}`);
  const value = await response.text();
  writeCache(url, value);
  return value;
}

async function fetchJson(url, ttlMs = LOLPS_CACHE_TTL_MS) {
  const cachedValue = readCache(url, ttlMs);
  if (cachedValue !== null) return cachedValue;

  const response = await fetchLolps(url, {
    'user-agent': 'Mozilla/5.0 lolps-pick-helper/0.1',
    accept: 'application/json'
  });
  if (!response.ok) throw new Error(`lol.ps request failed: ${response.status}`);
  const value = await response.json();
  writeCache(url, value);
  return value;
}

async function fetchLolps(url, headers) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOLPS_TIMEOUT_MS);

  try {
    return await fetch(url, {
      headers,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('lol.ps request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

let metaCache = null;

async function getMeta() {
  if (metaCache && Date.now() - metaCache.time < META_CACHE_TTL_MS) return metaCache.value;

  const url = `https://lol.ps/champ/${BOOTSTRAP_CHAMPION_ID}?lane=0&region=${REGION_KR}&tier=${DEFAULT_TIER}`;
  const html = await fetchText(url, META_CACHE_TTL_MS);
  const value = parseChampionCatalog(html);
  metaCache = { time: Date.now(), value };
  return value;
}

function championById(meta, id) {
  return meta.champions.find((champion) => champion.id === Number(id)) || null;
}

function resolveChampionId(meta, input) {
  if (/^\d+$/.test(String(input))) return Number(input);
  return meta.search[normalizeName(input)] || null;
}

function laneIdFromParam(value) {
  if (value === undefined || value === null || value === '') return LANE_IDS.top;
  if (/^\d+$/.test(String(value))) return Number(value);
  return LANE_IDS[String(value)] ?? LANE_IDS.top;
}

function enrichCounterList(meta, ids, winrates, counts, pickRates = []) {
  return ids.map((id, index) => ({
    id,
    nameKr: championById(meta, id)?.nameKr || String(id),
    nameUs: championById(meta, id)?.nameUs || String(id),
    winRate: winrates[index] ?? null,
    count: counts[index] ?? null,
    pickRate: pickRates[index] ?? null
  }));
}

function buildVersusLists(meta, data) {
  if (!data?.counterChampionIdList?.length) return null;

  const matchups = enrichCounterList(
    meta,
    data.counterChampionIdList || [],
    data.counterWinrateList || [],
    data.counterCountList || [],
    data.counterPickrateList || []
  );

  return {
    matchups,
    hard: matchups.filter((item) => Number(item.winRate) < 50),
    easy: matchups.filter((item) => Number(item.winRate) > 50).sort((a, b) => b.winRate - a.winRate)
  };
}

async function getChampionData({ champion, lane, region, tier, version }) {
  const meta = await getMeta();
  const championId = resolveChampionId(meta, champion);
  if (!championId) {
    const error = new Error(`Unknown champion: ${champion}`);
    error.status = 404;
    throw error;
  }

  const selectedVersion =
    version && version !== 'latest'
      ? Number(version)
      : meta.versions.find((item) => item.isActive)?.id || meta.versions[0]?.id;
  const laneId = laneIdFromParam(lane);
  const regionId = region === undefined ? REGION_KR : Number(region);
  const tierId = tier === undefined ? DEFAULT_TIER : Number(tier);
  const sourceUrl = `https://lol.ps/champ/${championId}?lane=${laneId}&region=${regionId}&tier=${tierId}&version=${selectedVersion}`;
  const versusUrl = `https://lol.ps/api/champ/${championId}/versus.json?region=${regionId}&version=${selectedVersion}&tier=${tierId}&lane=${laneId}`;
  const html = await fetchText(sourceUrl);
  const summary = parseChampionSummary(html);
  const versus = await fetchJson(versusUrl).then((payload) => buildVersusLists(meta, payload?.data)).catch(() => null);
  const championInfo = championById(meta, championId);

  return {
    champion: championInfo,
    laneId,
    regionId,
    tierId,
    version: meta.versions.find((item) => item.id === selectedVersion) || { id: selectedVersion },
    sourceUrl,
    versusUrl,
    fetchedAt: new Date().toISOString(),
    summary: summary
      ? {
          winRate: summary.winRate,
          pickRate: summary.pickRate,
          banRate: summary.banRate,
          psScore: summary.psScore,
          ranking: summary.ranking,
          count: summary.count,
          psTier: summary.psTier,
          skillMasterList: summary.skillMasterList
        }
      : null,
    hard: versus?.hard || (summary
      ? enrichCounterList(meta, summary.hardIds, summary.hardWinrates, summary.hardCounts)
      : []),
    easy: versus?.easy || (summary
      ? enrichCounterList(meta, summary.easyIds, summary.easyWinrates, summary.easyCounts)
      : []),
    matchups: versus?.matchups || []
  };
}

async function getMatchupData({ enemy, pick, lane, region, tier, version }) {
  const meta = await getMeta();
  const enemyId = resolveChampionId(meta, enemy);
  const pickId = resolveChampionId(meta, pick);
  if (!enemyId) {
    const error = new Error(`Unknown enemy champion: ${enemy}`);
    error.status = 404;
    throw error;
  }
  if (!pickId) {
    const error = new Error(`Unknown pick champion: ${pick}`);
    error.status = 404;
    throw error;
  }

  const selectedVersion =
    version && version !== 'latest'
      ? Number(version)
      : meta.versions.find((item) => item.isActive)?.id || meta.versions[0]?.id;
  const laneId = laneIdFromParam(lane);
  const regionId = region === undefined ? REGION_KR : Number(region);
  const tierId = tier === undefined ? DEFAULT_TIER : Number(tier);
  const statsUrl = `https://lol.ps/api/versus/stats.json?region=${regionId}&version=${selectedVersion}&tier=${tierId}&lane=${laneId}&champion1=${enemyId}&champion2=${pickId}`;
  const payload = await fetchJson(statsUrl);
  const stats = payload?.data || null;

  return {
    enemy: championById(meta, enemyId),
    pick: championById(meta, pickId),
    laneId,
    regionId,
    tierId,
    version: meta.versions.find((item) => item.id === selectedVersion) || { id: selectedVersion },
    sourceUrl: `https://lol.ps/champ/${enemyId}?lane=${laneId}&region=${regionId}&tier=${tierId}&version=${selectedVersion}#section_versus`,
    statsUrl,
    fetchedAt: new Date().toISOString(),
    stats: stats
      ? {
          count: Number(stats.count || 0),
          winRate: Number(stats.winRate || 0),
          enemyWinRate: Number(stats.champ1Winrate || 0),
          pickWinRate: Number(stats.champ2Winrate || 0),
          countEnemyWins: Number(stats.count1win || 0),
          countEnemyLosses: Number(stats.count1lose || 0)
        }
      : null
  };
}

export {
  DEFAULT_TIER,
  LANE_IDS,
  REGION_KR,
  getChampionData,
  getMatchupData,
  getMeta
};
