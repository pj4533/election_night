// THE hero: Pine Plains Town Supervisor. Dutchess County hologram, light beacon, countdown ring, vote towers.
import * as THREE from 'three';
import { centroidOf, slabGeometry } from './geo.js';
import { createTerrain } from './hometownTerrain.js';
import { COL, holoMaterial, lineMaterial, makeLabel, ease, clamp01, damp, TIME } from './holo.js';

const PP = [868.78, 186.18];
const TOWNS = { pineplains: { name: 'PINE PLAINS', xy: [868.78, 186.18] }, 'stanford-council': { name: 'STANFORD', xy: [868.2, 193.2] } };
const DUTCHESS = '36027';
const S = 0.8;
const POLL_CLOSE = '2026-11-04T02:00:00Z';
const TOWER_MAX = 12, TOWER_MIN = 0.35;
const RING_Y = 7.6, RING_S = 1.2;
const TOWER_X = 3.9, TITLE_Y = 14.2;

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); return t;
}

const ringVert = `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

// terrainData (optional, from loadHometown()): real-terrain hometown variant instead of the Dutchess slab.
export function createPineView({ scene, fx, world, post, station, geoP, getNow, getState, terrainData = null }) {
  const root = new THREE.Group(); root.position.copy(station); root.visible = false; scene.add(root);
  const map = (x, y) => [(x - PP[0]) * S, (y - PP[1]) * S];
  const beaconCol = { value: COL.magenta.clone() };
  let fade = 0, visible = false, tShow = 0;

  // ---------- map ----------
  const mapGroup = new THREE.Group(); root.add(mapGroup);
  let dutchess = null;
  const neighbors = [];
  const terrain = terrainData ? createTerrain(terrainData) : null;
  if (terrain) root.add(terrain.group);
  (terrain ? new Promise(() => {}) : geoP).then((geo) => {
    const nLine = lineMaterial(COL.cyan.clone().multiplyScalar(0.9), 0.28);
    const dLine = lineMaterial(COL.cyan.clone().multiplyScalar(2.2), 1);
    for (const f of geo.counties) {
      const [cx, cy] = centroidOf(f);
      const dd = Math.hypot(cx - PP[0], cy - PP[1]);
      if (dd > 60) continue;
      const g = slabGeometry(f, map); if (!g) continue;
      const isD = String(f.id) === DUTCHESS;
      const mat = holoMaterial(isD ? COL.magenta.clone().lerp(COL.purple, 0.35) : new THREE.Color('#2a1a5e'), { glow: isD ? 1.1 : 0.7, alpha: isD ? 1 : 0.7 });
      const mesh = new THREE.Mesh(g, mat);
      mesh.scale.y = isD ? 0.55 : 0.14;
      mesh.position.y = 0.02;
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(g, 35), isD ? dLine : nLine);
      mesh.add(e);
      mesh.userData = { dist: dd, base: mesh.scale.y };
      mapGroup.add(mesh);
      if (isD) dutchess = mesh; else neighbors.push(mesh);
    }
    const dl = makeLabel('DUTCHESS COUNTY', { height: 0.9, font: '700 120px Orbitron', glow: '#00f0ff', color: '#e8f8ff' });
    dl.sprite.position.set(-0.6, 1.6, 7.2); mapGroup.add(dl.sprite);
    mapLabel = dl;
  }).catch((e) => console.error('pine map', e));
  let mapLabel = null;

  // town marker on top of Dutchess
  const townOff = new THREE.Vector3();
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 6), new THREE.MeshBasicMaterial({ color: COL.yellow.clone().multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  marker.rotation.x = -Math.PI / 2; marker.position.y = 0.62; root.add(marker);
  const beaconOffset = () => townOff;

  // ---------- beacon ----------
  const beacon = new THREE.Group(); root.add(beacon);
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uCol: beaconCol, uTime: TIME, uFade: { value: 1 }, uPow: { value: 1 } },
    vertexShader: `varying float vY; varying vec3 vN; varying vec3 vW; void main(){ vY = position.y; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uCol; uniform float uTime; uniform float uFade; uniform float uPow; varying float vY; varying vec3 vN; varying vec3 vW;
      void main(){ vec3 v = normalize(cameraPosition - vW); float core = pow(abs(dot(normalize(vN), v)), 3.0);
        float h = exp(-vY / 48.0); float flick = 0.85 + 0.15 * sin(uTime * 13.0 + vY * 0.6) ;
        float pulses = 0.6 + 0.4 * smoothstep(0.85, 1.0, sin(vY * 0.35 - uTime * 5.0));
        gl_FragColor = vec4(uCol * core * h * flick * pulses * 2.4 * uPow * uFade, 1.0); }`,
  });
  const beamCore = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 120, 16, 1, true).translate(0, 60, 0), beamMat);
  const beamGlow = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.6, 120, 24, 1, true).translate(0, 60, 0), beamMat.clone());
  beamGlow.material.uniforms = { ...beamMat.uniforms, uPow: { value: 0.32 }, uFade: beamMat.uniforms.uFade };
  beamCore.renderOrder = 30; beamGlow.renderOrder = 30;
  beacon.add(beamCore, beamGlow);
  const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: COL.magenta.clone().multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  flare.scale.setScalar(6); flare.position.y = 0.8; flare.renderOrder = 31; beacon.add(flare);
  // ripples
  const ripples = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 96), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.64; m.userData.phase = i / 3; beacon.add(m); ripples.push(m);
  }

  // ---------- towers ----------
  function makeTower(color, x, name) {
    const g = new THREE.Group(); g.position.set(x, 0.6, 1.4); root.add(g);
    const geo = new THREE.BoxGeometry(2.2, 1, 2.2).translate(0, 0.5, 0);
    const mat = holoMaterial(color, { glow: 1.35 });
    const mesh = new THREE.Mesh(geo, mat); mesh.scale.y = TOWER_MIN; g.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineMaterial(color.clone().multiplyScalar(2.5), 1)); mesh.add(edges);
    const ghostGeo = new THREE.BoxGeometry(2.45, TOWER_MAX, 2.45).translate(0, TOWER_MAX / 2, 0);
    const ghost = new THREE.LineSegments(new THREE.EdgesGeometry(ghostGeo), lineMaterial(color.clone(), 0.16)); g.add(ghost);
    // ghost graduation ticks
    const tickPos = [];
    for (let i = 1; i < 10; i++) { const y = (TOWER_MAX * i) / 10; tickPos.push(-1.22, y, 1.22, -0.7, y, 1.22, 1.22, y, 1.22, 0.7, y, 1.22); }
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(tickPos, 3));
    g.add(new THREE.LineSegments(tg, lineMaterial(color.clone(), 0.35)));
    const cap = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 3.0), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.2), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, map: glowTexture() }));
    cap.rotation.x = -Math.PI / 2; g.add(cap);
    const baseRing = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.05, 64), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    baseRing.rotation.x = -Math.PI / 2; baseRing.position.y = 0.03; g.add(baseRing);
    const label = makeLabel(name, { height: 1.35, sub: '', font: '900 140px Orbitron', glow: '#' + color.getHexString(), subColor: '#ffffff', subFont: '700 80px "Share Tech Mono"' });
    g.add(label.sprite);
    const crown = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.08, 8, 64), new THREE.MeshBasicMaterial({ color: COL.yellow.clone().multiplyScalar(2.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    crown.rotation.x = Math.PI / 2; crown.visible = false; g.add(crown);
    return { g, mesh, mat, cap, label, ghost, crown, color, cur: TOWER_MIN, target: TOWER_MIN, prevVotes: null, winner: false };
  }
  const roushT = makeTower(COL.DEM.clone(), -TOWER_X, 'DEM');
  const walshT = makeTower(COL.GOP.clone(), TOWER_X, 'GOP');
  roushT.cand = null; walshT.cand = null; roushT.slot = 'DEM'; walshT.slot = 'GOP';

  // ---------- countdown ring ----------
  const ringGroup = new THREE.Group(); ringGroup.position.y = RING_Y; ringGroup.rotation.x = -Math.PI / 2 + 0.45; root.add(ringGroup);
  const ringU = { uFrac: { value: 1 }, uTime: TIME, uMode: { value: 0 }, uFade: { value: 1 }, uA: { value: COL.magenta.clone() }, uB: { value: COL.cyan.clone() } };
  const arc = new THREE.Mesh(new THREE.RingGeometry(4.0, 4.7, 256, 1), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: ringU, vertexShader: ringVert,
    fragmentShader: `uniform float uFrac; uniform float uTime; uniform float uMode; uniform float uFade; uniform vec3 uA; uniform vec3 uB; varying vec3 vP;
      void main(){ float ang = fract(0.25 - atan(vP.y, vP.x) / 6.2831853);
        float r = length(vP.xy);
        float on = 1.0 - step(uFrac, ang);
        float seg = smoothstep(0.08, 0.16, fract(ang * 120.0)) * smoothstep(1.0, 0.92, fract(ang * 120.0));
        float scan = pow(fract(ang - uTime * 0.32), 10.0) + pow(fract(ang + 0.5 - uTime * 0.32), 10.0);
        float v = mix(on, scan, uMode);
        float head = exp(-abs(ang - uFrac) * 160.0) * (1.0 - uMode);
        float edge = smoothstep(4.62, 4.7, r) + smoothstep(4.08, 4.0, r);
        vec3 c = mix(uB * 0.1, uA * 1.15, v) * seg + uB * edge * 0.6 + vec3(1.0) * head * 2.0;
        gl_FragColor = vec4(c * uFade, 1.0); }`,
  }));
  const ticks = new THREE.Mesh(new THREE.RingGeometry(4.95, 5.25, 256, 1), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: ringU, vertexShader: ringVert,
    fragmentShader: `uniform float uTime; uniform float uFade; uniform vec3 uB; uniform vec3 uA; varying vec3 vP;
      void main(){ float ang = fract(atan(vP.y, vP.x) / 6.2831853 + uTime * 0.015);
        float f = fract(ang * 60.0); float major = step(0.92, fract(ang * 12.0 + 0.04));
        float t = step(0.82, f) + major * 1.5;
        gl_FragColor = vec4(mix(uB, uA, major) * t * 1.3 * uFade, 1.0); }`,
  }));
  const inner = new THREE.Mesh(new THREE.RingGeometry(3.45, 3.55, 256, 1), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: ringU, vertexShader: ringVert,
    fragmentShader: `uniform float uTime; uniform float uFade; uniform vec3 uB; varying vec3 vP;
      void main(){ float ang = fract(atan(vP.y, vP.x) / 6.2831853 - uTime * 0.08);
        float d = step(0.5, fract(ang * 24.0)); float sweep = pow(fract(ang), 4.0);
        gl_FragColor = vec4(uB * (d * 0.6 + sweep * 1.5) * uFade, 1.0); }`,
  }));
  arc.renderOrder = ticks.renderOrder = inner.renderOrder = 32;
  const backdrop = new THREE.Mesh(new THREE.CircleGeometry(3.4, 96), new THREE.MeshBasicMaterial({ color: 0x080120, transparent: true, opacity: 0.78, depthWrite: false, side: THREE.DoubleSide }));
  backdrop.renderOrder = 33;
  ringGroup.add(arc, ticks, inner, backdrop);
  const clockLabel = makeLabel('--:--', { height: 2.5, bright: 0.8, sub: 'POLLS CLOSE · 9:00 PM ET', font: '900 160px Orbitron', glow: '#ff2bd6', subColor: '#00f0ff', subFont: '700 70px Rajdhani', w: 1024, h: 300 });
  clockLabel.sprite.position.set(0, RING_Y + 0.2, 0); root.add(clockLabel.sprite);

  // radar sweep (awaiting BOE)
  const radarU = { uTime: TIME, uFade: { value: 0 }, uCol: { value: COL.yellow.clone() } };
  const radar = new THREE.Mesh(new THREE.CircleGeometry(16, 128), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: radarU, vertexShader: ringVert,
    fragmentShader: `uniform float uTime; uniform float uFade; uniform vec3 uCol; varying vec3 vP;
      void main(){ float r = length(vP.xy); float ang = fract(atan(vP.y, vP.x) / 6.2831853 - uTime * 0.22);
        float wedge = pow(ang, 9.0) * 0.9 + smoothstep(0.995, 1.0, ang) * 1.5;
        float rings = smoothstep(0.08, 0.0, abs(fract(r / 3.0) - 0.5) - 0.44);
        float fall = smoothstep(16.0, 6.0, r);
        gl_FragColor = vec4(uCol * (wedge + rings * 0.18) * fall * uFade, 1.0); }`,
  }));
  radar.rotation.x = -Math.PI / 2; radar.position.y = 0.7; radar.renderOrder = 29; root.add(radar);

  // titles
  const title = makeLabel('PINE PLAINS', { height: 2.6, sub: 'TOWN SUPERVISOR · DUTCHESS CO. NY', font: '900 170px Orbitron', glow: '#ff2bd6', color: '#ffe9ff', subColor: '#00f0ff', w: 1400, h: 320 });
  title.sprite.position.set(0, TITLE_Y, 1.2); root.add(title.sprite);

  // ---------- data ----------
  let race = null, mode = 'countdown', modeK = 0, lastWinnerFx = 0;
  let raceKey = null, townName = 'PINE PLAINS', unopposed = false;
  const isWI = (c) => /write.?in|scatter|void|blank/i.test(c?.name || '');
  const lastName = (n) => { const w = String(n || '').trim().split(/\s+/); return (w[w.length - 1] || '').toUpperCase(); };
  function pick() {
    const real = (race?.candidates || []).filter((c) => !isWI(c));
    const top = real.map((c, i) => [c, i]).sort((a, b) => ((b[0].votes || 0) - (a[0].votes || 0)) || a[1] - b[1]).slice(0, 2).map((x) => x[0]);
    let a = top.find((c) => c.party === 'DEM'), b = top.find((c) => c.party === 'GOP');
    const rest = top.filter((c) => c !== a && c !== b);
    if (!a) a = rest.shift(); if (!b) b = rest.shift();
    return [a || null, b || null];
  }
  function candidates() { const [a, b] = pick(); return { roush: a, walsh: b }; }
  function leadCol() { const { roush, walsh } = candidates(); return (roush?.votes || 0) >= (walsh?.votes || 0) ? (roush ? colFor(roush, COL.DEM) : COL.DEM) : colFor(walsh, COL.GOP); }
  function colFor(c, d) { return c?.party === 'DEM' ? COL.DEM : c?.party === 'GOP' ? COL.GOP : d; }
  function towerText(T, c) {
    if (!c) return;
    const total = race?.totalVotes || 0, last = lastName(c.name), party = c.party || '';
    if (!total) T.label.set(last, unopposed ? 'UNOPPOSED · AWAITING' : `${party} · AWAITING`);
    else T.label.set(`${last} ${(c.pct ?? 0).toFixed(1)}%`, `${(c.votes || 0).toLocaleString('en-US')} VOTES${unopposed ? ' · UNOPPOSED' : ''}${c.winner ? ' · WINNER' : ''}`);
  }
  function setRace(r, { initial = false } = {}) {
    if (!r) return;
    const newKey = r.key || null;
    const switched = newKey !== raceKey;
    const prevTotal = race && !switched ? race.totalVotes || 0 : null;
    race = r; raceKey = newKey;
    if (switched) {
      const tw = TOWNS[newKey] || TOWNS.pineplains;
      townName = tw.name;
      if (terrain) { terrain.setActive(newKey); townOff.set(0, 0, 0); }
      else townOff.set((tw.xy[0] - PP[0]) * S, 0, (tw.xy[1] - PP[1]) * S);
      beacon.position.copy(townOff); marker.position.x = townOff.x; marker.position.z = townOff.z;
      title.set(townName, (r.title || 'TOWN RACE').toUpperCase() + ' · DUTCHESS CO. NY');
      roushT.prevVotes = walshT.prevVotes = null; roushT.cur = walshT.cur = 0.05;
    }
    if (terrain) terrain.setEDs(r.edResults);
    const cands = pick();
    const real = (r.candidates || []).filter((c) => !isWI(c));
    unopposed = real.length <= 1;
    const total = r.totalVotes || 0;
    [roushT, walshT].forEach((T, i) => {
      const c = cands[i];
      T.cand = c;
      T.g.visible = !!c;
      T.g.position.x = unopposed ? 0 : (i === 0 ? -TOWER_X : TOWER_X);
      if (!c) { T.target = TOWER_MIN; T.winner = false; return; }
      const share = total ? (c.votes || 0) / total : 0;
      T.target = TOWER_MIN + (TOWER_MAX - TOWER_MIN) * share;
      T.winner = !!c.winner;
      towerText(T, c);
      const v = c.votes || 0;
      if (!initial && visible && T.prevVotes != null && v > T.prevVotes && prevTotal > 0) {
        const top = T.g.position.clone().add(root.position); top.y += T.target + 0.6;
        fx.burst(top, T.color, 160, { speed: 6, up: 7, sz: 1.2 });
      }
      T.prevVotes = v;
    });
    if (!initial && prevTotal === 0 && total > 0) erupt();
  }
  function erupt() {
    for (const T of [roushT, walshT]) {
      if (!T.cand) continue;
      const p = T.g.position.clone().add(root.position);
      fx.burst(p, T.color, 900, { speed: 13, up: 18, lifeS: 3, sz: 1.5, spread: 1.4 });
      fx.ring(p.clone().setY(0.1), T.color, { radius: 26, dur: 1.8 });
    }
    const lead = leadCol();
    post?.flash(lead, 0.9);
    world?.shockwave(station.x, station.z, lead);
  }

  function fmtClock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return `${h ? h + ':' : ''}${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  const etFmt = (t) => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit' });

  return {
    root,
    pose() {
      if (terrain) {
        // terrain variant: higher camera so the relief reads; box = stage stack + surrounding terrain
        const tgt = station.clone().add(new THREE.Vector3(0, 5, -3));
        const box = new THREE.Box3(station.clone().add(new THREE.Vector3(-13.5, 0, -13)), station.clone().add(new THREE.Vector3(13.5, TITLE_Y + 1.6, 7)));
        return { target: tgt, position: tgt.clone().add(new THREE.Vector3(-8, 21, 30)), orbit: 0.12, box };
      }
      // fit box (world): towers + ring + title; beacon intentionally overshoots the top of the stage window
      const tgt = station.clone().add(new THREE.Vector3(0, 7.2, 1.5));
      const box = new THREE.Box3(station.clone().add(new THREE.Vector3(-6.2, 0, -1.5)), station.clone().add(new THREE.Vector3(6.2, TITLE_Y + 1.6, 4.5)));
      return { target: tgt, position: tgt.clone().add(new THREE.Vector3(-4, 7.8, 33)), orbit: 0.14, box };
    },
    show(r) {
      const fresh = !visible;
      visible = true; root.visible = true;
      if (r) setRace(r, { initial: true });
      if (fresh) { tShow = 0; roushT.cur = walshT.cur = 0.05; }
    },
    hide() { visible = false; },
    update(r) { if (r) setRace(r); },
    tick(dt, t) {
      fade = damp(fade, visible ? 1 : 0, visible ? 2.5 : 4, dt);
      if (!visible && fade < 0.01) { root.visible = false; return; }
      tShow += dt;
      const now = getNow();
      const total = race?.totalVotes || 0;
      const close = Date.parse(race?.pollClose || POLL_CLOSE);
      mode = total > 0 ? 'results' : now < close ? 'countdown' : 'awaiting';

      if (terrain) terrain.tick(dt, t, fade, station);
      // map rise
      for (const m of mapGroup.children) {
        if (!m.userData?.base) continue;
        const k = clamp01((tShow - m.userData.dist / 60 * 0.9) / 0.8);
        m.scale.y = Math.max(0.002, m.userData.base * ease.back(k) * fade);
        if (m.material.uniforms) m.material.uniforms.uFade.value = fade;
      }
      if (dutchess) {
        const u = dutchess.material.uniforms;
        const target = mode === 'results' ? leadCol() : COL.magenta;
        u.uColor.value.lerp(tmp.copy(target).lerp(COL.purple, 0.3), 1 - Math.exp(-2 * dt));
        u.uPulse.value = 0.12 + 0.12 * Math.sin(t * 2.2);
      }
      if (mapLabel) mapLabel.opacity = fade * 0.85;

      // beacon
      const bc = mode === 'results'
        ? leadCol()
        : mode === 'awaiting' ? COL.yellow : COL.magenta;
      beaconCol.value.lerp(bc, 1 - Math.exp(-2 * dt));
      beamMat.uniforms.uFade.value = fade * (0.85 + 0.15 * Math.sin(t * 3));
      flare.material.color.copy(beaconCol.value).multiplyScalar(2 * fade);
      flare.scale.setScalar(4.2 + Math.sin(t * 4) * 0.5);
      for (const m of ripples) {
        const ph = (t * 0.45 + m.userData.phase) % 1;
        m.scale.setScalar(0.5 + ph * 9);
        m.material.color.copy(beaconCol.value).multiplyScalar(2 * (1 - ph) * fade);
      }
      marker.rotation.z = t * 0.8;
      marker.material.opacity = fade;

      // ring + clock
      const wantRing = mode !== 'results' ? 1 : 0;
      modeK = damp(modeK, mode === 'awaiting' ? 1 : 0, 3, dt);
      ringU.uMode.value = modeK;
      ringU.uFade.value = damp(ringU.uFade.value, wantRing * fade, 3, dt);
      ringGroup.visible = ringU.uFade.value > 0.01;
      backdrop.material.opacity = 0.78 * ringU.uFade.value;
      ringGroup.rotation.z = Math.sin(t * 0.3) * 0.05;
      ticks.rotation.z = -t * 0.05; inner.rotation.z = t * 0.25;
      ringGroup.scale.setScalar(RING_S * (1 + (1 - wantRing) * (1 - ringU.uFade.value) * 0.6));
      ringU.uA.value.lerp(mode === 'awaiting' ? COL.yellow : COL.magenta, 1 - Math.exp(-2 * dt));
      radarU.uFade.value = damp(radarU.uFade.value, (mode === 'awaiting' ? 1 : 0) * fade, 2, dt);
      radar.visible = radarU.uFade.value > 0.01;
      if (mode === 'countdown') {
        const rem = close - now;
        ringU.uFrac.value = clamp01(rem / 3600000);
        clockLabel.set(fmtClock(rem), 'POLLS CLOSE · 9:00 PM ET', '#ffffff', '#ff2bd6');
      } else if (mode === 'awaiting') {
        const src = getState()?.sources?.dutchess;
        const dots = '.'.repeat(1 + (((Math.floor(t * 2) % 3) + 3) % 3));
        clockLabel.set('AWAITING BOE' + dots.padEnd(3, ' '), src?.lastPoll ? `DUTCHESS BOE · LAST CHECK ${etFmt(src.lastPoll)}` : 'POLLS CLOSED · SCANNING DUTCHESS BOE', '#fff6d0', '#ffd23f');
      }
      clockLabel.opacity = ringU.uFade.value;

      // towers
      for (const T of [roushT, walshT]) {
        if (!T.g.visible) continue;
        const k = clamp01((tShow - 0.6) / 1.2);
        T.cur = damp(T.cur, T.target, 1.6, dt);
        const h = Math.max(0.02, T.cur * ease.out(k) * fade);
        T.mesh.scale.y = h;
        T.cap.position.y = h + 0.02;
        T.cap.material.opacity = fade * (0.7 + 0.3 * Math.sin(t * 5 + T.g.position.x));
        T.label.sprite.position.y = mode === 'results' ? Math.min(h + 1.3, TOWER_MAX - 0.6) : 2.2;
        T.label.opacity = fade;
        T.mat.uniforms.uFade.value = fade;
        T.mat.uniforms.uPulse.value = T.winner ? 0.25 + 0.2 * Math.sin(t * 6) : 0;
        T.ghost.material.opacity = 0.16 * fade;
        T.crown.visible = T.winner && fade > 0.1;
        if (T.crown.visible) { T.crown.position.y = h + 1 + Math.sin(t * 2) * 0.2; T.crown.rotation.z = t; }
      }
      if (visible && (roushT.winner || walshT.winner) && t - lastWinnerFx > 1.4) {
        lastWinnerFx = t;
        const T = roushT.winner ? roushT : walshT;
        const p = T.g.position.clone().add(root.position); p.y += T.cur + 2 + Math.random() * 3; p.x += (Math.random() - 0.5) * 6;
        fx.burst(p, Math.random() < 0.5 ? T.color : COL.yellow, 220, { speed: 9, up: 2, gravity: 3, lifeS: 1.8 });
      }
      title.opacity = fade;
      title.sprite.position.y = TITLE_Y + Math.sin(t * 0.8) * 0.12;
    },
    onEvent(ev) {
      if (ev?.raceKey && ev.raceKey === raceKey && ev.priority >= 3 && visible) erupt();
    },
  };
}
const tmp = new THREE.Color();
