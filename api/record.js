// api/record.js — Live computed record from posted-picks.json
// Vercel serverless — always returns fresh computed record
const fs = require('fs');
const path = require('path');

const PICKS_FILE = path.join(process.cwd(), 'lynx', 'reports', 'posted-picks.json');
const RECORD_FILE = path.join(process.cwd(), 'lynx', 'reports', 'record.json');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  try {
    let posted = [];
    if (fs.existsSync(PICKS_FILE)) {
      posted = JSON.parse(fs.readFileSync(PICKS_FILE, 'utf8'));
    }

    // Compute record dynamically from all graded picks
    let wins = 0, losses = 0, pushes = 0;
    let units = 0;
    const allPicks = [];
    const byDay = [];

    for (const day of posted) {
      const dayWins   = day.picks.filter(p => p.result === 'WIN').length;
      const dayLosses = day.picks.filter(p => p.result === 'LOSS').length;
      const dayPushes = day.picks.filter(p => p.result === 'PUSH').length;
      const dayPending = day.picks.filter(p => !p.result || p.result === 'PENDING').length;

      wins   += dayWins;
      losses += dayLosses;
      pushes += dayPushes;
      // Standard -110 juice: win = +0.909u, loss = -1.0u
      units  += dayWins * 0.909 - dayLosses * 1.0;

      byDay.push({
        date: day.date,
        w: dayWins, l: dayLosses, p: dayPushes, pending: dayPending,
        units: parseFloat((dayWins * 0.909 - dayLosses).toFixed(2)),
      });

      day.picks.forEach(p => {
        allPicks.push({
          date: day.date,
          pick: p.pick,
          result: p.result || 'PENDING',
          confidence: p.confidence,
          edge: p.edge,
          finalScore: p.finalScore || null,
          sport: p.sport || 'NBA',
          clv: p.clv || null,
        });
      });
    }

    const total = wins + losses;
    const winPct = total > 0 ? Math.round(wins / total * 1000) / 10 : 0;
    units = parseFloat(units.toFixed(2));

    // Current streak
    const graded = allPicks.filter(p => p.result === 'WIN' || p.result === 'LOSS').reverse();
    let streak = 0, streakType = '';
    for (const p of graded) {
      if (!streakType) streakType = p.result === 'WIN' ? 'W' : 'L';
      if ((p.result === 'WIN' && streakType === 'W') || (p.result === 'LOSS' && streakType === 'L')) streak++;
      else break;
    }

    // Today's picks (pending)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const todayEntry = posted.find(d => d.date === today);
    const todayPicks = todayEntry?.picks || [];

    res.json({
      record: { wins, losses, pushes, units, winPct, streak: `${streak}${streakType}` },
      today: { picks: todayPicks, count: todayPicks.length },
      history: byDay.reverse(), // most recent first
      allPicks: allPicks.reverse(),
      lastUpdated: new Date().toISOString(),
    });
  } catch(e) {
    // Fallback to static record.json
    try {
      const r = JSON.parse(fs.readFileSync(RECORD_FILE, 'utf8'));
      res.json({ record: r.allTime, fallback: true, error: e.message });
    } catch {
      res.status(500).json({ error: e.message });
    }
  }
};
