// api/ncaab-stats.js — NCAAB player stats via ESPN API (college basketball)
// Top leaders: points, rebounds, assists, blocks, steals
const https = require('https');

const NBA_HEADERS = {
  'Referer': 'https://www.nba.com/', 'Origin': 'https://www.nba.com',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json, text/plain, */*',
  'x-nba-stats-origin': 'stats', 'x-nba-stats-token': 'true',
};

const ESPN_NCAAB = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball';

function get(url, headers = {}) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', ...headers } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { res({ status: r.statusCode, data: JSON.parse(d) }); } catch(e) { res({ status: r.statusCode, data: {} }); } });
    }).on('error', () => res({ status: 0, data: {} }));
  });
}

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

async function fetchNCAABLeaders() {
  // ESPN NCAAB leaders endpoint
  const { status, data } = await get(`${ESPN_NCAAB}/leaders?limit=50&season=2025`);
  if (status !== 200 || !data.categories?.length) return null;

  const cats = data.categories;
  const scoring = cats.find(c => c.name === 'pointsPerGame' || c.name === 'scoring') || cats[0];
  if (!scoring?.leaders?.length) return null;

  // Build player map from scoring leaders
  const playerMap = {};
  scoring.leaders.forEach(l => {
    const id = l.athlete?.id;
    if (!id) return;
    playerMap[id] = {
      id,
      rank: Object.keys(playerMap).length + 1,
      name: l.athlete?.displayName || '-',
      team: l.athlete?.teamAbbrev || l.team?.abbreviation || '-',
      school: l.athlete?.teamName || '-',
      pts: parseFloat(l.value || 0).toFixed(1),
      reb: '-', ast: '-', stl: '-', blk: '-', fg: '-', gp: '-',
    };
  });

  // Enrich with other categories
  const catMap = {
    reboundsPerGame: 'reb', assistsPerGame: 'ast',
    stealsPerGame: 'stl', blocksPerGame: 'blk',
    fieldGoalPct: 'fg',
  };
  for (const [catName, field] of Object.entries(catMap)) {
    const cat = cats.find(c => c.name === catName);
    (cat?.leaders || []).forEach(l => {
      const p = playerMap[l.athlete?.id];
      if (p) p[field] = field === 'fg'
        ? (parseFloat(l.value || 0) * 100).toFixed(1)
        : parseFloat(l.value || 0).toFixed(1);
    });
  }

  return Object.values(playerMap).sort((a, b) => parseFloat(b.pts) - parseFloat(a.pts));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=14400'); // 4h CDN

  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL) {
    return res.json({ players: cache, sport: 'ncaab', cached: true, ts: cacheTime });
  }

  try {
    const players = await fetchNCAABLeaders();
    if (!players?.length) throw new Error('No NCAAB leader data');
    cache = players;
    cacheTime = now;
    res.json({ players, sport: 'ncaab', cached: false, ts: now });
  } catch(e) {
    if (cache) return res.json({ players: cache, sport: 'ncaab', cached: true, ts: cacheTime });
    res.status(500).json({ error: e.message, sport: 'ncaab' });
  }
};
