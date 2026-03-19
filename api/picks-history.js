// api/picks-history.js — Full pick history from posted-picks.json
// Vercel serverless — returns all graded + pending picks sorted by date desc
const fs = require('fs');
const path = require('path');

const PICKS_FILE = path.join(process.cwd(), 'lynx', 'reports', 'posted-picks.json');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Content-Type', 'application/json');

  try {
    if (!fs.existsSync(PICKS_FILE)) {
      return res.json({ picks: [], byDay: [], total: 0 });
    }

    const posted = JSON.parse(fs.readFileSync(PICKS_FILE, 'utf8'));
    const allPicks = [];

    // Flatten all picks, most recent date first
    const sorted = [...posted].sort((a, b) => b.date.localeCompare(a.date));

    for (const day of sorted) {
      if (!day.picks) continue;
      for (const p of day.picks) {
        allPicks.push({
          date:       day.date,
          game:       p.game || null,
          pick:       p.pick || null,
          line:       p.pickLine || p.marketTotal || null,
          odds:       p.odds || -110,
          result:     p.result || 'PENDING',
          units:      p.units != null ? p.units : (p.result === 'WIN' ? 1 : p.result === 'LOSS' ? -1 : 0),
          stars:      p.confidence || p.stars || null,
          edge:       p.edge || null,
          clv:        p.clv != null ? p.clv : null,
          sport:      p.sport || 'NBA',
          keyFactor:  p.keyFactor || null,
          finalScore: p.finalScore || p.actualScore || null,
          closingLine: p.closingLine || null,
        });
      }
    }

    // Summary stats
    const graded = allPicks.filter(p => p.result === 'WIN' || p.result === 'LOSS');
    const wins   = graded.filter(p => p.result === 'WIN').length;
    const losses = graded.filter(p => p.result === 'LOSS').length;
    const units  = parseFloat((wins * 0.909 - losses * 1.0).toFixed(2));

    res.json({
      picks:       allPicks,
      byDay:       sorted.map(d => ({
        date:    d.date,
        w:       (d.picks || []).filter(p => p.result === 'WIN').length,
        l:       (d.picks || []).filter(p => p.result === 'LOSS').length,
        pending: (d.picks || []).filter(p => !p.result || p.result === 'PENDING').length,
      })),
      summary:     { wins, losses, units, total: graded.length },
      total:       allPicks.length,
      lastUpdated: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message, picks: [], total: 0 });
  }
};
