/**
 * /api/subscribers — Admin: read subscriber list from GitHub private repo
 * Protected by ADMIN_SECRET env var.
 *
 * Usage: GET /api/subscribers?secret=YOUR_SECRET
 * Returns: { count, subscribers: [...] }
 */
const https = require('https');

function ghGet(path, token) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'api.github.com',
      path,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'LynxAnalytics/1.0',
      },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    }).on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const secret = req.query?.secret || (req.url?.split('secret=')[1] || '').split('&')[0];
  const ADMIN_SECRET = process.env.ADMIN_SECRET;

  if (ADMIN_SECRET && secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const GH_TOKEN = process.env.GITHUB_TOKEN;
  if (!GH_TOKEN) return res.status(503).json({ error: 'Storage not configured' });

  try {
    const file = await ghGet('/repos/argusagent/lynx-data/contents/subscribers.json', GH_TOKEN);
    const list = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));

    const byTier = list.reduce((acc, s) => {
      acc[s.tier] = (acc[s.tier] || 0) + 1;
      return acc;
    }, {});

    return res.status(200).json({
      count: list.length,
      byTier,
      subscribers: list.map(s => ({
        email: s.email,
        tier: s.tier,
        joinedAt: s.joinedAt,
      })),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
