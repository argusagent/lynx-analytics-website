/**
 * /api/subscribe — Email subscription handler
 *
 * Storage: GitHub private repo (argusagent/lynx-data → subscribers.json)
 * Email:   Resend (when RESEND_API_KEY is set in Vercel env vars)
 *
 * ENV VARS (add to Vercel dashboard):
 *   GITHUB_TOKEN      — GitHub token with repo write access (already have it)
 *   RESEND_API_KEY    — from resend.com (free: 3k emails/month) — optional until domain ready
 *   DISCORD_INVITE_EDGE  — Discord invite for Edge tier
 *   DISCORD_INVITE_SHARP — Discord invite for Sharp tier
 */

const https = require('https');

// ── GitHub storage ────────────────────────────────────────────────────────────
const GH_REPO  = 'argusagent/lynx-data';
const GH_FILE  = 'subscribers.json';
const GH_BASE  = 'https://api.github.com';

function ghRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'LynxAnalytics/1.0',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function readSubscribers(token) {
  const r = await ghRequest('GET', `/repos/${GH_REPO}/contents/${GH_FILE}`, null, token);
  if (r.status !== 200) return { list: [], sha: null };
  const content = Buffer.from(r.body.content, 'base64').toString('utf8');
  return { list: JSON.parse(content), sha: r.body.sha };
}

async function writeSubscribers(list, sha, token, message = 'feat: new subscriber') {
  const content = Buffer.from(JSON.stringify(list, null, 2)).toString('base64');
  return ghRequest('PUT', `/repos/${GH_REPO}/contents/${GH_FILE}`, {
    message, content, sha,
  }, token);
}

// ── Email via Resend ──────────────────────────────────────────────────────────
function sendEmail(payload, apiKey) {
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
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', () => resolve({ status: 0 }));
    req.write(body); req.end();
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, tier = 'free' } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  const GH_TOKEN    = process.env.GITHUB_TOKEN;
  const RESEND_KEY  = process.env.RESEND_API_KEY;
  const discordEdge = process.env.DISCORD_INVITE_EDGE || '';
  const discordSharp= process.env.DISCORD_INVITE_SHARP || '';
  const discordInvite = tier === 'sharp' ? (discordSharp || discordEdge) : discordEdge;

  // ── Store subscriber ────────────────────────────────────────────────────────
  let stored = false;
  let duplicate = false;
  if (GH_TOKEN) {
    try {
      const { list, sha } = await readSubscribers(GH_TOKEN);
      // Check for duplicate
      if (list.find(s => s.email === email)) {
        duplicate = true;
      } else {
        const newEntry = {
          email,
          tier,
          joinedAt: new Date().toISOString(),
          source: req.headers.referer || 'direct',
        };
        list.push(newEntry);
        const writeRes = await writeSubscribers(list, sha, GH_TOKEN, `feat: subscriber ${list.length}`);
        stored = writeRes.status === 200 || writeRes.status === 201;
      }
    } catch (e) {
      console.error('GitHub storage error:', e.message);
    }
  } else {
    // Fallback: log to Vercel function logs (visible in Vercel dashboard)
    console.log(`SUBSCRIBER: ${email} | tier=${tier} | ${new Date().toISOString()}`);
    stored = true; // Optimistic — at least it's in the logs
  }

  // ── Send welcome email ──────────────────────────────────────────────────────
  if (RESEND_KEY && !duplicate) {
    try {
      await sendEmail({
        from: 'Lynx Analytics <picks@lynx-analytics.com>',
        to: email,
        subject: tier !== 'free'
          ? `⚡ You're on the Lynx ${tier === 'sharp' ? 'Sharp' : 'Edge'} waitlist`
          : "You're on the Lynx Analytics list",
        html: buildWelcomeEmail(email, tier, discordInvite),
      }, RESEND_KEY);
    } catch (e) {
      console.error('Resend error:', e.message);
    }
  }

  return res.status(200).json({
    ok: true,
    duplicate,
    stored,
    message: duplicate
      ? "You're already on the list."
      : tier !== 'free'
        ? `⚡ You're on the ${tier === 'sharp' ? 'Sharp' : 'Edge'} waitlist. You'll be first when we launch.`
        : "You're on the list. Follow @LynxAnalysis for daily picks.",
  });
};

// ── Welcome email HTML ────────────────────────────────────────────────────────
function buildWelcomeEmail(email, tier, discordInvite) {
  const isPremium = tier === 'edge' || tier === 'sharp';
  const tierLabel = tier === 'sharp' ? 'Sharp' : tier === 'edge' ? 'Edge' : 'Free';
  const discordSection = discordInvite
    ? `<div style="background:#5865F2;border-radius:10px;padding:20px;text-align:center;margin:24px 0">
        <div style="font-size:20px;margin-bottom:8px">💬 Join the Discord</div>
        <p style="color:rgba(255,255,255,0.8);font-size:14px;margin-bottom:16px">Daily picks in #picks, model breakdowns in #analysis.</p>
        <a href="${discordInvite}" style="background:#fff;color:#5865F2;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none">Join →</a>
      </div>` : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="background:#05080F;font-family:Inter,sans-serif;color:#EEF4FF;margin:0;padding:20px">
<div style="max-width:540px;margin:0 auto">
  <div style="text-align:center;padding:36px 0 28px">
    <div style="font-size:28px;font-weight:800;letter-spacing:0.06em">LYNX <span style="color:#00B4FF">ANALYTICS</span></div>
    <div style="font-size:11px;color:#5A7090;letter-spacing:0.12em;text-transform:uppercase;margin-top:4px">AI-Powered Sports Picks</div>
  </div>
  <div style="background:#080C16;border:1px solid rgba(0,180,255,0.15);border-radius:14px;padding:28px;margin-bottom:20px">
    <div style="font-size:12px;color:#00B4FF;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px">
      ${isPremium ? `⚡ ${tierLabel} Waitlist Confirmed` : '✅ Subscribed'}
    </div>
    <h1 style="font-size:24px;font-weight:800;margin:0 0 14px;line-height:1.2">You're ${isPremium ? 'on the list' : 'in'}, ${email.split('@')[0]}.</h1>
    <p style="color:#A8BCD0;font-size:14px;line-height:1.7;margin:0 0 18px">
      ${isPremium
        ? `When Lynx ${tierLabel} launches, you'll be first — locked in at the founding rate.`
        : `Daily picks posted to <a href="https://x.com/LynxAnalysis" style="color:#00B4FF">@LynxAnalysis</a> around 2 PM ET. Free, always.`
      }
    </p>
    ${discordSection}
    <div style="border-top:1px solid rgba(0,180,255,0.1);padding-top:18px">
      <div style="font-size:11px;color:#5A7090;margin-bottom:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase">What's next</div>
      ${isPremium ? `
        <div style="color:#A8BCD0;font-size:13px;line-height:1.8">
          1. We finalize the payment system<br>
          2. You get a checkout link — founding rate locked<br>
          3. Premium dashboard + Discord unlocked immediately
        </div>` : `
        <div style="color:#A8BCD0;font-size:13px;line-height:1.8">
          → <a href="https://x.com/LynxAnalysis" style="color:#00B4FF">@LynxAnalysis</a> — daily picks (~2 PM ET)<br>
          → <a href="https://lynxanalysis.com" style="color:#00B4FF">lynxanalysis.com</a> — live record &amp; stats
        </div>`}
    </div>
  </div>
  <div style="text-align:center;padding-bottom:28px">
    <a href="https://lynxanalysis.com" style="background:#00B4FF;color:#000;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:13px;display:inline-block;margin-bottom:16px">View the Site →</a>
    <div style="font-size:11px;color:#5A7090;line-height:1.6">Lynx Analytics · For informational and entertainment purposes only.</div>
  </div>
</div></body></html>`;
}


