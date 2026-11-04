// State race hologram: tilted floating map of county slabs. Height ~ votes reported (log), color ~ leader margin.
import * as THREE from 'three';
import { POSTAL_FIPS, bboxOf, centroidOf, slabGeometry, flatGeometry, stateBorder } from './geo.js';
import { COL, partyCol, partyHex, holoMaterial, lineMaterial, makeLabel, ease, clamp01, damp, disposeTree } from './holo.js';

const TILT = 0.78;              // radians the map plane leans back toward the camera
const MAP_W = 19, MAP_H = 10.5; // fit box in world units
const H_MAX = 3.0, H_MIN = 0.07;
const CACHE_MAX = 6;
const NEUTRAL = new THREE.Color('#9a7bff');

const tmpC = new THREE.Color();
const LEFT_TOP = 6; // counties highlighted as "votes still out"

function aggregate(race) {
  const m = new Map();
  for (const c of race?.counties || []) {
    const f = String(c.fips || '').padStart(5, '0');
    let a = m.get(f);
    if (!a) { a = { total: 0, expected: 0, remaining: 0, votes: {} }; m.set(f, a); }
    a.total += c.total || 0; a.expected += c.expected || 0; a.remaining += c.remaining ?? Math.max(0, (c.expected || 0) - (c.total || 0));
    for (const k in c.votes || {}) a.votes[k] = (a.votes[k] || 0) + (c.votes[k] || 0);
  }
  return m;
}

function marginColor(race, votes, total, out) {
  if (!total) return out.copy(COL.none).multiplyScalar(0.7);
  let best = null, second = null;
  for (const c of race.candidates || []) {
    const v = votes[c.id] || 0;
    if (!best || v > best.v) { second = best; best = { c, v }; } else if (!second || v > second.v) second = { c, v };
  }
  if (!best || !best.v) return out.copy(COL.none).multiplyScalar(0.7);
  const m = (best.v - (second?.v || 0)) / total;
  const t = clamp01(m / 0.35);
  out.copy(NEUTRAL).lerp(partyCol(best.c.party), 0.7 + 0.3 * t).multiplyScalar(0.5 + 0.55 * t);
  return out;
}

export function createStateView({ scene, fx, station, geoP }) {
  const root = new THREE.Group(); root.position.copy(station); root.visible = false; scene.add(root);
  const tilt = new THREE.Group(); tilt.position.set(0, 4.6, 0); tilt.rotation.x = TILT; root.add(tilt);
  const upU = { value: new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), TILT) };

  // projector pad on the floor + beams to the map
  const pad = new THREE.Mesh(new THREE.RingGeometry(7.5, 7.7, 128), new THREE.MeshBasicMaterial({ color: COL.cyan.clone().multiplyScalar(1.4), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  pad.rotation.x = -Math.PI / 2; pad.position.y = 0.04; root.add(pad);
  const pad2 = new THREE.Mesh(new THREE.RingGeometry(8.4, 8.5, 128, 1, 0, Math.PI * 1.6), pad.material.clone());
  pad2.material.color.copy(COL.magenta).multiplyScalar(1.4); pad2.rotation.x = -Math.PI / 2; pad2.position.y = 0.05; root.add(pad2);

  const cache = new Map(); // fips2 -> entry
  let active = null, building = null, wantKey = null, visible = false, lastRace = null;

  function build(geo, race) {
    const fips2 = POSTAL_FIPS[race.state] || String(race.counties?.[0]?.fips || '').slice(0, 2);
    const feats = geo.counties.filter((f) => String(f.id).startsWith(fips2));
    const stateF = geo.stateById.get(fips2);
    const useCounties = !!(race.counties?.length && feats.length);
    const base = feats.length ? feats : stateF ? [stateF] : [];
    if (!base.length) return null;
    const bb = bboxOf(base);
    const w = bb[2] - bb[0], h = bb[3] - bb[1];
    const s = Math.min(MAP_W / w, MAP_H / h);
    const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    const map = (x, y) => [(x - cx) * s, (y - cy) * s];
    const group = new THREE.Group();
    const lineMat = lineMaterial(COL.cyan.clone().multiplyScalar(1.2), 0.55);
    const borderMat = lineMaterial(COL.magenta.clone().multiplyScalar(2.2), 1);
    const recs = [];
    const beamGeo = new THREE.CylinderGeometry(0.09, 0.09, 1, 10, 1, true).translate(0, 0.5, 0); // per entry: disposeTree frees it

    // dark backing plate
    const plateGeo = stateF ? flatGeometry(stateF, map) : null;
    if (plateGeo) {
      const plate = new THREE.Mesh(plateGeo, new THREE.MeshBasicMaterial({ color: 0x0a0228, transparent: true, opacity: 0.82, depthWrite: false }));
      plate.position.y = -0.03; plate.renderOrder = 1; group.add(plate);
      const bpos = stateBorder(geo, fips2, map, 0.0);
      const bgeo = new THREE.BufferGeometry(); bgeo.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
      const border = new THREE.LineSegments(bgeo, borderMat); border.renderOrder = 3; group.add(border);
    }

    const sources = useCounties ? feats : [stateF];
    let maxD = 1;
    for (const f of sources) {
      const g = slabGeometry(f, map);
      if (!g) continue;
      const mat = holoMaterial(COL.none, { up: upU, glow: 1.1 });
      const mesh = new THREE.Mesh(g, mat);
      mesh.renderOrder = 2;
      mesh.scale.y = 0.001;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 35), lineMat);
      edges.renderOrder = 3;
      mesh.add(edges);
      group.add(mesh);
      const [ccx, ccy] = centroidOf(f);
      const [wx, wz] = map(ccx, ccy);
      // "votes left" highlight: a gently breathing yellow outline + a thin beam whose height ~ votes remaining
      const outMat = lineMaterial(COL.yellow.clone().multiplyScalar(1.6), 0);
      const outline = new THREE.LineSegments(edges.geometry, outMat); outline.renderOrder = 4; outline.visible = false; mesh.add(outline);
      const beamMat = new THREE.MeshBasicMaterial({ color: COL.yellow.clone().multiplyScalar(1.3), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const beam = new THREE.Mesh(beamGeo, beamMat); beam.position.set(wx, 0, wz); beam.scale.y = 0.001; beam.visible = false; beam.renderOrder = 4; group.add(beam);
      const d = Math.hypot(wx, wz); if (d > maxD) maxD = d;
      recs.push({ fips: useCounties ? String(f.id) : 'state', mesh, mat, cur: H_MIN, target: H_MIN, pulse: 0, d, delay: 0, colT: COL.none.clone(), prev: null, top: new THREE.Vector3(wx, 0, wz), outline, outMat, beam, beamMat, left: 0, leftCur: 0, phase: Math.random() * 6.28 });
    }
    for (const r of recs) r.delay = (r.d / maxD) * 0.9;

    const label = makeLabel((race.stateName || race.state || '').toUpperCase(), { height: 1.5, sub: race.office ? race.office.toUpperCase() : race.officeId === 'G' ? 'GOVERNOR' : 'U.S. SENATE', glow: '#ff2bd6', subColor: '#00f0ff' });
    label.sprite.position.set(0, 0.3, -(h * s) / 2 - 0.9);
    group.add(label.sprite);

    tilt.add(group);
    group.visible = false;
    return { key: fips2, group, recs, label, lineMat, borderMat, t: 0, fade: 0, mode: 'hidden', used: performance.now(), mapScale: s };
  }

  function apply(entry, race, { pulse = true } = {}) {
    if (!entry || !race) return;
    if (entry.recs.length === 1 && entry.recs[0].fips === 'state') {
      const r = entry.recs[0];
      const votes = Object.fromEntries((race.candidates || []).map((c) => [c.id, c.votes || 0]));
      const total = race.totalVotes || 0;
      r.target = H_MIN + (H_MAX * 0.8) * clamp01((race.eevp || 0) / 100) + (total ? 0.3 : 0);
      marginColor(race, votes, total, r.colT);
      if (pulse && r.prev != null && total > r.prev) r.pulse = 1;
      r.prev = total;
      return;
    }
    const agg = aggregate(race);
    let maxE = 1;
    for (const a of agg.values()) maxE = Math.max(maxE, a.expected || 0, a.total || 0);
    const lmax = Math.log1p(maxE);
    // the counties with the most vote still out (only while the race is uncalled and meaningfully incomplete)
    const called = race.callStatus === 'called' || (race.candidates || []).some((c) => c.winner);
    const ranked = called ? [] : [...agg.entries()].filter(([, a]) => a.remaining > 0 && (race.totalVotes || 0) > 0).sort((x, y) => y[1].remaining - x[1].remaining).slice(0, LEFT_TOP);
    const maxLeft = ranked[0]?.[1].remaining || 1;
    const leftOf = new Map(ranked.map(([f, a]) => [f, a.remaining / maxLeft]));
    for (const r of entry.recs) {
      r.left = leftOf.get(r.fips) || 0;
      const a = agg.get(r.fips);
      const total = a?.total || 0;
      r.target = H_MIN + H_MAX * (total > 0 ? Math.log1p(total) / lmax : 0);
      marginColor(race, a?.votes || {}, total, r.colT);
      if (pulse && r.prev != null && total > r.prev) r.pulse = 1;
      r.prev = total;
    }
  }

  function evict() {
    if (cache.size <= CACHE_MAX) return;
    const victims = [...cache.values()].filter((e) => e !== active && e.mode === 'hidden').sort((a, b) => a.used - b.used);
    while (cache.size > CACHE_MAX && victims.length) {
      const v = victims.shift();
      tilt.remove(v.group); v.label.dispose(); disposeTree(v.group); cache.delete(v.key);
    }
  }

  function keyOf(race) { return POSTAL_FIPS[race?.state] || String(race?.counties?.[0]?.fips || '').slice(0, 2); }

  function activate(entry, race) {
    if (active && active !== entry) { active.mode = 'exiting'; }
    active = entry;
    entry.mode = 'entering'; entry.t = 0; entry.fade = 1; entry.group.visible = true; entry.used = performance.now();
    for (const r of entry.recs) { r.cur = H_MIN; r.prev = null; }
    apply(entry, race, { pulse: false });
  }

  function show(race) {
    visible = true; root.visible = true;
    lastRace = race;
    if (!race) return;
    const key = keyOf(race);
    wantKey = key;
    const hit = cache.get(key);
    if (hit && hit === active && hit.mode !== 'exiting') { apply(hit, race); return; }
    if (hit) { activate(hit, race); return; }
    if (active) active.mode = 'exiting';
    geoP.then((geo) => {
      if (wantKey !== key) return;
      let e = cache.get(key);
      if (!e) { e = build(geo, race); if (!e) return; cache.set(key, e); evict(); }
      if (visible && wantKey === key) activate(e, lastRace || race);
    }).catch((err) => console.error('stateMap build', err));
  }

  function prebuild(races) {
    geoP.then((geo) => {
      let i = 0;
      for (const race of races) {
        if (!race) continue;
        const key = keyOf(race);
        if (cache.has(key)) continue;
        setTimeout(() => { if (!cache.has(key)) { const e = build(geo, race); if (e) { cache.set(key, e); evict(); } } }, 400 + 500 * i++);
      }
    }).catch(() => {});
  }

  // world-space bounds of the active state map (counties at full H_MAX height + title label)
  function activeBox() {
    if (!active) return null;
    const lb = new THREE.Box3(), v = new THREE.Vector3();
    for (const r of active.recs) {
      const g = r.mesh.geometry; if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox;
      lb.expandByPoint(v.set(b.min.x + r.mesh.position.x, 0, b.min.z + r.mesh.position.z));
      lb.expandByPoint(v.set(b.max.x + r.mesh.position.x, Math.max(0.1, b.max.y) * H_MAX, b.max.z + r.mesh.position.z));
    }
    const lp = active.label.sprite.position, lw = active.label.sprite.scale.x * 0.3;
    lb.expandByPoint(v.set(lp.x - lw, lp.y + 0.8, lp.z)); lb.expandByPoint(v.set(lp.x + lw, lp.y - 0.8, lp.z));
    root.updateMatrixWorld(true);
    const wb = new THREE.Box3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? lb.max.x : lb.min.x, i & 2 ? lb.max.y : lb.min.y, i & 4 ? lb.max.z : lb.min.z).applyMatrix4(active.group.matrixWorld);
      wb.expandByPoint(v);
    }
    return wb.isEmpty() ? null : wb;
  }

  return {
    root,
    frameKey() { return active && active.mode !== 'exiting' ? active.key : null; },
    pose() {
      const tgt = station.clone().add(new THREE.Vector3(0, 5.2, 0.5));
      const box = activeBox() || new THREE.Box3(station.clone().add(new THREE.Vector3(-9.8, 0.6, -4.8)), station.clone().add(new THREE.Vector3(9.8, 9.6, 4.6)));
      return { target: tgt, position: tgt.clone().add(new THREE.Vector3(0, 4.2, 25)), orbit: 0.1, box };
    },
    show,
    prebuild,
    hide() { visible = false; wantKey = null; if (active) active.mode = 'exiting'; active = null; },
    update(race) {
      if (!race || !active || keyOf(race) !== active.key) return;
      lastRace = race;
      apply(active, race);
    },
    tick(dt, t) {
      let any = false;
      tilt.position.y = 4.6 + Math.sin(t * 0.7) * 0.12;
      root.rotation.y = Math.sin(t * 0.13) * 0.05;
      pad.rotation.z = t * 0.2; pad2.rotation.z = -t * 0.35;
      for (const e of cache.values()) {
        if (e.mode === 'hidden') continue;
        any = true;
        e.t += dt;
        if (e.mode === 'exiting') { e.fade = Math.max(0, e.fade - dt * 2.4); if (e.fade <= 0) { e.mode = 'hidden'; e.group.visible = false; continue; } }
        const fade = e.fade;
        e.lineMat.opacity = 0.55 * fade; e.borderMat.opacity = fade;
        e.label.opacity = clamp01((e.t - 0.3) * 2) * fade;
        const k0 = 1 - Math.exp(-4 * dt);
        for (const r of e.recs) {
          const k = clamp01((e.t - r.delay) / 0.75);
          const rise = (e.mode === 'exiting' ? fade : ease.back(k));
          r.cur = damp(r.cur, r.target, 2.5, dt);
          r.mesh.scale.y = Math.max(0.002, r.cur * rise);
          const u = r.mat.uniforms;
          u.uColor.value.lerp(r.colT, k0);
          u.uFade.value = fade * clamp01(k * 3);
          if (r.pulse > 0) { r.pulse = Math.max(0, r.pulse - dt * 0.8); }
          u.uPulse.value = r.pulse * r.pulse;
          if (r.outline) {
            // slow breathing (≈4 s period), no flashing; fades in/out when the ranking changes
            r.leftCur = damp(r.leftCur, r.left, 1.5, dt);
            const on = r.leftCur > 0.01;
            r.outline.visible = on; r.beam.visible = on;
            if (on) {
              const breathe = 0.7 + 0.3 * Math.sin(t * 1.6 + r.phase);
              const w = (0.35 + 0.65 * r.leftCur) * fade * clamp01(k * 2);
              r.outMat.opacity = 0.9 * w * breathe;
              r.beamMat.opacity = 0.32 * w * breathe;
              const top = Math.max(0.002, r.cur * rise) * (r.mesh.geometry.boundingBox?.max.y ?? 1);
              r.beam.position.y = top;
              r.beam.scale.y = Math.max(0.001, (0.4 + 3.2 * r.leftCur) * rise);
            }
          }
        }
      }
      if (!any && !visible) root.visible = false;
    },
    onEvent(ev) {
      if (!active) return;
      if (ev?.priority >= 3) for (const r of active.recs) r.pulse = Math.max(r.pulse, 0.5 + Math.random() * 0.3);
    },
  };
}
