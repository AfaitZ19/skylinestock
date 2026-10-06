// Dev only: serves the stock app and forwards /api/* to the local SkylineApi, so a single URL
// (e.g. a cloudflared tunnel for testing on a phone) works. Open <url>/?api=same
//   node tools/dev-server.js            PORT=5500, API=https://localhost:5001
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 5500);
const API = new URL(process.env.API || 'https://localhost:5001');
const ROOT = path.resolve(__dirname, '..');
// Only page assets and sample photos; the URL may be public, so never serve dotfiles, docs or other text files
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const client = API.protocol === 'http:' ? http : https;
    const upstream = client.request({
      hostname: API.hostname, port: API.port, path: req.url, method: req.method,
      headers: { ...req.headers, host: API.host },
      rejectUnauthorized: false // local dev certificate
    }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    upstream.on('error', e => { res.writeHead(502); res.end('API not reachable: ' + e.message); });
    req.pipe(upstream);
    return;
  }

  let rel;
  try { rel = decodeURIComponent(req.url.split('?')[0]); } catch { rel = ''; }
  const file = path.resolve(ROOT, '.' + (rel === '/' ? '/index.html' : rel));
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type || !file.startsWith(ROOT + path.sep) || path.relative(ROOT, file).split(path.sep).some(p => p.startsWith('.'))) {
    res.writeHead(404); res.end('Not found'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Stock app: http://localhost:${PORT}/?api=same  (API -> ${API.origin})`));
