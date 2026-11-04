// Hometown terrain layer: real elevation of the Towns of Stanford + Pine Plains (Dutchess Co. NY) as a synthwave
// contour hologram, with draped town boundaries, roads, water and hamlet labels. Data is prebaked by
// scripts/build-hometown.mjs into public/geo/hometown.json + hometown-height.bin (no runtime third-party fetches).
// Used by pinePlains.js (createPineView({ terrain })) — the race beacon / towers / countdown ring stay at the
// view origin and this layer slides so the active town's hamlet sits under them.
import * as THREE from 'three';
import { COL, TIME, makeLabel, damp } from './holo.js';

const KPU = 0.55;   // km per world unit
const EXAG = 3.0;   // vertical exaggeration
// race key -> town (TIGER BASENAME) + hamlet landmark the stage sits on
export const RACE_TOWN = {
  pineplains: { town: 'Pine Plains', hamlet: 'PINE PLAINS', label: 'PINE PLAINS' },
  'stanford-council': { town: 'Stanford', hamlet: 'STANFORDVILLE', label: 'STANFORD' },
};
const TOWN_COL = { Stanford: COL.cyan, 'Pine Plains': COL.magenta };

export async function loadHometown(base = '/geo/') {
  const [meta, bin] = await Promise.all([
    fetch(base + 'hometown.json').then((r) => { if (!r.ok) throw new Error('hometown.json ' + r.status); return r.json(); }),
    fetch(base + 'hometown-height.bin').then((r) => { if (!r.ok) throw new Error('hometown-height.bin ' + r.status); return r.arrayBuffer(); }),
  ]);
  const hm = new Int16Array(bin);
  if (hm.length !== meta.height.n * meta.height.n || !meta.towns?.length) throw new Error('hometown data malformed');
  return { ...meta, hm };
}

const vert = /* glsl */`
attribute float aElev;
varying vec2 vUv; varying float vE; varying vec3 vW; varying vec3 vN;
void main(){
  vUv = uv; vE = aElev; vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const frag = /* glsl */`
uniform sampler2D uFill; uniform sampler2D uEdge; uniform float uTime; uniform float uFade;
uniform vec3 uColA; uniform vec3 uColB; uniform float uActA; uniform float uActB; uniform vec3 uCenter; uniform float uRad; uniform vec3 uLead;
varying vec2 vUv; varying float vE; varying vec3 vW; varying vec3 vN;
float line(float v, float w){ float f = abs(fract(v - 0.5) - 0.5); float d = fwidth(v); return 1.0 - smoothstep(0.0, d * w, f); }
void main(){
  vec4 m = texture2D(uFill, vUv);
  vec4 ed = texture2D(uEdge, vUv);
  vec3 n = normalize(vN);
  float shade = clamp(dot(n, normalize(vec3(-0.5, 0.9, 0.35))), 0.0, 1.0);
  float slope = 1.0 - n.y;
  vec3 col = vec3(0.025, 0.008, 0.075) * (0.6 + shade * 0.9);
  // town fills
  float pa = 0.5 + 0.5 * sin(uTime * 0.9); // slow, gentle (fast pulse read as flashing)
  col += uColA * m.r * (0.035 + uActA * (0.05 + 0.04 * pa));
  col += uColB * m.g * (0.035 + uActB * (0.05 + 0.04 * pa));
  vec3 tint = mix(vec3(0.55, 0.25, 1.0), mix(uColA, uColB, m.g / max(0.001, m.r + m.g)), clamp(m.r + m.g, 0.0, 1.0));
  // contours: minor 10m, major 50m
  // fade contours where they get denser than a few px (far away) — dense lines shimmered/flickered while orbiting
  float minor = line(vE / 10.0, 1.1) * clamp(1.0 - fwidth(vE / 10.0) * 3.0, 0.0, 1.0);
  float major = line(vE / 50.0, 1.6) * clamp(1.0 - fwidth(vE / 50.0) * 2.0, 0.0, 1.0);
  float scan = smoothstep(0.92, 1.0, sin(vE * 0.06 - uTime * 1.6));
  col += tint * (minor * 0.22 + major * 0.75) * (0.8 + scan * 0.25);
  // slope rim glow (ridges)
  col += vec3(0.5, 0.2, 1.0) * pow(slope, 1.6) * 0.35;
  // water
  col = mix(col, vec3(0.0, 0.55, 0.9) * (0.55 + 0.25 * sin(uTime * 1.5 + vW.x)), m.b * 0.85);
  // roads + town edges (blurred glow in texture)
  col += vec3(1.0, 0.82, 0.35) * ed.b * 0.55;
  col += uColA * ed.r * (0.45 + uActA * (0.8 + 0.5 * pa));
  col += uColB * ed.g * (0.45 + uActB * (0.8 + 0.5 * pa));
  // edge fade into the world
  float d = length(vW.xz - uCenter.xz);
  float a = smoothstep(uRad, uRad * 0.55, d);
  gl_FragColor = vec4(col, a * uFade * 0.94);
}`;

export function createTerrain(data) {
  const { bbox, hm, height } = data;
  const N = height.n;
  const lat0 = (bbox.n + bbox.s) / 2, lon0 = (bbox.w + bbox.e) / 2;
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111.32 / KPU, kz = 110.57 / KPU;
  const W = (bbox.e - bbox.w) * kx, D = (bbox.n - bbox.s) * kz;
  const toXZ = (lon, lat) => [(lon - lon0) * kx, -(lat - lat0) * kz];
  const elevAt = (lon, lat) => { // bilinear, meters
    const fi = Math.max(0, Math.min(N - 1.001, ((lon - bbox.w) / (bbox.e - bbox.w)) * (N - 1)));
    const fj = Math.max(0, Math.min(N - 1.001, ((bbox.n - lat) / (bbox.n - bbox.s)) * (N - 1)));
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
    const h = (a, b) => hm[b * N + a];
    return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
  };
  const yOf = (e) => ((e - height.min) / 1000 / KPU) * EXAG;
  const heightAt = (lon, lat) => yOf(elevAt(lon, lat));

  const group = new THREE.Group();
  const slide = new THREE.Group(); group.add(slide); // offset so the active hamlet is at the origin

  // ---------- mesh ----------
  const geo = new THREE.PlaneGeometry(W, D, N - 1, N - 1).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, elev = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) { elev[k] = hm[k]; pos.setY(k, yOf(hm[k])); }
  geo.setAttribute('aElev', new THREE.BufferAttribute(elev, 1));
  geo.computeVertexNormals();

  // ---------- mask textures (fills/water + glow edges/roads) ----------
  const px = (lon, lat, S) => [((lon - bbox.w) / (bbox.e - bbox.w)) * S, ((bbox.n - lat) / (bbox.n - bbox.s)) * S];
  const fillC = document.createElement('canvas'); fillC.width = fillC.height = 1024;
  const fc = fillC.getContext('2d'); fc.fillStyle = '#000'; fc.fillRect(0, 0, 1024, 1024);
  fc.globalCompositeOperation = 'lighter';
  const pathRing = (ctx, ring, S) => { ctx.beginPath(); ring.forEach(([lo, la], i) => { const [x, y] = px(lo, la, S); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); };
  for (const t of data.towns) { fc.fillStyle = t.name === 'Stanford' ? '#ff0000' : '#00ff00'; for (const r of t.rings) { pathRing(fc, r, 1024); fc.fill(); } }
  fc.fillStyle = '#0000ff'; for (const w of data.water || []) { pathRing(fc, w.pts, 1024); fc.fill(); }
  const edgeC = document.createElement('canvas'); edgeC.width = edgeC.height = 2048;
  const ec = edgeC.getContext('2d'); ec.fillStyle = '#000'; ec.fillRect(0, 0, 2048, 2048);
  ec.globalCompositeOperation = 'lighter'; ec.lineJoin = 'round'; ec.lineCap = 'round';
  ec.strokeStyle = '#0000ff';
  for (const r of data.roads || []) {
    ec.lineWidth = r.kind === 'trunk' || r.kind === 'motorway' ? 4 : r.kind === 'primary' ? 3 : 2;
    ec.beginPath(); r.pts.forEach(([lo, la], i) => { const [x, y] = px(lo, la, 2048); i ? ec.lineTo(x, y) : ec.moveTo(x, y); }); ec.stroke();
  }
  for (const t of data.towns) {
    const c = t.name === 'Stanford' ? '255,0,0' : '0,255,0';
    for (const [lw, a] of [[22, 0.18], [10, 0.35], [4, 1]]) { ec.lineWidth = lw; ec.strokeStyle = `rgba(${c},${a})`; for (const r of t.rings) { pathRing(ec, r, 2048); ec.stroke(); } }
  }
  const tex = (c) => { const t = new THREE.CanvasTexture(c); t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace; return t; };

  const U = {
    uFill: { value: tex(fillC) }, uEdge: { value: tex(edgeC) }, uTime: TIME, uFade: { value: 0 },
    uColA: { value: TOWN_COL.Stanford.clone() }, uColB: { value: TOWN_COL['Pine Plains'].clone() },
    uActA: { value: 0 }, uActB: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uRad: { value: 0.47 * Math.min(W, D) }, uLead: { value: COL.magenta.clone() },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: true });
  const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = -1; slide.add(mesh);

  // ---------- crisp draped town boundary lines ----------
  const borders = [];
  for (const t of data.towns) {
    const pts = [];
    for (const ring of t.rings) for (let i = 0; i < ring.length - 1; i++) {
      const [a, b] = [ring[i], ring[i + 1]];
      const [ax, az] = toXZ(...a), [bx, bz] = toXZ(...b);
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25));
      for (let s = 0; s < steps; s++) {
        const f0 = s / steps, f1 = (s + 1) / steps;
        const p0 = [a[0] + (b[0] - a[0]) * f0, a[1] + (b[1] - a[1]) * f0], p1 = [a[0] + (b[0] - a[0]) * f1, a[1] + (b[1] - a[1]) * f1];
        for (const p of [p0, p1]) { const [x, z] = toXZ(...p); pts.push(x, heightAt(...p) + 0.06, z); }
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const col = (TOWN_COL[t.name] || COL.cyan).clone();
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col.clone().multiplyScalar(2), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    l.userData = { town: t.name, col }; l.renderOrder = 5; slide.add(l); borders.push(l);
  }

  // ---------- labels ----------
  const centroid = (ring) => { let x = 0, y = 0; for (const p of ring) { x += p[0]; y += p[1]; } return [x / ring.length, y / ring.length]; };
  const townLabels = [];
  for (const t of data.towns) {
    const [lo, la] = centroid(t.rings[0]);
    const hex = t.name === 'Stanford' ? '#00f0ff' : '#ff2bd6';
    const lbl = makeLabel(t.name.toUpperCase(), { height: 2.0, font: '900 150px Orbitron', glow: hex, color: '#ffffff', sub: 'TOWN OF', subColor: hex, bright: 0.85 });
    const [x, z] = toXZ(lo, la);
    // Stanford label sits toward its southern half (towers occupy the hamlet), Pine Plains to its north
    lbl.sprite.position.set(x + (t.name === 'Stanford' ? -10 : 8), heightAt(lo, la) + 2.4, z + (t.name === 'Stanford' ? -2 : -1));
    lbl.sprite.material.depthTest = true;
    lbl.town = t.name; lbl.sprite.renderOrder = 40; slide.add(lbl.sprite); townLabels.push(lbl);
  }
  const hamlets = {};
  const lmLabels = [];
  const pinMat = new THREE.LineBasicMaterial({ color: COL.yellow.clone().multiplyScalar(1.6), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const lm of data.landmarks || []) {
    const [x, z] = toXZ(lm.lon, lm.lat), y = heightAt(lm.lon, lm.lat);
    hamlets[lm.name] = new THREE.Vector3(x, y, z);
    const top = y + (lm.kind === 'peak' ? 2.2 : 1.6);
    const pg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, y, z), new THREE.Vector3(x, top - 0.25, z)]);
    const pin = new THREE.Line(pg, pinMat); slide.add(pin);
    const lbl = makeLabel((lm.kind === 'peak' ? '▲ ' : '◆ ') + lm.name, { height: 0.75, font: '700 110px Orbitron', glow: '#ffd23f', color: '#fff6d0', bright: 0.8, w: 1024, h: 180 });
    lbl.sprite.position.set(x, top, z); lbl.sprite.material.depthTest = true; lbl.pin = pin; lbl.name = lm.name; lbl.town = lm.town; lbl.kind = lm.kind;
    slide.add(lbl.sprite); lmLabels.push(lbl);
  }
  // road shields for major routes (one label per ref, placed mid-route)
  const seen = new Set();
  for (const r of data.roads || []) {
    const ref = (r.name || '').split(';')[0];
    if (!/^(Taconic State Parkway|NY 82|NY 199|US 44)$/.test(ref) || seen.has(ref) || r.pts.length < 6) continue;
    seen.add(ref);
    const p = r.pts[Math.floor(r.pts.length / 2)];
    const [x, z] = toXZ(...p);
    const lbl = makeLabel(ref === 'Taconic State Parkway' ? 'TACONIC PKWY' : ref, { height: 0.5, font: '700 100px "Share Tech Mono"', glow: '#ffab2e', color: '#ffe2b0', bright: 0.7, w: 768, h: 160 });
    lbl.sprite.position.set(x, heightAt(...p) + 0.5, z); lbl.sprite.material.depthTest = true; lbl.name = ref;
    slide.add(lbl.sprite); lmLabels.push(lbl);
  }

  let activeTown = null, activeHamlet = null;

  // ---------- per-election-district tower pairs (flank the main stage; ED polygons not public for current lines) ----------
  const edGroup = new THREE.Group(); group.add(edGroup);
  const edSlots = [];
  const ED_X = [-9, 9, -12.5, 12.5], ED_Z = [3.5, 3.5, -1, -1], ED_MAX = 6;
  const isWI = (c) => /write.?in|scatter|void|blank/i.test(c?.name || '');
  const lastName = (n) => { const w = String(n || '').trim().split(/\s+/); return (w[w.length - 1] || '').toUpperCase(); };
  function edSlot(i) {
    const g = new THREE.Group(); g.position.set(ED_X[i], 0.6, ED_Z[i]); edGroup.add(g);
    const bars = [COL.DEM, COL.GOP].map((c, k) => {
      const geo = new THREE.BoxGeometry(0.9, 1, 0.9).translate(0, 0.5, 0);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.3), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: c.clone().multiplyScalar(2.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
      m.position.x = k ? 0.6 : -0.6; m.scale.y = 0.05; g.add(m); return { m, cur: 0.05, target: 0.05, col: c };
    });
    const pad = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.62, 48), new THREE.MeshBasicMaterial({ color: COL.yellow.clone().multiplyScalar(1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    pad.rotation.x = -Math.PI / 2; pad.position.y = 0.03; g.add(pad);
    const label = makeLabel('ED', { height: 1.5, font: '900 120px Orbitron', glow: '#ffd23f', color: '#ffffff', sub: '', subColor: '#ffd23f', subFont: '700 70px "Share Tech Mono"', bright: 0.85, w: 1024, h: 280 });
    label.sprite.position.y = 1.4; g.add(label.sprite);
    return { g, bars, label, pad };
  }
  let edMax = 1;
  function setEDs(eds) {
    const list = (eds || []).slice(0, 4);
    const show = list.length > 1; // a single-ED town == the main towers
    while (edSlots.length < list.length) edSlots.push(edSlot(edSlots.length));
    edMax = Math.max(1, ...list.map((e) => e.total || 0));
    edSlots.forEach((S, i) => {
      const e = list[i]; S.g.visible = show && !!e; if (!S.g.visible) return;
      const real = (e.candidates || []).filter((c) => !isWI(c));
      const pick = (p) => real.filter((c) => c.party === p).sort((a, b) => (b.votes || 0) - (a.votes || 0))[0];
      const cs = [pick('DEM'), pick('GOP')];
      cs.forEach((c, k) => { S.bars[k].target = e.total ? 0.05 + ED_MAX * ((c?.votes || 0) / edMax) : 0.05; });
      const lead = real.slice().sort((a, b) => (b.votes || 0) - (a.votes || 0))[0];
      const name = String(e.name || 'ED ' + (i + 1)).replace(/^(stanford|pine plains)\s*/i, '').toUpperCase();
      if (!e.total || !lead) S.label.set(name, 'AWAITING', '#ffffff', '#ffd23f');
      else S.label.set(name, `${lastName(lead.name)} ${(lead.pct ?? 0).toFixed(0)}% · ${e.total.toLocaleString('en-US')} VOTES`, '#ffffff', lead.party === 'DEM' ? '#2d8cff' : lead.party === 'GOP' ? '#ff2e55' : '#ffd23f');
    });
  }

  const slideTarget = new THREE.Vector3();
  let snapped = false;
  return {
    group, size: { W, D },
    setActive(key) {
      const rt = RACE_TOWN[key] || RACE_TOWN.pineplains;
      activeTown = rt.town; activeHamlet = rt.hamlet;
      const h = hamlets[rt.hamlet] || new THREE.Vector3();
      slideTarget.set(-h.x, 0.55 - h.y, -h.z);
      if (!snapped) { slide.position.copy(slideTarget); snapped = true; }
    },
    setEDs,
    tick(dt, t, fade, worldCenter) {
      for (const S of edSlots) {
        if (!S.g.visible) continue;
        let top = 0;
        for (const b of S.bars) { b.cur = damp(b.cur, b.target, 1.6, dt); b.m.scale.y = Math.max(0.02, b.cur * fade); top = Math.max(top, b.m.scale.y); b.m.material.opacity = 0.8 * fade; }
        S.label.sprite.position.y = top + 1.1; S.label.opacity = fade; S.pad.material.opacity = fade * (0.6 + 0.3 * Math.sin(t * 3));
      }
      slide.position.x = damp(slide.position.x, slideTarget.x, 2.2, dt);
      slide.position.y = damp(slide.position.y, slideTarget.y, 2.2, dt);
      slide.position.z = damp(slide.position.z, slideTarget.z, 2.2, dt);
      U.uFade.value = fade;
      U.uCenter.value.copy(worldCenter);
      U.uActA.value = damp(U.uActA.value, activeTown === 'Stanford' ? 1 : 0, 3, dt);
      U.uActB.value = damp(U.uActB.value, activeTown === 'Pine Plains' ? 1 : 0, 3, dt);
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.9);
      for (const b of borders) {
        const on = b.userData.town === activeTown;
        b.material.opacity = fade * (on ? 0.75 + 0.25 * pulse : 0.45);
        b.material.color.copy(b.userData.col).multiplyScalar(on ? 2.4 + pulse : 1.2);
      }
      for (const l of townLabels) l.opacity = fade * (l.town === activeTown ? 0 : 0.55); // active town is named by the big title; its boundary label collided with tower labels
      for (const l of lmLabels) l.opacity = fade * (l.name === activeHamlet ? 0 : 0.85); // active hamlet sits under the beacon/towers
      pinMat.opacity = fade * 0.8;
    },
  };
}
