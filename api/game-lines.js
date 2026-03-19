// api/game-lines.js — Tonight's/Tomorrow's lines with rest + last 10 context
// Returns games with: teams, DK spread/ou, game time, rest days each team, L10 record
const https = require('https');

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch(e) { res({}); } });
    }).on('error', () => res({}));
  });
}

function getDateStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString('sv', { timeZone: 'America/New_York' }).replace(/-/g, '');
}

async function getLastGameDate(teamId) {
  try {
    const data = await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/schedule?season=2025`);
    const completed = (data.events || []).filter(e => e.competitions?.[0]?.status?.type?.completed);
    if (!completed.length) return null;
    const last = completed[completed.length - 1];
    return last.date?.slice(0, 10); // YYYY-MM-DD
  } catch { return null; }
}

async function getLastTen(teamId) {
  try {
    // Fetch record list, find Last Ten Games item
    const list = await get(`https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2025/types/2/teams/${teamId}/record`);
    for (const item of list.items || []) {
      const ref = item['$ref'];
      if (!ref) continue;
      const rec = await get(ref);
      if (rec.name === 'Last Ten Games' || rec.displayName?.includes('Last Ten') || rec.shortDisplayName?.includes('L10')) {
        return rec.summary || null; // e.g. "7-3"
      }
    }
    // Fallback: calculate from schedule
    const data = await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/schedule?season=2025`);
    const completed = (data.events || []).filter(e => e.competitions?.[0]?.status?.type?.completed);
    const last10 = completed.slice(-10);
    let w = 0, l = 0;
    last10.forEach(e => {
      const comp = e.competitions[0];
      const team = comp.competitors.find(c => c.id === String(teamId));
      if (team?.winner) w++; else l++;
    });
    return `${w}-${l}`;
  } catch { return null; }
}

function restDays(lastGameDate) {
  if (!lastGameDate) return null;
  const last = new Date(lastGameDate + 'T00:00:00Z');
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const diff = Math.floor((today - last) / 86400000);
  return diff;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800'); // 30 min CDN cache

  // Try today first, then tomorrow if no upcoming games
  let games = [];
  let dateLabel = '';

  for (let offset = 0; offset <= 2; offset++) {
    const dateStr = getDateStr(offset);
    const sb = await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateStr}&limit=20`);
    const events = sb.events || [];
    const upcoming = events.filter(e => !e.competitions?.[0]?.status?.type?.completed || offset === 0);

    if (upcoming.length > 0 || offset === 0) {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      dateLabel = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

      // Process each game
      for (const event of events) {
        const comp = event.competitions[0];
        const odds = comp.odds?.[0];
        const away = comp.competitors.find(c => c.homeAway === 'away');
        const home = comp.competitors.find(c => c.homeAway === 'home');
        if (!away || !home) continue;

        // Parse game time
        const gameTime = new Date(comp.date).toLocaleTimeString('en-US', {
          timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true
        });

        const status = comp.status?.type;

        games.push({
          id: event.id,
          gameTime,
          status: status?.completed ? 'Final' : status?.state === 'in' ? 'Live' : gameTime,
          completed: status?.completed || false,
          away: {
            id: away.id,
            abbr: away.team?.abbreviation,
            name: away.team?.displayName,
            score: away.score || null,
            record: away.records?.[0]?.summary || null,
          },
          home: {
            id: home.id,
            abbr: home.team?.abbreviation,
            name: home.team?.displayName,
            score: home.score || null,
            record: home.records?.[0]?.summary || null,
          },
          spread: odds?.details || null,          // e.g. "BOS -8.5"
          overUnder: odds?.overUnder ? `${odds.overUnder}` : null,
          awayML: odds?.awayTeamOdds?.moneyLine || null,
          homeML: odds?.homeTeamOdds?.moneyLine || null,
        });
      }
      if (games.length > 0) break;
    }
  }

  // Enrich with rest days + last 10 (parallel fetches per team)
  const enriched = await Promise.all(games.map(async g => {
    const [awayLast, homeLast, awayL10, homeL10] = await Promise.all([
      getLastGameDate(g.away.id),
      getLastGameDate(g.home.id),
      getLastTen(g.away.id),
      getLastTen(g.home.id),
    ]);
    return {
      ...g,
      away: { ...g.away, restDays: restDays(awayLast), l10: awayL10 },
      home: { ...g.home, restDays: restDays(homeLast), l10: homeL10 },
    };
  }));

  res.json({ games: enriched, dateLabel, ts: Date.now() });
};
