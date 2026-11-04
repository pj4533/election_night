#!/usr/bin/env node
// One-time prebake for the hometown terrain view (Stanford + Pine Plains, Dutchess Co. NY).
// Output: public/geo/hometown.json (+ public/geo/hometown-height.bin). No runtime third-party deps.
// Sources: AWS Terrain Tiles (Terrarium), US Census TIGERweb (county subdivisions), OSM Overpass (roads/water, optional).
// Usage: node scripts/build-hometown.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const OUT = new URL('../public/geo/', import.meta.url);
const BBOX = { w: -74.12, e: -73.30, s: 41.62, n: 42.24 }; // wide: all of northern Dutchess + Taconic hills, so the terrain never visibly ends
const Z = 12, N = 320; // heightmap N x N

// ---------- minimal PNG decoder (8-bit RGB/RGBA, non-interlaced) ----------
function decodePNG(buf) {
  let p = 8, w, h, ct, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; if (data[8] !== 8 || data[12]) throw new Error('unsupported png'); }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : (() => { throw new Error('png colortype ' + ct); })();
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, data: out };
}

const lon2x = (lon) => ((lon + 180) / 360) * 2 ** Z;
const lat2y = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z; };

async function get(url, opts) { const r = await fetch(url, opts); if (!r.ok) throw new Error(r.status + ' ' + url); return r; }

async function terrain() {
  const x0 = Math.floor(lon2x(BBOX.w)), x1 = Math.floor(lon2x(BBOX.e)), y0 = Math.floor(lat2y(BBOX.n)), y1 = Math.floor(lat2y(BBOX.s));
  const tiles = {};
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const buf = Buffer.from(await (await get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`)).arrayBuffer());
    tiles[x + '/' + y] = decodePNG(buf);
    process.stdout.write('.');
  }
  const elev = (fx, fy) => { // fractional global tile coords -> meters (nearest pixel)
    const tx = Math.floor(fx), ty = Math.floor(fy), t = tiles[tx + '/' + ty];
    const px = Math.min(255, Math.floor((fx - tx) * 256)), py = Math.min(255, Math.floor((fy - ty) * 256)), i = (py * 256 + px) * t.bpp;
    return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768;
  };
  const hm = new Int16Array(N * N); let mn = 1e9, mx = -1e9;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const lon = BBOX.w + ((BBOX.e - BBOX.w) * i) / (N - 1), lat = BBOX.n - ((BBOX.n - BBOX.s) * j) / (N - 1);
    // 2x2 box average for smoothing
    let s = 0; for (const [dx, dy] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) s += elev(lon2x(lon) + dx / 256, lat2y(lat) + dy / 256);
    const v = Math.round(s / 4); hm[j * N + i] = v; mn = Math.min(mn, v); mx = Math.max(mx, v);
  }
  console.log(`\nterrain ${N}x${N} elev ${mn}..${mx} m`);
  writeFileSync(new URL('hometown-height.bin', OUT), Buffer.from(hm.buffer));
  return { n: N, min: mn, max: mx, file: 'hometown-height.bin', format: 'int16le-meters-rowmajor-north-first' };
}

const round = (c) => c.map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]);
async function towns() {
  const url = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/22/query?where=' +
    encodeURIComponent("STATE='36' AND COUNTY='027' AND BASENAME IN ('Stanford','Pine Plains')") + '&outFields=BASENAME&outSR=4326&f=geojson&geometryPrecision=5';
  const d = await (await get(url)).json();
  return d.features.map((f) => ({ name: f.properties.BASENAME, rings: (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map((poly) => round(poly[0])) }));
}

async function osm() {
  const q = `[out:json][timeout:60];(
    way["highway"~"^(motorway|trunk|primary|secondary)$"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
    way["natural"="water"]["name"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});
  );out geom;`;
  try {
    const d = await (await get('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'election-night-prebake' } })).json();
    const roads = [], water = [];
    for (const el of d.elements || []) {
      if (!el.geometry) continue;
      const pts = round(el.geometry.map((g) => [g.lon, g.lat]));
      if (el.tags?.highway) roads.push({ name: el.tags.ref || el.tags.name || '', kind: el.tags.highway, pts });
      else water.push({ name: el.tags?.name || '', pts });
    }
    console.log(`osm roads ${roads.length} water ${water.length}`);
    return { roads, water };
  } catch (e) { console.warn('osm skipped', e.message); return { roads: [], water: [] }; }
}

// hamlet-level public landmarks only (no residences / street addresses)
const LANDMARKS = [
  { name: 'STANFORDVILLE', lat: 41.866, lon: -73.705, kind: 'hamlet', town: 'Stanford' },
  { name: 'BANGALL', lat: 41.874, lon: -73.684, kind: 'hamlet', town: 'Stanford' },
  { name: 'PINE PLAINS', lat: 41.980, lon: -73.656, kind: 'hamlet', town: 'Pine Plains' },
  { name: 'STISSING MTN', lat: 41.950, lon: -73.701, kind: 'peak', town: 'Pine Plains' },
];

mkdirSync(OUT, { recursive: true });
const [hm, tw, o] = await Promise.all([terrain(), towns(), osm()]);
const out = { bbox: BBOX, height: hm, towns: tw, landmarks: LANDMARKS, ...o, attribution: 'Elevation: AWS Terrain Tiles (Mapzen/USGS). Boundaries: US Census TIGERweb. Roads/water: © OpenStreetMap contributors.' };
writeFileSync(new URL('hometown.json', OUT), JSON.stringify(out));
console.log('wrote public/geo/hometown.json', JSON.stringify(out).length, 'bytes');
