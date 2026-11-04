// Persistent synthwave world: sky, sun, stars, mountains, infinite neon grid, drifting dust.
import * as THREE from 'three';
import { TIME } from './holo.js';

const SUN_YAW = -0.22;     // radians right of -Z
const SUN_DIST = 1500;

export function createWorld(scene) {
  const fogCol = new THREE.Color(0.13, 0.015, 0.13);
  const accent = { value: new THREE.Color('#ff2bd6') };
  const pulse = { value: 0 }, pulseCol = { value: new THREE.Color('#00f0ff') }, pulseOrigin = { value: new THREE.Vector2() }, pulseR = { value: 0 };

  // ---- sky dome ----
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3000, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { uTime: TIME },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uTime; varying vec3 vDir;
        void main(){
          float h = vDir.y;
          vec3 top = vec3(0.004, 0.0, 0.018);
          vec3 mid = vec3(0.03, 0.004, 0.08);
          vec3 hor = vec3(0.16, 0.018, 0.15);
          vec3 c = mix(hor, mid, smoothstep(-0.02, 0.16, h));
          c = mix(c, top, smoothstep(0.14, 0.7, h));
          // faint aurora band
          float a = sin(vDir.x * 6.0 + uTime * 0.05) * 0.5 + 0.5;
          c += vec3(0.0, 0.05, 0.08) * smoothstep(0.18, 0.3, h) * smoothstep(0.55, 0.3, h) * a;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  sky.renderOrder = -10;
  scene.add(sky);

  // ---- stars ----
  const N_STARS = 2200;
  const sp = new Float32Array(N_STARS * 3), ss = new Float32Array(N_STARS);
  for (let i = 0; i < N_STARS; i++) {
    const th = Math.random() * Math.PI * 2, y = 0.04 + Math.pow(Math.random(), 0.8) * 0.96;
    const r = Math.sqrt(1 - y * y);
    sp[i * 3] = Math.cos(th) * r * 2600; sp[i * 3 + 1] = y * 2600; sp[i * 3 + 2] = Math.sin(th) * r * 2600;
    ss[i] = Math.random();
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  starGeo.setAttribute('aSeed', new THREE.BufferAttribute(ss, 1));
  const stars = new THREE.Points(starGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: TIME, uPx: { value: 1 } },
    vertexShader: `attribute float aSeed; uniform float uTime; uniform float uPx; varying float vA;
      void main(){ vA = (0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (0.6 + aSeed * 2.2) + aSeed * 40.0))) * (0.3 + aSeed * 0.7);
        vA *= smoothstep(0.03, 0.2, normalize(position).y);
        gl_PointSize = (1.0 + aSeed * 2.2) * uPx; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard; gl_FragColor = vec4(vec3(0.85,0.8,1.0) * vA * (1.0 - d * 2.0) * 1.6, 1.0); }`,
  }));
  stars.renderOrder = -9;
  scene.add(stars);

  // ---- sun ----
  const sun = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: TIME },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        void main(){
          vec2 p = (vUv - 0.5) * 2.0 * 1.7;   // disc radius 1 inside a 1.7 half-size quad
          float r = length(p);
          float y = p.y * 0.5 + 0.5;          // 0 bottom .. 1 top of disc
          vec3 col = mix(vec3(1.0, 0.05, 0.45), vec3(1.0, 0.82, 0.18), smoothstep(0.0, 1.0, y));
          float disc = smoothstep(1.0, 0.985, r);
          // stripes on the lower part, gaps widen toward bottom and scroll down
          float cut = 1.0;
          if (y < 0.58) {
            float f = fract(y * 11.0 + uTime * 0.12);
            float gap = mix(0.62, 0.06, y / 0.58);
            cut = smoothstep(gap - 0.02, gap + 0.02, f);
          }
          vec3 c = col * disc * cut * 0.95;
          float halo = exp(-max(r - 1.0, 0.0) * 4.0) * (1.0 - disc) * 0.22;
          c += mix(vec3(1.0, 0.1, 0.6), vec3(1.0, 0.5, 0.3), y) * halo;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  sun.scale.setScalar(190 * 2 * 1.7);
  sun.renderOrder = -8;
  scene.add(sun);

  // ---- mountains (fixed in world, huge) ----
  function ridge(seed, width, depth, height, z, color, opacity) {
    const geo = new THREE.PlaneGeometry(width, depth, 120, 14);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), zz = pos.getZ(i);
      const back = (0.5 - zz / depth); // 0 front edge .. 1 back edge
      const n = Math.abs(Math.sin(x * 0.006 + seed) * 0.6 + Math.sin(x * 0.017 + seed * 3.1) * 0.3 + Math.sin(x * 0.041 + seed * 7.0) * 0.15);
      const valley = THREE.MathUtils.smoothstep(Math.abs(x - 330), 140, 620); // opening for the sun
      const h = height * n * Math.sin(Math.min(1, back * 1.25) * Math.PI) * (0.25 + 0.75 * valley);
      pos.setY(i, h);
    }
    geo.computeVertexNormals();
    const solid = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x07011a }));
    const wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    const g = new THREE.Group(); g.add(solid, wire); g.position.z = z;
    solid.renderOrder = -7; wire.renderOrder = -6;
    return g;
  }
  const mountains = new THREE.Group();
  mountains.add(ridge(1.3, 3600, 260, 170, -1050, new THREE.Color(0.9, 0.1, 0.9), 0.35));
  mountains.add(ridge(4.7, 3600, 200, 95, -760, new THREE.Color(0.0, 0.6, 1.0), 0.28));
  scene.add(mountains);

  // ---- grid floor (follows camera; pattern in world space) ----
  const gridMat = new THREE.ShaderMaterial({
    uniforms: { uTime: TIME, uFog: { value: fogCol }, uAccent: accent, uPulse: pulse, uPulseCol: pulseCol, uPulseOrigin: pulseOrigin, uPulseR: pulseR },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uFog; uniform vec3 uAccent; uniform float uPulse; uniform vec3 uPulseCol; uniform vec2 uPulseOrigin; uniform float uPulseR;
      varying vec3 vW;
      float grid(vec2 p, float w){ vec2 d = fwidth(p); vec2 g = abs(fract(p - 0.5) - 0.5) / (d * w); float l = 1.0 - min(min(g.x, g.y), 1.0); return l * (1.0 - clamp(max(d.x, d.y) * 1.4, 0.0, 0.85)); }
      void main(){
        vec2 p = vW.xz / 3.0; p.y -= uTime * 0.9;
        float l = grid(p, 1.3);
        vec2 p2 = vW.xz / 30.0; p2.y -= uTime * 0.09;
        float l2 = grid(p2, 2.2);
        float d = distance(vW.xz, cameraPosition.xz);
        float fade = exp(-d * 0.0042);
        vec3 base = vec3(0.012, 0.0, 0.035);
        vec3 lc = mix(vec3(0.0, 0.75, 1.0), uAccent, smoothstep(10.0, 220.0, d));
        vec3 c = base + lc * l * 0.85 + uAccent * l2 * 1.1;
        // shockwave ring across the floor
        float pr = distance(vW.xz, uPulseOrigin);
        float ring = exp(-pow((pr - uPulseR) / 2.2, 2.0)) * uPulse;
        c += uPulseCol * ring * (0.6 + l * 3.0);
        c = mix(uFog, c, fade);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000, 1, 1), gridMat);
  grid.rotation.x = -Math.PI / 2;
  grid.renderOrder = -5;
  scene.add(grid);

  // ---- drifting dust (GPU wrapped around camera) ----
  const N_DUST = 1400, BOX = 90;
  const dp = new Float32Array(N_DUST * 3), ds = new Float32Array(N_DUST);
  for (let i = 0; i < N_DUST; i++) { dp[i * 3] = Math.random() * BOX; dp[i * 3 + 1] = Math.random() * 40; dp[i * 3 + 2] = Math.random() * BOX; ds[i] = Math.random(); }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(ds, 1));
  const dustMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: TIME, uCam: { value: new THREE.Vector3() }, uPx: { value: 1 } },
    vertexShader: `attribute float aSeed; uniform float uTime; uniform vec3 uCam; uniform float uPx; varying float vA; varying float vS;
      void main(){
        vec3 p = position;
        p.y = mod(p.y + uTime * (0.3 + aSeed * 0.8), 40.0);
        p.x += sin(uTime * 0.2 + aSeed * 30.0) * 2.0;
        p.xz = mod(p.xz - uCam.xz, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)} + uCam.xz;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = smoothstep(0.0, 4.0, p.y) * smoothstep(40.0, 30.0, p.y) * smoothstep(48.0, 10.0, -mv.z) * (0.3 + 0.7 * aSeed);
        vS = aSeed;
        gl_PointSize = (2.0 + aSeed * 4.0) * uPx * (30.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA; varying float vS; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
      vec3 c = mix(vec3(0.0, 0.9, 1.0), vec3(1.0, 0.2, 0.85), step(0.5, vS));
      gl_FragColor = vec4(c * vA * (1.0 - d * 2.0) * 0.9, 1.0); }`,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);

  return {
    accent,
    setPixelRatio(pr) { stars.material.uniforms.uPx.value = pr; dustMat.uniforms.uPx.value = pr; },
    shockwave(x, z, color) {
      pulseOrigin.value.set(x, z); pulseR.value = 0; pulse.value = 1;
      pulseCol.value.copy(color || new THREE.Color('#00f0ff'));
    },
    tick(dt, t, camera) {
      const c = camera.position;
      sky.position.copy(c); stars.position.copy(c);
      sun.position.set(c.x + Math.sin(-SUN_YAW) * SUN_DIST, 150, c.z - Math.cos(SUN_YAW) * SUN_DIST);
      sun.lookAt(c.x, 150, c.z);
      grid.position.set(c.x, 0, c.z);
      dustMat.uniforms.uCam.value.copy(c);
      if (pulse.value > 0) { pulseR.value += dt * 55; pulse.value = Math.max(0, pulse.value - dt * 0.45); }
    },
  };
}
