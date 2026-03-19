/**
 * lynx/website/generate-data.js
 * Reads pick history and model output, generates website/data/picks.json
 * Called by pipeline.js after model runs + after grading.
 *
 * Output: website/data/picks.json
 * {
 *   record: { wins, losses, pushes, units, streak },
 *   today: [ { pick, game, market, edge, confidence, keyFactor, status } ],
 *   history: [ { date, picks: [...], record_on_day: "2-1" } ]
 * }
 */

const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..');
const POSTED_FILE = path.join(BASE, 'reports', 'posted-picks.json');
const RECORD_FILE = path.join(BASE, 'reports', 'record.json');
const PAPER_FILE = path.join(BASE, 'reports', 'paper-picks.json');
const OUT_FILE = path.join(__dirname, 'data', 'picks.json');

function main() {
  const postedPicks = JSON.parse(fs.readFileSync(POSTED_FILE, 'utf8'));
  const record = JSON.parse(fs.readFileSync(RECORD_FILE, 'utf8'));
  const paperPicks = fs.existsSync(PAPER_FILE)
    ? JSON.parse(fs.readFileSync(PAPER_FILE, 'utf8'))
    : [];

  // Use ET (America/New_York) date — NBA games run on ET schedule
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const r = record.allTime;

  // Build streak
  const allGraded = postedPicks
    .flatMap(d => d.picks || [])
    .filter(p => p.result && p.result !== 'PENDING')
    .reverse();
  let streak = 0, streakDir = '';
  for (const p of allGraded) {
    if (!streakDir) streakDir = p.result === 'WIN' ? 'W' : 'L';
    if (p.result === (streakDir === 'W' ? 'WIN' : 'LOSS')) streak++;
    else break;
  }

  // Today's official picks — ONLY from posted-picks (manually approved/posted picks)
  // Do NOT fall back to paper picks — paper picks are model output, not official posted picks
  let todayPicks = [];
  const todayPosted = postedPicks.find(d => d.date === today);
  if (todayPosted) {
    // Deduplicate by pick string
    const seen = new Set();
    todayPicks = todayPosted.picks
      .filter(p => { const key = p.pick + '|' + p.game; if (seen.has(key)) return false; seen.add(key); return true; })
      .map(p => ({
        pick: p.pick,
        game: p.game,
        market: p.market,
        edge: p.edge,
        confidence: p.confidence,
        keyFactor: p.keyFactor || (p.factors ? p.factors[0] : ''),
        odds: p.odds || p.pickOdds || -110,
        result: p.result || 'PENDING',
        actualScore: p.actualScore || null,
      }));
  }
  // todayPicks = [] means no picks posted yet today — website shows placeholder

  // History — all past days with graded picks
  const history = postedPicks
    .filter(d => d.date !== today)
    .map(d => {
      const wins = d.picks.filter(p => p.result === 'WIN').length;
      const losses = d.picks.filter(p => p.result === 'LOSS').length;
      const pushes = d.picks.filter(p => p.result === 'PUSH').length;
      return {
        date: d.date,
        record_on_day: `${wins}-${losses}${pushes ? `-${pushes}p` : ''}`,
        picks: d.picks.map(p => ({
          pick: p.pick,
          game: p.game,
          market: p.market,
          edge: p.edge,
          confidence: p.confidence,
          keyFactor: p.keyFactor || '',
          odds: p.odds || p.pickOdds || -110,
          result: p.result || 'PENDING',
          actualScore: p.actualScore || null,
          units: p.units || 0,
        })),
      };
    })
    .reverse(); // Most recent first

  const output = {
    generatedAt: new Date().toISOString(),
    record: {
      wins: r.wins,
      losses: r.losses,
      pushes: r.pushes || 0,
      units: r.units,
      winPct: r.wins + r.losses > 0
        ? Math.round((r.wins / (r.wins + r.losses)) * 1000) / 10
        : 0,
      streak: streak > 0 ? `${streak}${streakDir}` : '—',
      lastUpdated: record.lastUpdated,
    },
    today: todayPicks,
    history,
  };

  if (!fs.existsSync(path.dirname(OUT_FILE))) {
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(`✅ Generated picks.json`);
  console.log(`   Record: ${r.wins}W-${r.losses}L (${r.units >= 0 ? '+' : ''}${r.units}u | ${output.record.winPct}%)`);
  console.log(`   Today: ${todayPicks.length} picks | History: ${history.length} days`);
  return output;
}

module.exports = { main };
if (require.main === module) main();
