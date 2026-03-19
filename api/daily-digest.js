/**
 * /api/daily-digest — Build and send the daily Lynx Analytics morning email
 *
 * Content:
 *   1. Yesterday's model results + record update
 *   2. Today's game slate with lines
 *   3. Top sports news from yesterday
 *   4. One fun/surprising stat
 *
 * Trigger: GET /api/daily-digest?secret=ADMIN_SECRET
 * Or called internally by send-digest.js
 *
 * ENV VARS:
 *   RESEND_API_KEY  — from resend.com
 *   GITHUB_TOKEN    — for subscriber list + picks data
 *   ADMIN_SECRET    — protects the endpoint
 */

const https = require('https');

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function get(url, headers = {}) {
  return new Promise((resolve) => {
    const u = new URL(url);
    https.get({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'User-Agent': 'LynxAnalytics/1.0', Accept: 'application/json', ...headers },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

function ghGet(path, token) {
  return get(`https://api.github.com${path}`, {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'LynxAnalytics/1.0',
  });
}

function resendPost(payload, apiKey) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode }); } });
    });
    req.on('error', () => resolve({ status: 0 }));
    req.write(body); req.end();
  });
}

// ── Data fetchers ─────────────────────────────────────────────────────────────
async function getYesterdayResults(token) {
  try {
    const file = await ghGet('/repos/argusagent/lynx-data/contents/posted-picks.json', token);
    if (!file?.content) return null;
    const picks = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yDate = yesterday.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const yPicks = picks.filter(p => p.date === yDate);
    if (!yPicks.length) return null;
    const w = yPicks.filter(p => p.result === 'WIN').length;
    const l = yPicks.filter(p => p.result === 'LOSS').length;
    const p = yPicks.filter(p => p.result === 'PUSH').length;
    return { date: yDate, picks: yPicks, w, l, p };
  } catch { return null; }
}

async function getAllTimeRecord(token) {
  try {
    const file = await ghGet('/repos/argusagent/lynx-data/contents/record.json', token);
    if (!file?.content) return null;
    return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  } catch { return null; }
}

async function getTodaySlate() {
  try {
    const today = new Date().toLocaleDateString('sv', { timeZone: 'America/New_York' }).replace(/-/g, '');
    const data = await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${today}&limit=20`);
    const events = data?.events || [];
    return events.map(e => {
      const comp = e.competitions?.[0];
      const home = comp?.competitors?.find(c => c.homeAway === 'home');
      const away = comp?.competitors?.find(c => c.homeAway === 'away');
      const odds = comp?.odds?.[0];
      const gameTime = new Date(e.date).toLocaleTimeString('en-US', {
        timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true
      });
      return {
        game: `${away?.team?.abbreviation} @ ${home?.team?.abbreviation}`,
        awayFull: away?.team?.displayName,
        homeFull: home?.team?.displayName,
        time: gameTime,
        spread: odds?.details || null,
        total: odds?.overUnder ? `O/U ${odds.overUnder}` : null,
      };
    });
  } catch { return []; }
}

async function getSportsNews() {
  try {
    const data = await get('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news?limit=4');
    return (data?.articles || []).slice(0, 4).map(a => ({
      headline: a.headline,
      description: a.description || '',
      link: a.links?.web?.href || 'https://espn.com',
    }));
  } catch { return []; }
}

async function getSubscribers(token) {
  try {
    const file = await ghGet('/repos/argusagent/lynx-data/contents/subscribers.json', token);
    if (!file?.content) return [];
    return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  } catch { return []; }
}

// Fun stat pool — rotates through these; eventually will pull from a live stat feed
const FUN_STATS = [
  { stat: 'Teams on a back-to-back cover the spread at just 44% — the lowest situational ATS rate in the NBA.', tag: 'Model Insight' },
  { stat: 'Home underdogs of +7 or more cover ATS at 52.3% over the last 3 seasons — one of the most reliable spots in the league.', tag: 'Betting Edge' },
  { stat: 'Teams with 2+ days of rest vs a back-to-back opponent cover at 58% ATS — the rest advantage is real.', tag: 'Situational Edge' },
  { stat: 'The "Pythagorean" win total (based on points scored/allowed) predicts future performance better than actual W/L record.', tag: 'Analytics' },
  { stat: 'Closing line value (CLV) is the single best predictor of long-term profitability. Beating closing lines >55% means your model has real edge.', tag: 'Model Insight' },
  { stat: 'Teams in the bottom 5 of defensive rating cover the spread as home favorites at just 41% — offense wins games, defense wins bets.', tag: 'Betting Edge' },
  { stat: 'When sharp money (>$500k) moves a line against public consensus, the sharp side covers at 56.2%.', tag: 'Sharp Money' },
];

// ── Email template ────────────────────────────────────────────────────────────
function buildDigestEmail({ yesterday, record, slate, news, funStat, date }) {
  const displayDate = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long', month: 'long', day: 'numeric',
  });

  // Yesterday results section
  const yesterdaySection = yesterday ? `
    <div style="background:#080C16;border:1px solid rgba(0,180,255,0.15);border-radius:12px;padding:24px;margin-bottom:20px">
      <div style="font-size:11px;color:#00B4FF;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:12px">
        📊 Yesterday's Model Results
      </div>
      <div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap">
        <div style="text-align:center;background:#0C1220;border-radius:8px;padding:12px 20px;min-width:80px">
          <div style="font-size:28px;font-weight:800;color:#22D47A">${yesterday.w}</div>
          <div style="font-size:11px;color:#5A7090;text-transform:uppercase;letter-spacing:0.06em">Wins</div>
        </div>
        <div style="text-align:center;background:#0C1220;border-radius:8px;padding:12px 20px;min-width:80px">
          <div style="font-size:28px;font-weight:800;color:#FF4D6A">${yesterday.l}</div>
          <div style="font-size:11px;color:#5A7090;text-transform:uppercase;letter-spacing:0.06em">Losses</div>
        </div>
        ${yesterday.p ? `<div style="text-align:center;background:#0C1220;border-radius:8px;padding:12px 20px;min-width:80px">
          <div style="font-size:28px;font-weight:800;color:#888">${yesterday.p}</div>
          <div style="font-size:11px;color:#5A7090;text-transform:uppercase;letter-spacing:0.06em">Pushes</div>
        </div>` : ''}
      </div>
      ${yesterday.picks.map(p => {
        const isWin = p.result === 'WIN';
        const isLoss = p.result === 'LOSS';
        const color = isWin ? '#22D47A' : isLoss ? '#FF4D6A' : '#888';
        const icon = isWin ? '✅' : isLoss ? '❌' : '➖';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(0,180,255,0.06)">
          <div style="font-size:13px;color:#EEF4FF">${p.pick}</div>
          <div style="font-size:13px;font-weight:700;color:${color}">${icon} ${p.result}</div>
        </div>`;
      }).join('')}
    </div>` : `
    <div style="background:#080C16;border:1px solid rgba(0,180,255,0.1);border-radius:12px;padding:20px;margin-bottom:20px;text-align:center">
      <div style="color:#5A7090;font-size:14px">No picks posted yesterday — model was selective.</div>
    </div>`;

  // All-time record section
  const atRecord = record?.allTime || record || {};
  const recordSection = atRecord.wins != null ? `
    <div style="background:linear-gradient(135deg,rgba(0,180,255,0.08),rgba(0,180,255,0.02));border:1px solid rgba(0,180,255,0.2);border-radius:12px;padding:20px;margin-bottom:20px">
      <div style="font-size:11px;color:#00B4FF;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:12px">📈 All-Time Record</div>
      <div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap">
        <div>
          <span style="font-size:28px;font-weight:800;color:#EEF4FF">${atRecord.wins}W-${atRecord.losses}L</span>
          <span style="font-size:14px;color:#5A7090;margin-left:8px">${atRecord.pushes ? `${atRecord.pushes}P` : ''}</span>
        </div>
        <div style="border-left:1px solid rgba(0,180,255,0.15);padding-left:24px">
          <div style="font-size:22px;font-weight:800;color:${(atRecord.winPct||0) >= 0.55 ? '#22D47A' : '#EEF4FF'}">${Math.round((atRecord.winPct||0)*100)}%</div>
          <div style="font-size:11px;color:#5A7090;text-transform:uppercase;letter-spacing:0.06em">Win Rate</div>
        </div>
        <div style="border-left:1px solid rgba(0,180,255,0.15);padding-left:24px">
          <div style="font-size:22px;font-weight:800;color:${(atRecord.units||0) >= 0 ? '#22D47A' : '#FF4D6A'}">${atRecord.units >= 0 ? '+' : ''}${(atRecord.units||0).toFixed(2)}u</div>
          <div style="font-size:11px;color:#5A7090;text-transform:uppercase;letter-spacing:0.06em">Units</div>
        </div>
      </div>
    </div>` : '';

  // Today's slate
  const slateSection = slate?.length ? `
    <div style="background:#080C16;border:1px solid rgba(0,180,255,0.15);border-radius:12px;padding:24px;margin-bottom:20px">
      <div style="font-size:11px;color:#00B4FF;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:16px">
        🏀 Tonight's Slate — ${slate.length} Game${slate.length !== 1 ? 's' : ''}
      </div>
      ${slate.map(g => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid rgba(0,180,255,0.06)">
          <div>
            <div style="font-size:14px;font-weight:600;color:#EEF4FF">${g.game}</div>
            <div style="font-size:12px;color:#5A7090;margin-top:2px">${g.time} ET</div>
          </div>
          <div style="text-align:right">
            ${g.spread ? `<div style="font-size:13px;color:#A8BCD0">${g.spread}</div>` : ''}
            ${g.total ? `<div style="font-size:12px;color:#5A7090">${g.total}</div>` : ''}
          </div>
        </div>`).join('')}
      <div style="margin-top:16px;text-align:center">
        <a href="https://lynxanalysis.com" style="background:#00B4FF;color:#000;font-weight:700;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:13px;display:inline-block">
          View Full Analysis →
        </a>
      </div>
    </div>` : '';

  // News section
  const newsSection = news?.length ? `
    <div style="background:#080C16;border:1px solid rgba(0,180,255,0.15);border-radius:12px;padding:24px;margin-bottom:20px">
      <div style="font-size:11px;color:#00B4FF;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:16px">
        📰 Around the League
      </div>
      ${news.map(n => `
        <div style="padding:10px 0;border-bottom:1px solid rgba(0,180,255,0.06)">
          <a href="${n.link}" style="font-size:14px;font-weight:600;color:#EEF4FF;text-decoration:none;display:block;margin-bottom:4px">${n.headline}</a>
          ${n.description ? `<div style="font-size:12px;color:#5A7090;line-height:1.5">${n.description.slice(0, 120)}${n.description.length > 120 ? '...' : ''}</div>` : ''}
        </div>`).join('')}
    </div>` : '';

  // Fun stat
  const funStatSection = funStat ? `
    <div style="background:linear-gradient(135deg,rgba(200,169,110,0.08),rgba(200,169,110,0.02));border:1px solid rgba(200,169,110,0.2);border-radius:12px;padding:20px;margin-bottom:20px">
      <div style="font-size:11px;color:#C8A96E;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px">
        💡 Stat of the Day — ${funStat.tag}
      </div>
      <div style="font-size:15px;color:#EEF4FF;line-height:1.6">${funStat.stat}</div>
    </div>` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#05080F;font-family:Inter,-apple-system,sans-serif;color:#EEF4FF;margin:0;padding:16px">
<div style="max-width:580px;margin:0 auto">

  <!-- Header -->
  <div style="text-align:center;padding:36px 0 28px">
    <div style="font-size:26px;font-weight:800;letter-spacing:0.06em;margin-bottom:4px">
      LYNX <span style="color:#00B4FF">ANALYTICS</span>
    </div>
    <div style="font-size:11px;color:#5A7090;letter-spacing:0.12em;text-transform:uppercase">
      Morning Briefing — ${displayDate}
    </div>
  </div>

  <!-- Content -->
  ${yesterdaySection}
  ${recordSection}
  ${slateSection}
  ${newsSection}
  ${funStatSection}

  <!-- CTA -->
  <div style="background:#080C16;border:1px solid rgba(0,180,255,0.15);border-radius:12px;padding:24px;text-align:center;margin-bottom:20px">
    <div style="font-size:16px;font-weight:700;margin-bottom:8px">Want the full model breakdown?</div>
    <div style="font-size:13px;color:#5A7090;margin-bottom:16px">Today's picks with confidence ratings, edge analysis, and bet sizing posted by 2 PM ET.</div>
    <a href="https://lynxanalysis.com" style="background:#00B4FF;color:#000;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;display:inline-block;margin-right:8px">View the Model →</a>
  </div>

  <!-- Footer -->
  <div style="text-align:center;padding:0 0 28px">
    <div style="font-size:11px;color:#5A7090;line-height:1.8">
      <a href="https://x.com/LynxAnalysis" style="color:#00B4FF;text-decoration:none">@LynxAnalysis</a> · 
      <a href="https://lynxanalysis.com" style="color:#5A7090;text-decoration:none">lynxanalysis.com</a><br>
      For informational and entertainment purposes only. Please gamble responsibly.<br>
      <a href="https://lynxanalysis.com/unsubscribe" style="color:#5A7090">Unsubscribe</a>
    </div>
  </div>

</div>
</body></html>`;
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Auth check
  const secret = req.query?.secret || '';
  const ADMIN_SECRET = process.env.ADMIN_SECRET;
  if (ADMIN_SECRET && secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const GH_TOKEN   = process.env.GITHUB_TOKEN;
  const RESEND_KEY  = process.env.RESEND_API_KEY;
  const dryRun      = req.query?.dry === '1' || !RESEND_KEY;

  // Fetch all content in parallel
  const [yesterday, record, slate, news, subscribers] = await Promise.all([
    getYesterdayResults(GH_TOKEN),
    getAllTimeRecord(GH_TOKEN),
    getTodaySlate(),
    getSportsNews(),
    GH_TOKEN ? getSubscribers(GH_TOKEN) : Promise.resolve([]),
  ]);

  // Pick a fun stat (rotate by day of year)
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const funStat = FUN_STATS[dayOfYear % FUN_STATS.length];

  const emailHtml = buildDigestEmail({ yesterday, record, slate, news, funStat });

  // Dry run — return the HTML without sending
  if (dryRun) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(emailHtml);
  }

  // Send to all subscribers via Resend
  const results = { sent: 0, failed: 0, skipped: 0 };

  for (const sub of subscribers) {
    if (!sub.email) continue;
    const r = await resendPost({
      from: 'Lynx Analytics <picks@lynxanalysis.com>',
      to: sub.email,
      subject: `🏀 Lynx Morning Briefing — ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`,
      html: emailHtml,
    }, RESEND_KEY);

    if (r.status === 200 || r.status === 201) results.sent++;
    else { results.failed++; console.error(`Failed for ${sub.email}:`, r); }

    // Small delay to respect Resend rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return res.status(200).json({
    ok: true,
    ...results,
    subscribers: subscribers.length,
    slate: slate.length,
    hasNews: news.length > 0,
    hasYesterday: !!yesterday,
  });
};
