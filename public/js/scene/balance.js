// Balance of power: 100-seat Senate hemicycle + 435-dot House arc behind it.
import * as THREE from 'three';
import { COL, makeLabel, clamp01, damp } from './holo.js';

function hemicycle(total, rows, r0, r1) {
  const radii = Array.from({ length: rows }, (_, i) => r0 + ((r1 - r0) * i) / (rows - 1));
  const sum = radii.reduce((a, b) => a + b, 0);
  const counts = radii.map((r) => Math.round((total * r) / sum));
  let diff = total - counts.reduce((a, b) => a + b, 0);
  for (let i = rows - 1; diff !== 0; i = (i - 1 + rows) % rows) { counts[i] += Math.sign(diff); diff -= Math.sign(diff); }
  const seats = [];
  radii.forEach((r, i) => {
    const n = counts[i];
    for (let j = 0; j < n; j++) { const a = Math.PI - (Math.PI * j) / Math.max(1, n - 1); seats.push({ a, r, x: Math.cos(a) * r, y: Math.sin(a) * r }); }
  });
  seats.sort((p, q) => (q.a - p.a) || (p.r - q.r)); // left (a=PI) to right (a=0)
  return seats;
}

const UNDECIDED = new THREE.Color(0.13, 0.1, 0.28);

export function createBalanceView({ scene, fx, station }) {
  const root = new THREE.Group(); root.position.copy(station); root.visible = false; scene.add(root);
  const CY = 2.2;

  function makeArc(total, rows, r0, r1, rad, z) {
    const seats = hemicycle(total, rows, r0, r1);
    const geo = new THREE.IcosahedronGeometry(rad, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
    const mesh = new THREE.InstancedMesh(geo, mat, total);
    const m4 = new THREE.Matrix4();
    seats.forEach((s, i) => { m4.makeTranslation(s.x, CY + s.y, z); mesh.setMatrixAt(i, m4); mesh.setColorAt(i, UNDECIDED); });
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    root.add(mesh);
    return { seats, mesh, cur: seats.map(() => UNDECIDED.clone()), tgt: seats.map(() => UNDECIDED.clone()), kind: seats.map(() => 'U'), flash: seats.map(() => 0), z, rad };
  }
  const senate = makeArc(100, 6, 3.6, 7.4, 0.3, 0);
  const house = makeArc(435, 11, 8.6, 12.4, 0.13, -1.8);

  // control markers (vertical beams at top center)
  function beam(h0, h1, z, color) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, CY + h0, z), new THREE.Vector3(0, CY + h1, z)]);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(2.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    root.add(l); return l;
  }
  const sBeam = beam(3.0, 8.1, 0.4, COL.yellow);
  const hBeam = beam(8.2, 13.0, -1.6, COL.yellow);
  // floor arcs
  const floorArc = new THREE.Mesh(new THREE.RingGeometry(12.9, 13.05, 128, 1, 0, Math.PI), new THREE.MeshBasicMaterial({ color: COL.cyan.clone().multiplyScalar(1.5), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  floorArc.position.set(0, CY, -1.9); root.add(floorArc);
  const baseLine = new THREE.Mesh(new THREE.PlaneGeometry(27, 0.06), floorArc.material.clone());
  baseLine.material.color.copy(COL.magenta).multiplyScalar(2); baseLine.position.set(0, CY - 0.45, 0); root.add(baseLine);

  const lblTitle = makeLabel('SENATE', { height: 1.4, sub: 'BALANCE OF POWER', glow: '#ff2bd6', subColor: '#00f0ff' });
  lblTitle.sprite.position.set(0, CY + 1.9, 0.5); root.add(lblTitle.sprite);
  const lblDem = makeLabel('DEM 0', { height: 1.5, font: '900 160px Orbitron', glow: '#2d8cff', color: '#e6f1ff', sub: '', subColor: '#9cc8ff' });
  lblDem.sprite.position.set(-5.6, CY - 1.35, 0.6); root.add(lblDem.sprite);
  const lblGop = makeLabel('GOP 0', { height: 1.5, font: '900 160px Orbitron', glow: '#ff2e55', color: '#ffe6ea', sub: '', subColor: '#ffadbb' });
  lblGop.sprite.position.set(5.6, CY - 1.35, 0.6); root.add(lblGop.sprite);
  const lblMid = makeLabel('', { height: 1.0, font: '700 110px Rajdhani', glow: '#ffd23f', color: '#fff4cc' });
  lblMid.sprite.position.set(0, CY + 8.6, 0.4); root.add(lblMid.sprite);
  const lblHouse = makeLabel('HOUSE', { height: 1.5, font: '700 120px Orbitron', glow: '#00f0ff', color: '#e8fbff', sub: '', subColor: '#ffd23f' });
  lblHouse.sprite.position.set(0, CY + 13.8, -1.8); root.add(lblHouse.sprite);
  const labels = [lblTitle, lblDem, lblGop, lblMid, lblHouse];

  let visible = false, fade = 0, tShow = 0, hasData = false;

  function assign(arc, pb, total) {
    const d = pb?.DEM?.seats || 0, g = pb?.GOP?.seats || 0, o = pb?.OTH?.seats || 0;
    const dNo = pb?.DEM?.no_election || 0, gNo = pb?.GOP?.no_election || 0;
    const n = arc.seats.length;
    for (let i = 0; i < n; i++) {
      let k, c;
      if (i < d) { k = i < dNo ? 'D0' : 'D'; c = COL.DEM.clone().multiplyScalar(k === 'D' ? 1.9 : 1.05); }
      else if (i < d + o) { k = 'O'; c = COL.OTH.clone().multiplyScalar(1.4); }
      else if (i >= n - g) { k = (n - 1 - i) < gNo ? 'G0' : 'G'; c = COL.GOP.clone().multiplyScalar(k === 'G' ? 1.9 : 1.05); }
      else { k = 'U'; c = UNDECIDED.clone(); }
      if (hasData && arc.kind[i] !== k && k !== 'U') arc.flash[i] = 1;
      arc.kind[i] = k; arc.tgt[i].copy(c);
    }
    return { d, g, o, u: Math.max(0, total - d - g - o) };
  }

  function setData(state) {
    const S = state?.partyControl?.S, H = state?.partyControl?.H;
    const sb = assign(senate, S?.party_balance, 100);
    const hb = assign(house, H?.party_balance, 435);
    const sw = S?.to_win || {};
    lblDem.set(`DEM ${sb.d}`, sb.o ? `+${sb.o} IND` : `${sw.DEM ?? 51} FOR CONTROL`);
    lblGop.set(`GOP ${sb.g}`, `${sw.GOP ?? 50} FOR CONTROL`);
    lblMid.set(`${sb.u} SEATS UNDECIDED · ${S?.num_races_called ?? 0} CALLED`);
    const hw = H?.to_win?.DEM ?? 218;
    lblHouse.set('HOUSE', `DEM ${hb.d} · GOP ${hb.g}${hb.o ? ` · IND ${hb.o}` : ''} · ${hw} TO WIN`);
    hasData = true;
  }

  const tmp = new THREE.Color();
  function tickArc(arc, t, delayScale) {
    const n = arc.seats.length;
    const k = 1 - Math.exp(-6 * 0.016);
    for (let i = 0; i < n; i++) {
      // reveal outward from both ends
      const order = Math.min(i, n - 1 - i) / (n / 2);
      const on = clamp01((tShow - 0.3 - order * delayScale) / 0.25);
      tmp.copy(UNDECIDED).lerp(arc.tgt[i], on);
      const kd = arc.kind[i];
      if (kd === 'D' || kd === 'G') tmp.multiplyScalar(0.85 + 0.25 * Math.sin(t * 3 + i));
      if (kd === 'U') tmp.multiplyScalar(0.8 + 0.6 * Math.max(0, Math.sin(t * 1.3 + i * 0.7)) ** 8);
      if (arc.flash[i] > 0) { tmp.lerp(COL.white, arc.flash[i]).multiplyScalar(1 + arc.flash[i] * 2); arc.flash[i] = Math.max(0, arc.flash[i] - 0.016 * 0.7); }
      arc.cur[i].lerp(tmp, k);
      tmp.copy(arc.cur[i]).multiplyScalar(fade);
      arc.mesh.setColorAt(i, tmp);
    }
    arc.mesh.instanceColor.needsUpdate = true;
  }

  return {
    root,
    pose() {
      const tgt = station.clone().add(new THREE.Vector3(0, 8.6, 0));
      const box = new THREE.Box3(station.clone().add(new THREE.Vector3(-13.3, 0.3, -2.2)), station.clone().add(new THREE.Vector3(13.3, CY + 15.0, 1.2)));
      return { target: tgt, position: tgt.clone().add(new THREE.Vector3(0, 2.5, 41)), orbit: 0.1, box };
    },
    show() { if (visible) return; visible = true; root.visible = true; tShow = 0; for (const a of [senate, house]) for (const c of a.cur) c.copy(UNDECIDED); },
    hide() { visible = false; },
    update(state) { setData(state); },
    tick(dt, t) {
      fade = damp(fade, visible ? 1 : 0, visible ? 2.5 : 4, dt);
      if (!visible && fade < 0.01) { root.visible = false; return; }
      tShow += dt;
      tickArc(senate, t, 1.6);
      tickArc(house, t, 2.2);
      for (const l of labels) l.opacity = fade * clamp01((tShow - 0.4) * 2);
      sBeam.material.opacity = hBeam.material.opacity = fade * (0.6 + 0.4 * Math.sin(t * 4));
      floorArc.material.opacity = 0.7 * fade; baseLine.material.opacity = fade;
      root.rotation.y = Math.sin(t * 0.17) * 0.07;
    },
    onEvent(ev) {
      if (ev?.type === 'call' && visible) fx.burst(root.position.clone().add(new THREE.Vector3(0, CY + 6, 0)), ev.party === 'GOP' ? COL.GOP : ev.party === 'DEM' ? COL.DEM : COL.yellow, 300, { speed: 9, up: 4, gravity: 3 });
    },
  };
}
