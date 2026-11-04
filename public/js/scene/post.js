// Post-processing: bloom + chromatic aberration / glitch / vignette / grain + flash.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TIME } from './holo.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: TIME, uFlash: { value: 0 }, uFlashCol: { value: new THREE.Color(1, 1, 1) },
    uCA: { value: 0 }, uGlitch: { value: 0 }, uRes: { value: new THREE.Vector2(1920, 1080) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uFlash; uniform vec3 uFlashCol; uniform float uCA; uniform float uGlitch; uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      // glitch: horizontal slice displacement
      float row = floor(uv.y * 48.0);
      float gl = step(1.0 - 0.18 * uGlitch, hash(vec2(row, floor(uTime * 24.0))));
      uv.x += gl * (hash(vec2(row, uTime)) - 0.5) * 0.06 * uGlitch;
      vec2 c = uv - 0.5; float r2 = dot(c, c);
      float ca = (0.0022 + uCA * 0.03) * (0.3 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca).b;
      col += uFlashCol * uFlash * (0.25 + r2 * 1.2);
      float vig = smoothstep(0.75, 0.12, r2);
      col *= mix(0.5, 1.0, vig);
      float n = hash(uv * uRes + fract(uTime * 7.0) * 100.0);
      col += (n - 0.5) * 0.022;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export function createPost(renderer, scene, camera, { samples = 0 } = {}) {
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();
  const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.5, 0.35, 0.8);
  composer.addPass(bloom);
  const fin = new ShaderPass(FinalShader);
  composer.addPass(fin);
  composer.addPass(new OutputPass());
  const base = { strength: 0.5 }; // toned down: labels were unreadable
  let flash = 0, ca = 0, glitch = 0;
  return {
    composer, bloom,
    setSize(w, h, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(w, h);
      bloom.setSize(Math.round(w * pixelRatio / 2), Math.round(h * pixelRatio / 2));
      fin.uniforms.uRes.value.set(w * pixelRatio, h * pixelRatio);
    },
    flash(color, amount = 0.6) {
      fin.uniforms.uFlashCol.value.copy(color || new THREE.Color(1, 1, 1));
      flash = Math.max(flash, amount); ca = Math.max(ca, 1); glitch = Math.max(glitch, 1);
    },
    glitch(amount = 0.6) { glitch = Math.max(glitch, amount); ca = Math.max(ca, amount * 0.6); },
    render(dt) {
      flash = Math.max(0, flash - dt * 1.4); ca = Math.max(0, ca - dt * 1.2); glitch = Math.max(0, glitch - dt * 2.2);
      fin.uniforms.uFlash.value = flash * flash;
      fin.uniforms.uCA.value = ca;
      fin.uniforms.uGlitch.value = glitch;
      bloom.strength = base.strength + flash * 0.5;
      composer.render(dt);
    },
  };
}
