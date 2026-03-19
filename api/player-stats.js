// api/player-stats.js — Proxy for NBA.com stats API (bypasses CORS)
// Returns top 100 players sorted by PPG with full stat line
const https = require('https');

const NBA_URL = 'https://stats.nba.com/stats/leagueleaders?LeagueID=00&PerMode=PerGame&Scope=S&Season=2024-25&SeasonType=Regular+Season&StatCategory=PTS';
const NBA_HEADERS = {
  'Referer': 'https://www.nba.com/',
  'Origin': 'https://www.nba.com',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
  'Connection': 'keep-alive',
};

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

function fetchNBA() {
  return new Promise((resolve, reject) => {
    https.get(NBA_URL, { headers: NBA_HEADERS }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          const rs = json.resultSet;
          const h = rs.headers;
          const I = f => h.indexOf(f);
          const players = rs.rowSet.slice(0, 100).map(r => ({
            id:   r[I('PLAYER_ID')],
            rank: r[I('RANK')],
            name: r[I('PLAYER')],
            team: r[I('TEAM')],
            gp:   r[I('GP')],
            min:  (+r[I('MIN')]).toFixed(1),
            pts:  (+r[I('PTS')]).toFixed(1),
            reb:  (+r[I('REB')]).toFixed(1),
            ast:  (+r[I('AST')]).toFixed(1),
            stl:  (+r[I('STL')]).toFixed(1),
            blk:  (+r[I('BLK')]).toFixed(1),
            fg:   (r[I('FG_PCT')] * 100).toFixed(1),
            fg3:  (r[I('FG3_PCT')] * 100).toFixed(1),
            ft:   (r[I('FT_PCT')] * 100).toFixed(1),
            tov:  (+r[I('TOV')]).toFixed(1),
            eff:  r[I('EFF')],
          }));
          resolve(players);
        } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=21600'); // 6h CDN cache

  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL) {
    return res.json({ players: cache, cached: true, ts: cacheTime });
  }

  try {
    const players = await fetchNBA();
    cache = players;
    cacheTime = now;
    res.json({ players, cached: false, ts: now });
  } catch(e) {
    if (cache) return res.json({ players: cache, cached: true, ts: cacheTime });
    res.status(500).json({ error: e.message });
  }
};
