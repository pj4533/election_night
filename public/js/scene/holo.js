// Shared hologram materials, palette, and canvas-text labels.
import * as THREE from 'three';

export const TIME = { value: 0 }; // shared time uniform

export const COL = {
  DEM: new THREE.Color('#2d8cff'), GOP: new THREE.Color('#ff2e55'), OTH: new THREE.Color('#ffab2e'),
  LIB: new THREE.Color('#ffab2e'), GRN: new THREE.Color('#3dff8a'), WRI: new THREE.Color('#8b8aa3'),
  cyan: new THREE.Color('#00f0ff'), magenta: new THREE.Color('#ff2bd6'), pink: new THREE.Color('#ff6ad5'),
  purple: new THREE.Color('#8a2be2'), yellow: new THREE.Color('#ffd23f'), none: new THREE.Color('#4a3f78'),
  white: new THREE.Color('#ffffff'),
};
export const HEX = { DEM: '#2d8cff', GOP: '#ff2e55', OTH: '#ffab2e', WRI: '#8b8aa3', cyan: '#00f0ff', magenta: '#ff2bd6', yellow: '#ffd23f' };
export const partyCol = (p) => COL[p] || COL.OTH;
export const partyHex = (p) => HEX[p] || HEX.OTH;

const holoVert = /* glsl */`
varying vec3 vN; varying float vH; varying vec3 vW;
void main(){
  vN = normalize(mat3(modelMatrix) * normal);
  vH = position.y;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const holoFrag = /* glsl */`
uniform vec3 uColor; uniform vec3 uUp; uniform float uPulse; uniform float uFade; uniform float uTime; uniform float uGlow; uniform float uAlpha;
varying vec3 vN; varying float vH; varying vec3 vW;
void main(){
  vec3 n = normalize(vN);
  float top = smoothstep(0.6, 0.9, dot(n, uUp));
  vec3 v = normalize(cameraPosition - vW);
  float fres = pow(1.0 - abs(dot(v, n)), 2.2);
  float band = smoothstep(0.75, 1.0, sin(vW.y * 9.0 - uTime * 2.6) * 0.5 + 0.5);
  float side = 1.0 - top;
  vec3 c = uColor * mix(0.22 + 0.7 * vH, 1.05, top);
  c += uColor * fres * 0.9 * side;
  c += uColor * band * 0.25 * side;
  c += vec3(1.0, 0.95, 1.0) * uPulse * 0.9;
  float a = (0.5 + 0.45 * top + 0.2 * fres) * uAlpha;
  gl_FragColor = vec4(c * uGlow, clamp(a, 0.0, 1.0) * uFade);
}`;

// upDir: local "up" direction of slabs in world (for tilted maps); default world up.
export function holoMaterial(color, { glow = 1, alpha = 1, up = null } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uPulse: { value: 0 }, uFade: { value: 1 }, uTime: TIME, uGlow: { value: glow }, uAlpha: { value: alpha }, uUp: up || { value: new THREE.Vector3(0, 1, 0) } },
    vertexShader: holoVert,
    fragmentShader: holoFrag,
    transparent: true,
    depthWrite: true,
  });
}

export function lineMaterial(color, opacity = 0.8) {
  return new THREE.LineBasicMaterial({ color: color.clone ? color.clone() : new THREE.Color(color), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
}

// ---------- canvas labels ----------
const LABELS = new Set();
let fontsReady = false;
if (document.fonts?.load) {
  Promise.all([
    document.fonts.load('900 80px Orbitron'), document.fonts.load('700 80px Orbitron'),
    document.fonts.load('700 60px Rajdhani'), document.fonts.load('60px "Share Tech Mono"'),
  ]).then(() => { fontsReady = true; for (const l of LABELS) l.redraw(); }).catch(() => {});
}

// Label: Sprite with a fixed-size canvas; text scaled to fit.
// opts: { w, h (canvas px), height (world units), color, glow, font, sub, subColor, subFont, align }
export function makeLabel(text, opts = {}) {
  const o = { w: 1024, h: 256, height: 1, color: '#ffffff', glow: '#ff2bd6', font: '900 150px Orbitron', sub: null, subColor: '#00f0ff', subFont: '700 64px Rajdhani', align: 'center', bright: 0.72, ...opts };
  const canvas = document.createElement('canvas');
  canvas.width = o.w; canvas.height = o.h;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  mat.color.setScalar(o.bright);
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 50;
  sprite.scale.set(o.height * (o.w / o.h), o.height, 1);
  if (o.align === 'left') sprite.center.set(0, 0.5);
  if (o.align === 'right') sprite.center.set(1, 0.5);
  let cur = { text, sub: o.sub, color: o.color, glow: o.glow };

  function fitFont(font, str, maxW) {
    ctx.font = font;
    const w = ctx.measureText(str).width;
    if (w <= maxW) return font;
    const m = font.match(/(\d+)px/);
    const px = Math.max(10, Math.floor(Number(m[1]) * maxW / w));
    return font.replace(/\d+px/, px + 'px');
  }
  function redraw() {
    ctx.clearRect(0, 0, o.w, o.h);
    const hasSub = cur.sub != null && cur.sub !== '';
    const pad = o.w * 0.05;
    const x = o.align === 'left' ? pad : o.align === 'right' ? o.w - pad : o.w / 2;
    ctx.textAlign = o.align; ctx.textBaseline = 'middle';
    const mainY = hasSub ? o.h * 0.38 : o.h * 0.5;
    ctx.font = fitFont(o.font, cur.text, o.w - pad * 2);
    ctx.shadowColor = cur.glow; ctx.shadowBlur = o.h * 0.09;
    ctx.fillStyle = cur.color;
    ctx.fillText(cur.text, x, mainY);
    ctx.shadowBlur = o.h * 0.03;
    ctx.fillText(cur.text, x, mainY);
    if (hasSub) {
      ctx.font = fitFont(o.subFont, cur.sub, o.w - pad * 2);
      ctx.shadowColor = cur.subColor || cur.glow; ctx.shadowBlur = o.h * 0.05;
      ctx.fillStyle = o.subColor;
      ctx.fillText(cur.sub, x, o.h * 0.8);
    }
    tex.needsUpdate = true;
  }
  redraw();
  const api = {
    sprite,
    set(text2, sub2 = cur.sub, color2 = cur.color, glow2 = cur.glow) {
      if (text2 === cur.text && sub2 === cur.sub && color2 === cur.color && glow2 === cur.glow) return;
      cur = { text: text2, sub: sub2, color: color2, glow: glow2 }; redraw();
    },
    redraw,
    get opacity() { return mat.opacity; },
    set opacity(v) { mat.opacity = v; },
    dispose() { LABELS.delete(api); tex.dispose(); mat.dispose(); },
  };
  LABELS.add(api);
  return api;
}

export const ease = {
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  out: (k) => 1 - Math.pow(1 - k, 3),
  back: (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
};
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));

export function disposeTree(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose?.();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose?.(); m.dispose?.(); });
  });
}
