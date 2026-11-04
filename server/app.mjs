// Election Night app: pollers → store → request handler (SSE + API + static). Used by local server and Vercel function.
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from './store.mjs';
import { createDutchess } from './sources/dutchess.mjs';
import { createNyt } from './sources/nyt.mjs';
import { createKalshi } from './sources/kalshi.mjs';
import { createPolymarket } from './sources/polymarket.mjs';
import { createNytHouse } from './sources/nythouse.mjs';
import { createNews } from './sources/news.mjs';
import * as L from './log.mjs';

const ON_VERCEL = !!process.env.VERCEL;
const store = createStore();
const sources = [createDutchess(store), createNyt(store), createKalshi(store), createPolymarket(store), createNytHouse(store), createNews(store)];
sources.forEach((s) => s.start());
if (process.env.SIM === '1') import('./sim.mjs').then((m) => m.startSim(store)).catch((e) => console.error('sim failed', e));

const PUBLIC = path.resolve('public');
const VENDOR = {
  '/vendor/three/': path.resolve('node_modules/three/'),
  '/vendor/topojson-client/': path.resolve('node_modules/topojson-client/'),
  '/vendor/us-atlas/': path.resolve('node_modules/us-atlas/'),
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const clients = new Set();
store.on((type, data) => {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
});

function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': file.includes('node_modules') ? 'max-age=3600' : 'no-cache' });
    res.end(buf);
  });
}

export function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  // on Vercel, rewrites pass the original path as ?p=
  const p = url.searchParams.get('p') ? '/' + url.searchParams.get('p').replace(/^\//, '') : decodeURIComponent(url.pathname);
  if (p === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    res.write(`event: state\ndata: ${JSON.stringify(store.snapshot())}\n\n`);
    clients.add(res);
    const ka = setInterval(() => res.write(`: ka ${Date.now()}\n\n`), 15_000);
    req.on('close', () => { clients.delete(res); clearInterval(ka); });
    return;
  }
  if (p === '/api/state') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(store.snapshot())); }
  if (p === '/api/health') {
    const snap = store.snapshot();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ clients: clients.size, sources: snap.sources, watch: snap.watch.map((r) => ({ key: r.key, total: r.totalVotes, eevp: r.eevp, updatedAt: r.updatedAt, call: r.callStatus })), spotlight: snap.spotlight.map((r) => r.nytId) }, null, 2));
  }
  if (p === '/api/clientlog' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c.length < 20000 ? c : ''));
    req.on('end', () => { try { L.client(JSON.parse(body)); } catch {} res.writeHead(204); res.end(); });
    return;
  }
  // test hook: inject a fake event to preview alerts (localhost only)
  if (p === '/api/test-event' && !ON_VERCEL) {
    store.pushEvent({ type: url.searchParams.get('type') || 'call', priority: Number(url.searchParams.get('priority') || 4), text: url.searchParams.get('text') || 'TEST ALERT', sub: url.searchParams.get('sub') || 'This is a test', raceKey: url.searchParams.get('race') || 'pineplains', party: url.searchParams.get('party') || 'DEM', test: true });
    res.writeHead(204); return res.end();
  }
  for (const [prefix, dir] of Object.entries(VENDOR)) {
    if (p.startsWith(prefix)) {
      const f = path.join(dir, p.slice(prefix.length));
      if (!f.startsWith(dir)) { res.writeHead(403); return res.end(); }
      return serveFile(res, f);
    }
  }
  const f = path.join(PUBLIC, p === '/' ? 'index.html' : p);
  if (!f.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  serveFile(res, f);
}

process.on('uncaughtException', (e) => L.error({ src: 'process', error: String(e.stack || e) }));
process.on('unhandledRejection', (e) => L.error({ src: 'process', error: String(e?.stack || e) }));
