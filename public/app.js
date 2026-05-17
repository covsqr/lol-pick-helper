import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const state = {
  meta: null,
  mode: 'blind',
  ddragonVersion: null,
  ddragonByKey: {},
  lastRecommendations: [],
  supabase: null,
  session: null,
  user: null,
  username: null,
  remotePools: {},
  feedbackCounts: {}
};

const SUPABASE_URL = 'https://vwcmdowgzptxdhmhahhz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3Y21kb3dnenB0eGRobWhhaGh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMTY4NDEsImV4cCI6MjA5NDU5Mjg0MX0.BHb3CCg6sZv_K31VFpbiap0PrxkBTyMsrgWsYAtynfg';
const AUTH_EMAIL_DOMAIN = 'lol-pick-helper.app';
const API_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const META_API_CACHE_TTL_MS = 1000 * 60 * 60;

const lanes = [
  { key: 'top', label: '탑' },
  { key: 'jungle', label: '정글' },
  { key: 'mid', label: '미드' },
  { key: 'adc', label: '원딜' },
  { key: 'support', label: '서폿' }
];

const samples = {
  top: ['잭스', '뽀삐', '제이스', '이렐리아', '크산테', '하이머딩거', '말파이트'],
  jungle: ['녹턴', '뽀삐', '리 신']
};

const lolpsTiers = {
  bsgp: { id: 1, label: '브실골플', description: '아이언, 브론즈, 실버, 골드, 플래티넘' },
  emerald: { id: 2, label: '에메랄드+', description: '에메랄드 이상' },
  diamond: { id: 13, label: '다이아+', description: '다이아 이상' },
  master: { id: 3, label: '마스터+', description: '마스터, 그랜드마스터, 챌린저' }
};

const tierToLolps = {
  iron: 'bsgp',
  bronze: 'bsgp',
  silver: 'bsgp',
  gold: 'bsgp',
  platinum: 'bsgp',
  emerald: 'emerald',
  diamond: 'diamond',
  master: 'master',
  grandmaster: 'master',
  challenger: 'master'
};

const els = {
  status: document.querySelector('#status'),
  laneSelect: document.querySelector('#laneSelect'),
  versionSelect: document.querySelector('#versionSelect'),
  ownTierSelect: document.querySelector('#ownTierSelect'),
  lolpsTierSelect: document.querySelector('#lolpsTierSelect'),
  tierSummary: document.querySelector('#tierSummary'),
  poolInput: document.querySelector('#poolInput'),
  poolPreview: document.querySelector('#poolPreview'),
  authLoggedOut: document.querySelector('#authLoggedOut'),
  authLoggedIn: document.querySelector('#authLoggedIn'),
  authMessage: document.querySelector('#authMessage'),
  usernameInput: document.querySelector('#usernameInput'),
  passwordInput: document.querySelector('#passwordInput'),
  loginBtn: document.querySelector('#loginBtn'),
  signupBtn: document.querySelector('#signupBtn'),
  logoutBtn: document.querySelector('#logoutBtn'),
  importLocalBtn: document.querySelector('#importLocalBtn'),
  currentUsername: document.querySelector('#currentUsername'),
  loadPoolBtn: document.querySelector('#loadPoolBtn'),
  savePoolBtn: document.querySelector('#savePoolBtn'),
  clearPoolBtn: document.querySelector('#clearPoolBtn'),
  recommendBtn: document.querySelector('#recommendBtn'),
  enemyInput: document.querySelector('#enemyInput'),
  championList: document.querySelector('#championList'),
  counterControls: document.querySelector('#counterControls'),
  results: document.querySelector('#results')
};

function setStatus(text, kind = '') {
  els.status.textContent = text;
  els.status.className = `status ${kind}`.trim();
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[.'`’\s-]/g, '');
}

function parsePoolText(value) {
  return String(value || '')
    .split(/\n|,|;/)
    .map((item) => item.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

function poolKey(laneKey = els.laneSelect.value) {
  return `lolps.pool.${laneKey}`;
}

function ownTierKey() {
  return 'lolps.ownTier.v1';
}

function feedbackKey() {
  return 'lolps.feedback.v1';
}

function isLoggedIn() {
  return Boolean(state.user);
}

function usernameToEmail(username) {
  return `${username}@${AUTH_EMAIL_DOMAIN}`;
}

function validateCredentials() {
  const username = els.usernameInput.value.trim();
  const password = els.passwordInput.value;

  if (!/^[a-z0-9]+$/.test(username)) {
    throw new Error('아이디는 영어 소문자와 숫자만 사용할 수 있습니다.');
  }
  if (password.length < 10 || password.length > 20) {
    throw new Error('비밀번호는 10~20자로 입력해 주세요.');
  }
  return { username, password };
}

function setAuthMessage(text, kind = '') {
  els.authMessage.textContent = text;
  els.authMessage.className = `helper-text auth-message ${kind}`.trim();
}

function renderAuth() {
  els.authLoggedOut.classList.toggle('hidden', isLoggedIn());
  els.authLoggedIn.classList.toggle('hidden', !isLoggedIn());
  els.currentUsername.textContent = state.username || '-';
}

function apiCacheKey(path) {
  return `lolps.apiCache.${path}`;
}

function apiCacheTtl(path) {
  return path.startsWith('/api/meta') ? META_API_CACHE_TTL_MS : API_CACHE_TTL_MS;
}

function readApiCache(path) {
  try {
    const cached = JSON.parse(localStorage.getItem(apiCacheKey(path)) || 'null');
    if (!cached) return null;
    if (Date.now() - cached.time > apiCacheTtl(path)) {
      localStorage.removeItem(apiCacheKey(path));
      return null;
    }
    return cached.value;
  } catch {
    return null;
  }
}

function writeApiCache(path, value) {
  try {
    localStorage.setItem(apiCacheKey(path), JSON.stringify({ time: Date.now(), value }));
  } catch {
    // Storage can be full or disabled; the app still works without client cache.
  }
}

function readFeedback() {
  try {
    return JSON.parse(localStorage.getItem(feedbackKey()) || '{}');
  } catch {
    return {};
  }
}

function writeFeedback(feedback) {
  localStorage.setItem(feedbackKey(), JSON.stringify(feedback));
}

function personalAdjustment(championId) {
  const source = isLoggedIn() ? state.feedbackCounts : readFeedback();
  const item = source[championId] || { wins: 0, losses: 0 };
  return Math.max(-12, Math.min(12, (item.wins - item.losses) * 2));
}

function activeLolpsTier() {
  const bucket = tierToLolps[els.ownTierSelect.value] || 'bsgp';
  return lolpsTiers[bucket];
}

async function saveUserSettings() {
  if (!isLoggedIn()) return;
  await state.supabase.from('user_settings').upsert({
    user_id: state.user.id,
    default_lane: els.laneSelect.value,
    tier: els.ownTierSelect.value,
    updated_at: new Date().toISOString()
  });
}

function syncTierFilter(persist = true) {
  const tier = activeLolpsTier();
  els.lolpsTierSelect.value = String(tier.id);
  els.tierSummary.textContent = `${tier.label} 데이터`;
  els.tierSummary.title = tier.description;
  if (isLoggedIn()) {
    if (persist) saveUserSettings();
  } else {
    localStorage.setItem(ownTierKey(), els.ownTierSelect.value);
  }
}

async function savePool() {
  if (isLoggedIn()) {
    const champions = parsePoolText(els.poolInput.value);
    const { error } = await state.supabase.from('champion_pools').upsert({
      user_id: state.user.id,
      lane: els.laneSelect.value,
      champions,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,lane' });
    if (error) throw error;
    state.remotePools[els.laneSelect.value] = champions.join('\n');
  } else {
    localStorage.setItem(poolKey(), els.poolInput.value);
  }
  renderPoolPreview();
  setStatus('챔프폭 저장됨', 'ok');
}

function loadPool() {
  els.poolInput.value = isLoggedIn()
    ? state.remotePools[els.laneSelect.value] || ''
    : localStorage.getItem(poolKey()) || '';
  renderPoolPreview();
  setStatus('저장값 불러옴', 'ok');
}

function applySamplePool(sampleKey) {
  els.poolInput.value = samples[sampleKey].join('\n');
  renderPoolPreview();
  setStatus('예시 불러옴');
}

function clearPoolInput() {
  els.poolInput.value = '';
  renderPoolPreview();
  setStatus('입력칸 비움');
}

async function loadAccountData() {
  if (!isLoggedIn()) {
    state.username = null;
    state.remotePools = {};
    state.feedbackCounts = {};
    renderAuth();
    return;
  }

  const fallbackUsername = state.user.email?.split('@')[0] || 'user';
  const profileResult = await state.supabase
    .from('profiles')
    .select('username')
    .eq('id', state.user.id)
    .maybeSingle();

  if (!profileResult.data) {
    await state.supabase.from('profiles').upsert({
      id: state.user.id,
      username: fallbackUsername,
      updated_at: new Date().toISOString()
    });
  }
  state.username = profileResult.data?.username || fallbackUsername;

  const settingsResult = await state.supabase
    .from('user_settings')
    .select('default_lane,tier')
    .eq('user_id', state.user.id)
    .maybeSingle();

  if (settingsResult.data) {
    els.ownTierSelect.value = settingsResult.data.tier || els.ownTierSelect.value;
    els.laneSelect.value = settingsResult.data.default_lane || els.laneSelect.value;
    syncTierFilter(false);
  }

  const poolsResult = await state.supabase
    .from('champion_pools')
    .select('lane,champions')
    .eq('user_id', state.user.id);

  state.remotePools = Object.fromEntries(
    (poolsResult.data || []).map((pool) => [pool.lane, (pool.champions || []).join('\n')])
  );

  const feedbackResult = await state.supabase
    .from('match_feedback')
    .select('champion_id,result')
    .eq('user_id', state.user.id);

  state.feedbackCounts = {};
  for (const item of feedbackResult.data || []) {
    const key = String(item.champion_id);
    state.feedbackCounts[key] ||= { wins: 0, losses: 0 };
    if (item.result === 'win') state.feedbackCounts[key].wins += 1;
    if (item.result === 'loss') state.feedbackCounts[key].losses += 1;
  }

  renderAuth();
  loadPool();
}

async function initAuth() {
  state.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data } = await state.supabase.auth.getSession();
  state.session = data.session;
  state.user = data.session?.user || null;
  await loadAccountData();
  setAuthMessage(isLoggedIn() ? '계정 저장소와 연결되었습니다.' : '로그인하면 챔프폭과 승패 반영이 계정별로 저장됩니다.', isLoggedIn() ? 'ok' : '');

  state.supabase.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    state.user = session?.user || null;
    await loadAccountData();
  });
}

async function signUp() {
  try {
    const { username, password } = validateCredentials();
    const { data, error } = await state.supabase.auth.signUp({
      email: usernameToEmail(username),
      password
    });
    if (error) throw error;
    if (!data.session) throw new Error('이메일 인증이 켜져 있으면 로그인할 수 없습니다. Supabase Email confirmation을 꺼 주세요.');

    const { error: profileError } = await state.supabase.from('profiles').upsert({
      id: data.user.id,
      username,
      updated_at: new Date().toISOString()
    });
    if (profileError) throw profileError;

    setAuthMessage('회원가입 완료. 계정 저장소를 불러왔습니다.', 'ok');
    els.passwordInput.value = '';
    state.session = data.session;
    state.user = data.user;
    await loadAccountData();
  } catch (error) {
    setAuthMessage(error.message, 'bad');
  }
}

async function login() {
  try {
    const { username, password } = validateCredentials();
    const { data, error } = await state.supabase.auth.signInWithPassword({
      email: usernameToEmail(username),
      password
    });
    if (error) throw error;
    els.passwordInput.value = '';
    state.session = data.session;
    state.user = data.user;
    await loadAccountData();
    setAuthMessage('로그인되었습니다.', 'ok');
  } catch (error) {
    setAuthMessage(error.message, 'bad');
  }
}

async function logout() {
  await state.supabase.auth.signOut();
  state.session = null;
  state.user = null;
  await loadAccountData();
  loadPool();
  setAuthMessage('로그아웃되었습니다. 현재는 브라우저 로컬 저장소를 사용합니다.');
}

async function importLocalPools() {
  if (!isLoggedIn()) return;
  try {
    for (const lane of lanes) {
      const stored = localStorage.getItem(poolKey(lane.key));
      const champions = parsePoolText(stored);
      if (!champions.length) continue;
      await state.supabase.from('champion_pools').upsert({
        user_id: state.user.id,
        lane: lane.key,
        champions,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,lane' });
      state.remotePools[lane.key] = champions.join('\n');
    }
    loadPool();
    setAuthMessage('로컬 챔프폭을 계정 저장소로 가져왔습니다.', 'ok');
  } catch (error) {
    setAuthMessage(error.message, 'bad');
  }
}

function championById(id) {
  return state.meta?.champions.find((champion) => champion.id === Number(id));
}

function resolveChampion(name) {
  const id = state.meta?.search[normalizeName(name)];
  return id ? championById(id) : null;
}

function championIcon(champion) {
  if (!champion) return '';
  const ddragon = state.ddragonByKey[String(champion.id)];
  if (!state.ddragonVersion || !ddragon) {
    return `<span class="avatar">${champion.nameKr.slice(0, 1)}</span>`;
  }
  const src = `https://ddragon.leagueoflegends.com/cdn/${state.ddragonVersion}/img/champion/${ddragon.image.full}`;
  return `<span class="avatar"><img src="${src}" alt="" /></span>`;
}

function champChip(champion) {
  if (!champion) return '';
  return `<span class="champ-chip">${championIcon(champion)}${champion.nameKr}</span>`;
}

function renderPoolPreview() {
  const pool = parsePoolText(els.poolInput.value);
  if (!pool.length) {
    els.poolPreview.innerHTML = '<span class="helper-text">아직 입력된 챔피언이 없습니다.</span>';
    return;
  }

  els.poolPreview.innerHTML = pool
    .map((name) => {
      const champion = resolveChampion(name);
      return champion
        ? champChip(champion)
        : `<span class="champ-chip unresolved"><span class="avatar">?</span>${name}</span>`;
    })
    .join('');
}

async function api(path, timeoutMs = 15000) {
  const cached = readApiCache(path);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(path, { signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || '요청에 실패했습니다.');
    writeApiCache(path, body);
    return body;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('lol.ps 응답 시간이 길어 요청을 중단했습니다.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadDdragon() {
  try {
    const versions = await fetch('https://ddragon.leagueoflegends.com/api/versions.json').then((r) => r.json());
    state.ddragonVersion = versions[0];
    const data = await fetch(
      `https://ddragon.leagueoflegends.com/cdn/${state.ddragonVersion}/data/ko_KR/champion.json`
    ).then((r) => r.json());
    state.ddragonByKey = Object.values(data.data).reduce((acc, champion) => {
      acc[champion.key] = champion;
      return acc;
    }, {});
  } catch {
    state.ddragonVersion = null;
    state.ddragonByKey = {};
  }
}

function setupControls() {
  els.laneSelect.innerHTML = lanes
    .map((lane) => `<option value="${lane.key}">${lane.label}</option>`)
    .join('');

  els.versionSelect.innerHTML = state.meta.versions
    .map((version, index) => {
      const suffix = version.isActive && index === 0 ? ' 최신' : '';
      return `<option value="${version.id}">${version.description}${suffix}</option>`;
    })
    .join('');

  els.championList.innerHTML = state.meta.champions
    .map((champion) => `<option value="${champion.nameKr}">${champion.nameUs}</option>`)
    .join('');

  els.ownTierSelect.value = localStorage.getItem(ownTierKey()) || 'silver';
  syncTierFilter();

  document.querySelectorAll('.tabs button').forEach((button) => {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode;
      document.querySelectorAll('.tabs button').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      els.counterControls.classList.toggle('hidden', state.mode !== 'counter');
    });
  });

  document.querySelectorAll('[data-sample]').forEach((button) => {
    button.addEventListener('click', () => {
      applySamplePool(button.dataset.sample);
    });
  });

  els.laneSelect.addEventListener('change', () => {
    loadPool();
    saveUserSettings();
  });
  els.ownTierSelect.addEventListener('change', syncTierFilter);
  els.poolInput.addEventListener('input', renderPoolPreview);
  els.loadPoolBtn.addEventListener('click', loadPool);
  els.savePoolBtn.addEventListener('click', () => {
    savePool().catch((error) => setStatus(error.message, 'bad'));
  });
  els.clearPoolBtn.addEventListener('click', clearPoolInput);
  els.loginBtn.addEventListener('click', login);
  els.signupBtn.addEventListener('click', signUp);
  els.logoutBtn.addEventListener('click', logout);
  els.importLocalBtn.addEventListener('click', importLocalPools);
  els.passwordInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') login();
  });
  els.recommendBtn.addEventListener('click', recommend);
}

function selectedParams() {
  return new URLSearchParams({
    lane: els.laneSelect.value,
    region: '0',
    tier: String(activeLolpsTier().id),
    version: els.versionSelect.value || 'latest'
  });
}

async function fetchChampion(champion) {
  const params = selectedParams();
  params.set('champion', champion);
  return api(`/api/champion?${params.toString()}`);
}

async function fetchMatchup(enemy, pick) {
  const params = selectedParams();
  params.set('enemy', enemy);
  params.set('pick', pick);
  return api(`/api/matchup?${params.toString()}`);
}

function currentPoolChampions() {
  return parsePoolText(els.poolInput.value)
    .map((name) => ({ raw: name, champion: resolveChampion(name) }))
    .filter((item) => item.champion);
}

function scoreTableCounter(enemyData, poolChampion) {
  const matchup = enemyData.matchups?.find((item) => item.id === poolChampion.id);
  const adjust = personalAdjustment(poolChampion.id);
  const enemy = enemyData.champion;

  if (!matchup) {
    return {
      champion: poolChampion,
      category: 'neutral',
      score: 45 + adjust,
      label: '데이터 없음',
      metricItems: [
        { label: '상대 승률', value: '-' },
        { label: '카운터 목록', value: enemyData.matchups?.length ?? 0 },
        { label: '표본', value: '-' }
      ],
      reason: `${enemy.nameKr}의 전체 상성 테이블에서 ${poolChampion.nameKr} 매치업을 찾지 못했습니다.`
    };
  }

  const enemyWinRate = Number(matchup.winRate || 0);
  const delta = 50 - enemyWinRate;
  const sampleBoost = Math.min(10, Math.log10(Number(matchup.count || 0) + 1) * 4);
  const metricItems = [
    { label: '상대 승률', value: formatPercent(enemyWinRate) },
    { label: '상대 픽률', value: formatPercent(enemyData.summary?.pickRate) },
    { label: '표본', value: matchup.count ?? '-' }
  ];

  if (enemyWinRate < 50) {
    return {
      champion: poolChampion,
      category: 'best',
      score: Math.min(100, 70 + delta * 2 + sampleBoost + adjust),
      label: '추천',
      metricItems,
      reason: `${enemy.nameKr}의 전체 상성 테이블에서 ${poolChampion.nameKr} 상대 승률은 ${formatPercent(enemyWinRate)}입니다. lol.ps 기준 상대가 어려워하는 매치업이라 추천합니다.`
    };
  }

  if (enemyWinRate > 50) {
    return {
      champion: poolChampion,
      category: 'avoid',
      score: Math.max(0, 30 - Math.abs(delta) * 2 + adjust),
      label: '피하기',
      metricItems,
      reason: `${enemy.nameKr}의 전체 상성 테이블에서 ${poolChampion.nameKr} 상대 승률은 ${formatPercent(enemyWinRate)}입니다. lol.ps 기준 상대가 편한 매치업이라 피하는 픽으로 표시합니다.`
    };
  }

  return {
    champion: poolChampion,
    category: 'neutral',
    score: 50 + adjust,
    label: '중립',
    metricItems,
    reason: `${enemy.nameKr}의 전체 상성 테이블에서 ${poolChampion.nameKr} 상대 승률이 정확히 50%입니다. 데이터상 명확한 상성 없음으로 표시합니다.`
  };
}

function scorePairCounter(matchup) {
  const stats = matchup.stats;
  const pick = matchup.pick;
  const enemy = matchup.enemy;
  const adjust = personalAdjustment(pick.id);

  if (!stats || !stats.count) {
    return {
      champion: pick,
      category: 'neutral',
      score: 45 + adjust,
      label: '데이터 없음',
      metricItems: [
        { label: '상대 승률', value: '-' },
        { label: '출처', value: '개별' },
        { label: '표본', value: '-' }
      ],
      reason: `${enemy.nameKr} vs ${pick.nameKr}의 선택 라인 매치업 표본을 lol.ps에서 찾지 못했습니다.`
    };
  }

  const enemyWinRate = Number(stats.winRate || 0);
  const delta = 50 - enemyWinRate;
  const sampleBoost = Math.min(10, Math.log10(Number(stats.count || 0) + 1) * 4);
  const metricItems = [
    { label: '상대 승률', value: formatPercent(enemyWinRate) },
    { label: '출처', value: '개별' },
    { label: '표본', value: stats.count }
  ];

  if (enemyWinRate < 50) {
    return {
      champion: pick,
      category: 'best',
      score: Math.min(100, 68 + delta * 2 + sampleBoost + adjust),
      label: '추천',
      metricItems,
      reason: `${enemy.nameKr}의 전체 상성 테이블에는 없지만, lol.ps 개별 매치업 데이터에서 ${pick.nameKr} 상대 승률은 ${formatPercent(enemyWinRate)}입니다. 상대가 어려워하는 보강 데이터라 추천합니다.`
    };
  }

  if (enemyWinRate > 50) {
    return {
      champion: pick,
      category: 'avoid',
      score: Math.max(0, 30 - Math.abs(delta) * 2 + adjust),
      label: '피하기',
      metricItems,
      reason: `${enemy.nameKr}의 전체 상성 테이블에는 없지만, lol.ps 개별 매치업 데이터에서 ${pick.nameKr} 상대 승률은 ${formatPercent(enemyWinRate)}입니다. 상대가 편한 보강 데이터라 피하는 픽으로 표시합니다.`
    };
  }

  return {
    champion: pick,
    category: 'neutral',
    score: 50 + adjust,
    label: '중립',
    metricItems,
    reason: `${enemy.nameKr}의 개별 매치업 데이터에서 ${pick.nameKr} 상대 승률이 50%입니다. 데이터상 명확한 상성 없음으로 표시합니다.`
  };
}

function failedTableCounterResult(poolChampion, enemyName, error) {
  return {
    champion: poolChampion,
    category: 'neutral',
    score: 0,
    label: '확인 실패',
    metricItems: [
      { label: '상대 승률', value: '-' },
      { label: '카운터 목록', value: '-' },
      { label: '표본', value: '-' }
    ],
    reason: `${enemyName}의 전체 상성 테이블을 가져오지 못했습니다. ${error.message || error}`
  };
}

async function recommendCounter() {
  const pool = currentPoolChampions();
  const enemyName = els.enemyInput.value.trim();
  if (!pool.length) throw new Error('현재 라인의 챔피언 풀을 먼저 입력해 주세요.');
  if (!enemyName) throw new Error('상대 챔피언을 입력해 주세요.');

  let enemyData;
  try {
    enemyData = await fetchChampion(enemyName);
  } catch (error) {
    const fallbackCards = pool.map((item) => failedTableCounterResult(item.champion, enemyName, error));
    renderResults(`${enemyName} 상대 후픽 추천`, fallbackCards);
    return;
  }

  const ownResults = pool
    .map((item) => ({ item, tableMatchup: enemyData.matchups?.find((matchup) => matchup.id === item.champion.id) }))
    .map(({ item, tableMatchup }) => (tableMatchup ? scoreTableCounter(enemyData, item.champion) : null));

  const fallbackSettled = await Promise.allSettled(
    pool.map((item, index) =>
      ownResults[index] ? ownResults[index] : fetchMatchup(enemyName, String(item.champion.id))
    )
  );

  const cards = fallbackSettled
    .map((result, index) => {
      if (ownResults[index]) return ownResults[index];
      return result.status === 'fulfilled'
        ? scorePairCounter(result.value)
        : failedTableCounterResult(pool[index].champion, enemyName, result.reason);
    })
    .sort((a, b) => b.score - a.score);

  const enemy = enemyData.champion || resolveChampion(enemyName);
  const title = `${enemy?.nameKr || enemyName} 상대 후픽 추천`;
  renderResults(title, cards, enemyData.sourceUrl);
}

async function withPickRates(ids) {
  const entries = await Promise.all(
    [...new Set(ids)].map(async (id) => {
      try {
        const data = await fetchChampion(String(id));
        return [id, data.summary?.pickRate || 0];
      } catch {
        return [id, 0];
      }
    })
  );
  return Object.fromEntries(entries);
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function counterRisk(data, pickRates = {}) {
  return data.hard.reduce((sum, item) => {
    const pickRate = Number(item.pickRate ?? pickRates[item.id] ?? 0);
    return sum + pickRate;
  }, 0);
}

function blindCategory(risk) {
  if (risk <= 18) return 'best';
  if (risk >= 34) return 'avoid';
  return 'neutral';
}

function blindLabel(risk) {
  if (risk <= 18) return '안전';
  if (risk >= 34) return '위험';
  return '보통';
}

async function recommendBlind() {
  const pool = currentPoolChampions();
  if (!pool.length) throw new Error('현재 라인의 챔피언 풀을 먼저 입력해 주세요.');

  const poolData = await Promise.all(pool.map((item) => fetchChampion(String(item.champion.id))));
  const opponentIds = poolData
    .flatMap((data) => data.hard.filter((item) => item.pickRate == null).map((item) => item.id));
  const pickRates = await withPickRates(opponentIds);

  const cards = poolData
    .map((data) => {
      const risk = counterRisk(data, pickRates);
      const adjust = personalAdjustment(data.champion.id);
      const score = Math.max(0, Math.min(100, 100 - risk + adjust));
      const riskCounters = data.hard
        .map((item) => ({
          ...item,
          pickRate: Number(item.pickRate ?? pickRates[item.id] ?? 0)
        }))
        .sort((a, b) => b.pickRate - a.pickRate);
      const topRiskCounters = riskCounters
        .slice(0, 6)
        .map((item) => `${item.nameKr} ${formatPercent(item.pickRate)}`)
        .join(', ');
      return {
        champion: data.champion,
        category: blindCategory(risk),
        score,
        risk,
        label: blindLabel(risk),
        sourceUrl: data.sourceUrl,
        riskMetrics: {
          risk,
          hardCount: data.hard.length,
          pickRate: data.summary?.pickRate,
          count: data.summary?.count
        },
        reason: `하드 카운터 ${data.hard.length}명의 해당 라인 픽률을 합산한 위험도는 ${formatPercent(risk)}입니다. 위험 기여가 큰 카운터: ${topRiskCounters || '없음'}.`
      };
    })
    .sort((a, b) => a.risk - b.risk || b.score - a.score)
    .map((card, index) => ({
      ...card,
      category: index === 0 ? 'best' : card.category,
      label: index === 0 ? '1순위' : card.label
    }));

  renderResults('선픽 위험도 낮은 순 추천', cards, cards[0]?.sourceUrl);
}

async function recommend() {
  setStatus('계산 중');
  els.recommendBtn.disabled = true;
  els.results.innerHTML = '<div class="empty-state"><span class="empty-icon">...</span><p>lol.ps 데이터를 가져오는 중입니다.</p></div>';

  try {
    if (state.mode === 'counter') {
      await recommendCounter();
    } else {
      await recommendBlind();
    }
    setStatus('완료', 'ok');
  } catch (error) {
    setStatus('오류', 'bad');
    els.results.innerHTML = `<div class="empty-state"><span class="empty-icon">!</span><p>${error.message}</p></div>`;
  } finally {
    els.recommendBtn.disabled = false;
  }
}

function renderResults(title, cards, fallbackSourceUrl) {
  state.lastRecommendations = cards;
  if (!cards.length) {
    els.results.innerHTML = '<div class="empty-state"><span class="empty-icon">0</span><p>추천할 수 있는 챔피언이 없습니다.</p></div>';
    return;
  }

  const sourceUrl = fallbackSourceUrl || cards.find((card) => card.sourceUrl)?.sourceUrl;
  els.results.innerHTML = `
    <div class="card-header">
      <div>
        <span class="kicker">Recommendation</span>
        <h2>${title}</h2>
      </div>
      <div class="result-actions">
        <span class="pill">${activeLolpsTier().label}</span>
        ${sourceUrl ? `<a class="ghost-link" href="${sourceUrl}" target="_blank" rel="noreferrer">lol.ps 원문</a>` : ''}
      </div>
    </div>
    <div class="result-grid">
      ${cards.map((card) => renderCard(card)).join('')}
    </div>
  `;

  document.querySelectorAll('[data-feedback]').forEach((button) => {
    button.addEventListener('click', () => {
      recordFeedback(button.dataset.championId, button.dataset.feedback);
    });
  });
}

function renderCard(card) {
  const champion = card.champion;
  const badgeClass =
    card.category === 'best' || card.category === 'fallback'
      ? 'good'
      : card.category === 'avoid'
        ? 'bad'
        : 'warn';
  const feedbackSource = isLoggedIn() ? state.feedbackCounts : readFeedback();
  const feedback = feedbackSource[champion.id] || { wins: 0, losses: 0 };
  const metrics = card.riskMetrics
    ? `<div class="risk-panel">
        <span>카운터 위험도</span>
        <strong>${formatPercent(card.riskMetrics.risk)}</strong>
        <small>낮을수록 선픽 안정성이 높습니다.</small>
      </div>
      <div class="metric-row compact">
        <div class="metric"><span>카운터</span><strong>${card.riskMetrics.hardCount}</strong></div>
        <div class="metric"><span>픽률</span><strong>${formatPercent(card.riskMetrics.pickRate)}</strong></div>
        <div class="metric"><span>표본</span><strong>${card.riskMetrics.count ?? '-'}</strong></div>
      </div>`
    : card.metricItems
    ? `<div class="metric-row">
        ${card.metricItems
          .map((item) => `<div class="metric"><span>${item.label}</span><strong>${item.value}</strong></div>`)
          .join('')}
      </div>`
    : card.metrics
    ? `<div class="metric-row">
        <div class="metric"><span>승률</span><strong>${card.metrics.winRate ?? '-'}%</strong></div>
        <div class="metric"><span>픽률</span><strong>${card.metrics.pickRate ?? '-'}%</strong></div>
        <div class="metric"><span>표본</span><strong>${card.metrics.count ?? '-'}</strong></div>
      </div>`
    : `<div class="metric-row">
        <div class="metric"><span>점수</span><strong>${Math.round(card.score)}</strong></div>
        <div class="metric"><span>개인 승</span><strong>${feedback.wins || 0}</strong></div>
        <div class="metric"><span>개인 패</span><strong>${feedback.losses || 0}</strong></div>
      </div>`;

  return `
    <article class="result-card ${card.category}">
      <div class="result-title">
        <div class="result-name">${championIcon(champion)}${champion.nameKr}</div>
        <span class="badge ${badgeClass}">${card.label}</span>
      </div>
      ${metrics}
      <p class="reason">${card.reason}</p>
      <div class="feedback-row">
        <button class="button subtle win" data-feedback="win" data-champion-id="${champion.id}">승리 반영</button>
        <button class="button subtle loss" data-feedback="loss" data-champion-id="${champion.id}">패배 반영</button>
      </div>
    </article>
  `;
}

async function recordFeedback(championId, result) {
  if (isLoggedIn()) {
    const { error } = await state.supabase.from('match_feedback').insert({
      user_id: state.user.id,
      lane: els.laneSelect.value,
      champion_id: Number(championId),
      enemy_champion_id: resolveChampion(els.enemyInput.value.trim())?.id || null,
      result
    });
    if (error) {
      setStatus(error.message, 'bad');
      return;
    }
    const item = state.feedbackCounts[championId] || { wins: 0, losses: 0 };
    if (result === 'win') item.wins += 1;
    if (result === 'loss') item.losses += 1;
    state.feedbackCounts[championId] = item;
  } else {
    const feedback = readFeedback();
    const item = feedback[championId] || { wins: 0, losses: 0 };
    if (result === 'win') item.wins += 1;
    if (result === 'loss') item.losses += 1;
    feedback[championId] = item;
    writeFeedback(feedback);
  }
  renderResults(
    document.querySelector('.results h2')?.textContent || '추천 결과',
    state.lastRecommendations,
    document.querySelector('.ghost-link[href*="lol.ps"]')?.href
  );
  setStatus('승패 반영됨', 'ok');
}

async function init() {
  try {
    setStatus('lol.ps 연결 중');
    const [meta] = await Promise.all([api('/api/meta'), loadDdragon()]);
    state.meta = meta;
    setupControls();
    await initAuth();
    loadPool();
    renderPoolPreview();
    setStatus('준비 완료', 'ok');
  } catch (error) {
    setStatus('연결 실패', 'bad');
    els.results.innerHTML = `<div class="empty-state"><span class="empty-icon">!</span><p>${error.message}</p></div>`;
  }
}

init();
