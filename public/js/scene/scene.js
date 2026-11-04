// 3D stage entry. createScene(canvas) -> { update(state), showSegment(seg), onEvent(ev) }
import * as THREE from 'three';
import { TIME, COL, ease, partyCol } from './holo.js';
import { createWorld } from './world.js';
import { createPost } from './post.js';
import { createFx } from './fx.js';
import { loadGeo } from './geo.js';
import { createStateView } from './stateMap.js';
import { createPineView } from './pinePlains.js';
import { loadHometown } from './hometownTerrain.js';
import { createBalanceView } from './balance.js';

// 3D STAGE WINDOW (viewport fractions) — the clear area framed by the HTML chrome (see FRONTEND_CONTRACT "Layout zones v2")
export const STAGE_RECT = { x0: 0.26, x1: 0.71, y0: 0.08, y1: 0.79 };
// per-segment stage windows (seg.stageRect wins; then this map by id; else STAGE_RECT). Hometown races use a wide left card.
export const STAGE_RECTS = {
  pineplains: { x0: 0.45, x1: 0.71, y0: 0.08, y1: 0.79 },
  'stanford-council': { x0: 0.45, x1: 0.71, y0: 0.08, y1: 0.79 },
};
// projection center = stage window center (mutable: follows the active segment's rect)
let RECT = STAGE_RECT;
let SUBJECT_X = (RECT.x0 + RECT.x1) / 2, SUBJECT_Y = (RECT.y0 + RECT.y1) / 2;
function setRect(r) { RECT = r || STAGE_RECT; SUBJECT_X = (RECT.x0 + RECT.x1) / 2; SUBJECT_Y = (RECT.y0 + RECT.y1) / 2; }
const FIT_MARGIN = 0.04; // fraction of the window kept clear on each side (also absorbs drift/zoom)

const STATIONS = {
  pine: new THREE.Vector3(0, 0, 0),
  states: new THREE.Vector3(120, 0, -45),
  balance: new THREE.Vector3(-120, 0, -35),
};

function reportErr(kind, e) {
  console.error(kind, e);
  try { fetch('/api/clientlog', { method: 'POST', body: JSON.stringify({ kind: 'scene.' + kind, error: String(e?.stack || e) }) }).catch(() => {}); } catch {}
}

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
  renderer.setClearColor(0x07021a, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 6000);

  const world = createWorld(scene);
  const fx = createFx(scene);
  const post = createPost(renderer, scene, camera, { samples: pixelRatio < 1.5 ? 4 : 0 });

  let state = null, serverOffset = 0;
  const getNow = () => Date.now() + serverOffset;
  const getState = () => state;
  const geoP = loadGeo();
  geoP.catch((e) => reportErr('geo', e));

  const views = {
    pine: createPineView({ scene, fx, world, post, station: STATIONS.pine, geoP, getNow, getState }),
    states: createStateView({ scene, fx, station: STATIONS.states, geoP }),
    balance: createBalanceView({ scene, fx, station: STATIONS.balance }),
  };
  let activeName = null, seg = null, prebuilt = false;
  // real-terrain hometown view (Stanford / Pine Plains): only used once public/geo/hometown.json loads; else the slab 'pine' view
  loadHometown().then((data) => {
    views.hometown = createPineView({ scene, fx, world, post, station: STATIONS.pine, geoP, getNow, getState, terrainData: data });
    if (state) views.hometown.update(state.watch?.find((r) => r.key === (seg && HOMETOWN.has(seg.id) ? seg.id : 'pineplains')));
    if (seg && activeName === 'pine') api.showSegment(seg);
  }).catch((e) => reportErr('hometown', e));

  // ---------- camera rig ----------
  const rig = {
    pos: new THREE.Vector3(0, 40, 120), tgt: new THREE.Vector3(0, 20, -200),
    fromPos: new THREE.Vector3(), fromTgt: new THREE.Vector3(), toPos: new THREE.Vector3(0, 40, 120), toTgt: new THREE.Vector3(0, 20, -200),
    k: 1, dur: 2.4, lift: 0, orbit: 0.15,
    shake: 0,
  };
  // ---------- framing: fit pose.box into STAGE_RECT ----------
  const fitCam = new THREE.PerspectiveCamera();
  const _c = new THREE.Vector3(), _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();
  function boxExtent(box, tgt, d) {
    fitCam.copy(camera);
    fitCam.position.copy(tgt).addScaledVector(_dir, d);
    fitCam.lookAt(tgt); fitCam.updateMatrixWorld(true);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, behind = false;
    for (let i = 0; i < 8; i++) {
      _c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      _c.applyMatrix4(fitCam.matrixWorldInverse);
      if (_c.z > -0.5) behind = true;
      _c.applyMatrix4(fitCam.projectionMatrix);
      const sx = (_c.x + 1) / 2, sy = (1 - _c.y) / 2;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return { x0, x1, y0, y1, behind };
  }
  function fitPose(pose) {
    if (!pose.box) return { position: pose.position.clone(), target: pose.target.clone() };
    camera.updateProjectionMatrix();
    const tgt = pose.target.clone();
    _dir.subVectors(pose.position, pose.target).normalize();
    const mx = (RECT.x1 - RECT.x0) * FIT_MARGIN, my = (RECT.y1 - RECT.y0) * FIT_MARGIN;
    const R = { x0: RECT.x0 + mx, x1: RECT.x1 - mx, y0: RECT.y0 + my, y1: RECT.y1 - my };
    const fits = (e) => !e.behind && e.x0 >= R.x0 && e.x1 <= R.x1 && e.y0 >= R.y0 && e.y1 <= R.y1;
    let d = 30;
    for (let pass = 0; pass < 3; pass++) {
      let lo = 2, hi = 600;
      for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (fits(boxExtent(pose.box, tgt, m))) hi = m; else lo = m; }
      d = hi;
      // recenter: slide target in the camera plane so the projected box is centered in the window
      const e = boxExtent(pose.box, tgt, d);
      const dxs = (e.x0 + e.x1) / 2 - SUBJECT_X, dys = (e.y0 + e.y1) / 2 - SUBJECT_Y;
      const halfH = d * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      _right.setFromMatrixColumn(fitCam.matrixWorld, 0); _up.setFromMatrixColumn(fitCam.matrixWorld, 1);
      tgt.addScaledVector(_right, dxs * 2 * halfH * camera.aspect).addScaledVector(_up, -dys * 2 * halfH);
    }
    return { target: tgt, position: tgt.clone().addScaledVector(_dir, d) };
  }
  let curPose = null, curFrameKey = null;
  function flyTo(pose, { dur = 2.6 } = {}) {
    curPose = pose;
    curFrameKey = activeName ? views[activeName].frameKey?.() ?? null : null;
    const fit = fitPose(pose);
    rig.fromPos.copy(rig.pos); rig.fromTgt.copy(rig.tgt);
    rig.toPos.copy(fit.position); rig.toTgt.copy(fit.target);
    const dist = rig.fromPos.distanceTo(rig.toPos);
    rig.lift = Math.min(28, dist * 0.18);
    rig.dur = dist < 2 ? 1.2 : dur;
    rig.k = 0; rig.orbit = pose.orbit ?? 0.15;
  }
  const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _off = new THREE.Vector3();
  function tickCamera(dt, t) {
    if (rig.k < 1) {
      rig.k = Math.min(1, rig.k + dt / rig.dur);
      const e = ease.inOut(rig.k);
      rig.pos.lerpVectors(rig.fromPos, rig.toPos, e);
      rig.pos.y += Math.sin(Math.PI * e) * rig.lift;
      rig.tgt.lerpVectors(rig.fromTgt, rig.toTgt, ease.inOut(Math.min(1, rig.k * 1.15)));
    }
    // gentle drift: slow orbit around target + bob
    _off.subVectors(rig.pos, rig.tgt);
    const ang = Math.sin(t * 0.11) * rig.orbit + Math.sin(t * 0.047) * rig.orbit * 0.5;
    _off.applyAxisAngle(THREE.Object3D.DEFAULT_UP, ang);
    _p.copy(rig.tgt).add(_off);
    _p.y += Math.sin(t * 0.23) * 0.6;
    const zoom = 1 + Math.sin(t * 0.09) * 0.035;
    _p.sub(rig.tgt).multiplyScalar(zoom).add(rig.tgt);
    _t.copy(rig.tgt);
    if (rig.shake > 0) {
      rig.shake = Math.max(0, rig.shake - dt * 1.6);
      const s = rig.shake * rig.shake * 0.5;
      _p.x += (Math.random() - 0.5) * s; _p.y += (Math.random() - 0.5) * s;
    }
    camera.position.copy(_p);
    camera.lookAt(_t);
  }

  // ---------- resize ----------
  // Camera framing only (cheap). Segment changes call this; they must NOT reallocate render targets.
  function reframe() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.setViewOffset(w, h, w * (0.5 - SUBJECT_X), h * (0.5 - SUBJECT_Y), w, h);
    camera.updateProjectionMatrix();
    if (curPose) {
      const fit = fitPose(curPose);
      rig.toPos.copy(fit.position); rig.toTgt.copy(fit.target);
      if (rig.k >= 1) { rig.pos.copy(rig.toPos); rig.tgt.copy(rig.toTgt); }
    }
  }
  // Full resize: only when the window size or pixel ratio actually changes. Re-creating the composer's
  // render targets blanks the bloom chain for a frame — calling this on every segment change was THE flash bug.
  let lastSize = '';
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const key = `${w}x${h}@${pixelRatio}`;
    if (key === lastSize) { reframe(); return; }
    lastSize = key;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.setViewOffset(w, h, w * (0.5 - SUBJECT_X), h * (0.5 - SUBJECT_Y), w, h);
    camera.updateProjectionMatrix();
    if (curPose) {
      const fit = fitPose(curPose);
      rig.toPos.copy(fit.position); rig.toTgt.copy(fit.target);
      if (rig.k >= 1) { rig.pos.copy(rig.toPos); rig.tgt.copy(rig.toTgt); }
    }
    post.setSize(w, h, pixelRatio);
    world.setPixelRatio(pixelRatio * h / 1080);
    fx.setPixelRatio(pixelRatio * h / 1080);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- loop ----------
  let last = performance.now(), t = 0, errCount = 0;
  let fpsAcc = 0, fpsN = 0, fpsCheckAt = 8;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now;
    t += dt; TIME.value = t;
    try {
      // async-built subjects (state maps) report a new frame key once ready -> reframe to their real bounds
      if (activeName && views[activeName].frameKey) {
        const fk = views[activeName].frameKey();
        if (fk && fk !== curFrameKey) {
          curFrameKey = fk; curPose = views[activeName].pose();
          const fit = fitPose(curPose);
          if (rig.k < 1) { rig.toPos.copy(fit.position); rig.toTgt.copy(fit.target); }
          else flyTo(curPose, { dur: 1.4 });
        }
      }
      tickCamera(dt, t);
      for (const v of Object.values(views)) v.tick(dt, t);
      fx.tick(dt);
      world.tick(dt, t, camera);
      post.render(dt);
    } catch (e) { if (errCount++ < 5) reportErr('frame', e); }
    // adaptive resolution: if we sustain < 48fps, step pixel ratio down
    fpsAcc += dt; fpsN++;
    if (t > fpsCheckAt) {
      const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; fpsCheckAt = t + 5;
      if (fps < 48 && pixelRatio > 1) { pixelRatio = Math.max(1, +(pixelRatio - 0.25).toFixed(2)); resize(); }
      if (document.hidden) fpsCheckAt = t + 10;
    }
  }
  requestAnimationFrame(frame);
  // establishing move
  flyTo(views.pine.pose(), { dur: 4 });

  // ---------- segments ----------
  const HOMETOWN = new Set(['pineplains', 'stanford-council']);
  function viewFor(id) { return HOMETOWN.has(id) ? (views.hometown ? 'hometown' : 'pine') : id === 'balance' ? 'balance' : 'states'; }
  function freshRace(id) {
    if (!state) return null;
    if (id === 'spotlight') return state.spotlight?.[0] || null;
    return state.watch?.find((r) => r.key === id) || null;
  }

  const api = {
    update(s) {
      if (!s) return;
      state = s;
      if (s.now) serverOffset = s.now - Date.now();
      try { views.balance.update(s); } catch (e) { reportErr('balance.update', e); }
      const pp = s.watch?.find((r) => r.key === (seg && HOMETOWN.has(seg.id) ? seg.id : 'pineplains'));
      try { views.pine.update(pp); views.hometown?.update(pp); } catch (e) { reportErr('pine.update', e); }
      if (seg && activeName === 'states') {
        const r = (seg.id === 'spotlight' && seg.race) ? (s.spotlight?.find((x) => x.key === seg.race.key) || seg.race) : freshRace(seg.id);
        try { views.states.update(r); } catch (e) { reportErr('states.update', e); }
      }
      if (!prebuilt && s.watch) {
        prebuilt = true;
        views.states.prebuild(s.watch.filter((r) => r.kind === 'nyt'));
      }
    },
    showSegment(sg) {
      if (!sg) return;
      seg = sg;
      const nr = sg.stageRect || STAGE_RECTS[sg.id] || STAGE_RECT;
      if (!RECT || nr.x0 !== RECT.x0 || nr.x1 !== RECT.x1 || nr.y0 !== RECT.y0 || nr.y1 !== RECT.y1) { setRect(nr); reframe(); }
      const name = viewFor(sg.id);
      const race = (HOMETOWN.has(sg.id) ? freshRace(sg.id) : null) || sg.race || freshRace(sg.id);
      if (activeName && activeName !== name) views[activeName].hide();
      activeName = name;
      try {
        if (name === 'pine' || name === 'hometown') views[name].show(race);
        else if (name === 'balance') { views.balance.show(); if (state) views.balance.update(state); }
        else views.states.show(race);
      } catch (e) { reportErr('showSegment', e); }
      flyTo(views[name].pose());
      post.glitch(0.2); // subtle segment-change transition
    },
    onEvent(ev) {
      if (!ev) return;
      try {
        for (const v of Object.values(views)) v.onEvent?.(ev);
        // big flash/shake only for genuine moments (calls, first results, flips) — not every vote update
        if (ev.priority >= 4 || (ev.priority >= 3 && ['first', 'call', 'flip', 'lead'].includes(ev.type))) {
          const c = ev.party ? partyCol(ev.party) : COL.cyan;
          post.flash(c, ev.priority >= 4 ? 1 : 0.65);
          rig.shake = ev.priority >= 4 ? 1.4 : 0.9;
          const st = (activeName && STATIONS[activeName]) || STATIONS.pine;
          world.shockwave(st.x, st.z, c);
          fx.ring(new THREE.Vector3(st.x, 0.15, st.z), c, { radius: 40, dur: 1.8 });
          if (ev.priority >= 4) fx.burst(new THREE.Vector3(st.x, 6, st.z), c, 700, { speed: 14, up: 10, lifeS: 2.6, sz: 1.4 });
        } // priority-2 events (BOE publishes, safe calls) no longer glitch the screen — read as constant flashing
      } catch (e) { reportErr('onEvent', e); }
    },
  };
  window.__scene = { camera, views, rig, post, world, fx, flyTo, fitPose, api, STAGE_RECT, STAGE_RECTS, get RECT() { return RECT; } };
  return api;
}
