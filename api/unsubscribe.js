/**
 * /api/unsubscribe — Remove subscriber from list
 * GET /api/unsubscribe?email=user@email.com&token=HASH
 */
const https = require('https');
const crypto = require('crypto');

function ghRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com', path, method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'LynxAnalytics/1.0',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode }); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = async (req, res) => {
  const email = req.query?.email || '';
  const token = req.query?.token || '';

  if (!email) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send(pageHtml('Error', 'Invalid unsubscribe link.'));
  }

  const GH_TOKEN = process.env.GITHUB_TOKEN;
  const SECRET   = process.env.UNSUBSCRIBE_SECRET || 'lynx-unsub-2026';

  // Verify token (hmac of email)
  const expected = crypto.createHmac('sha256', SECRET).update(email).digest('hex').slice(0, 16);
  if (token && token !== expected) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send(pageHtml('Error', 'Invalid unsubscribe link. Please use the link from your email.'));
  }

  if (GH_TOKEN) {
    try {
      const fileRes = await ghRequest('GET', '/repos/argusagent/lynx-data/contents/subscribers.json', null, GH_TOKEN);
      const { content, sha } = fileRes.body;
      const list = JSON.parse(Buffer.from(content, 'base64').toString('utf8'));
      const filtered = list.filter(s => s.email !== email);

      if (filtered.length < list.length) {
        const newContent = Buffer.from(JSON.stringify(filtered, null, 2)).toString('base64');
        await ghRequest('PUT', '/repos/argusagent/lynx-data/contents/subscribers.json', {
          message: `chore: unsubscribe ${email}`,
          content: newContent,
          sha,
        }, GH_TOKEN);
      }
    } catch (e) {
      console.error('Unsubscribe error:', e.message);
    }
  }

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(pageHtml(
    "You're unsubscribed",
    `${email} has been removed from all Lynx Analytics emails. You can resubscribe anytime at <a href="https://lynxanalysis.com" style="color:#00B4FF">lynxanalysis.com</a>.`
  ));
};

function pageHtml(title, message) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title} — Lynx Analytics</title></head>
<body style="background:#05080F;font-family:Inter,sans-serif;color:#EEF4FF;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="max-width:480px;text-align:center;padding:40px 20px">
  <div style="font-size:24px;font-weight:800;letter-spacing:0.06em;margin-bottom:24px">LYNX <span style="color:#00B4FF">ANALYTICS</span></div>
  <div style="background:#080C16;border:1px solid rgba(0,180,255,0.15);border-radius:12px;padding:32px">
    <div style="font-size:20px;font-weight:700;margin-bottom:12px">${title}</div>
    <div style="font-size:14px;color:#A8BCD0;line-height:1.6">${message}</div>
  </div>
  <div style="margin-top:24px">
    <a href="https://lynxanalysis.com" style="color:#00B4FF;font-size:14px;text-decoration:none">← Back to lynxanalysis.com</a>
  </div>
</div>
</body></html>`;
}
