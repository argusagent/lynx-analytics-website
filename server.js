'use strict';
/**
 * Lynx Analytics — Local dev server + API backend
 * Handles: static file serving, ESPN proxy, OddsPapi proxy, email capture
 *
 * Usage: node server.js
 * Runs on: http://localhost:3456
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3456;
const DATA_DIR = path.join(__dirname, 'data');
const EMAILS_FILE = path.join(DATA_DIR, 'emails.json');
const ASSETS_DIR = path.join(__dirname, 'assets');

// Paths to Lynx workspace data
const WORKSPACE = path.join(__dirname, '..');
const RECORD_FILE = path.join(WORKSPACE, 'reports', 'record.json');
const PICKS_FILE = path.join(WORKSPACE, 'reports', 'posted-picks.json');

// Ensure data dir exists
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(EMAILS_FILE)) fs.writeFileSync(EMAILS_FILE, '[]');

// ── HELPERS ──────────────────────────────────────────────────────────────────

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function proxyFetch(targetUrl, res) {
  const parsed = new URL(targetUrl);
  const mod = parsed.protocol === 'https:' ? require('https') : require('http');
  const options = {
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
    }
  };
  mod.get(options, r => {
    let body = '';
    r.on('data', d => body += d);
    r.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(body);
    });
  }).on('error', e => jsonResponse(res, { error: e.message }, 500));
}

function serveStatic(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  const type = types[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

// ── REQUEST HANDLER ───────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end(); return;
  }

  // ── API ROUTES ──

  // GET /api/scoreboard — proxy ESPN scoreboard
  if (pathname === '/api/scoreboard') {
    proxyFetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard', res);
    return;
  }

  // GET /api/news?sport=nba|ncaab|nfl|all
  if (pathname === '/api/news') {
    const sport = parsed.query.sport || 'nba';
    const endpoints = {
      nba: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news?limit=8',
      ncaab: 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/news?limit=6',
      nfl: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=6',
      mlb: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/news?limit=6',
    };
    proxyFetch(endpoints[sport] || endpoints.nba, res);
    return;
  }

  // GET /api/record — live record from Lynx reports
  if (pathname === '/api/record') {
    const record = readJson(RECORD_FILE, { wins: 0, losses: 0, pushes: 0, units: 0 });
    jsonResponse(res, record);
    return;
  }

  // GET /api/picks — posted picks history
  if (pathname === '/api/picks') {
    const picks = readJson(PICKS_FILE, []);
    jsonResponse(res, picks);
    return;
  }

  // POST /api/subscribe — email capture
  if (pathname === '/api/subscribe' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { email } = JSON.parse(body);
        if (!email || !email.includes('@')) { jsonResponse(res, { error: 'Invalid email' }, 400); return; }
        const emails = readJson(EMAILS_FILE, []);
        if (emails.find(e => e.email === email)) {
          jsonResponse(res, { ok: true, message: "You're already on the list." }); return;
        }
        emails.push({ email, date: new Date().toISOString(), source: 'website' });
        fs.writeFileSync(EMAILS_FILE, JSON.stringify(emails, null, 2));
        console.log(`[subscribe] New email: ${email} | Total: ${emails.length}`);
        jsonResponse(res, { ok: true, message: "You're on the list." });
      } catch { jsonResponse(res, { error: 'Bad request' }, 400); }
    });
    return;
  }

  // GET /api/emails — admin: list collected emails (local only)
  if (pathname === '/api/emails') {
    const emails = readJson(EMAILS_FILE, []);
    jsonResponse(res, { count: emails.length, emails });
    return;
  }

  // ── STATIC FILES ──
  if (pathname === '/' || pathname === '/index.html') {
    serveStatic(path.join(__dirname, 'index.html'), res); return;
  }
  if (pathname.startsWith('/assets/')) {
    serveStatic(path.join(ASSETS_DIR, pathname.replace('/assets/', '')), res); return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n🐾 Lynx Analytics server running at http://localhost:${PORT}`);
  console.log(`   API endpoints: /api/scoreboard  /api/news  /api/record  /api/picks`);
  console.log(`   Email capture: /api/subscribe  (admin: /api/emails)\n`);
});
