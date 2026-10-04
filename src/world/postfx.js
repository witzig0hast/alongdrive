// Nachbearbeitung: Wärmeflimmern, Sonnenblendung, ausgeblichener Look, Vignette, Schadens-/Kälteeffekte.
import * as THREE from 'three';

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uTime, uHeat, uHorizonY, uGlare, uDust, uDamage, uCold, uDesat, uNight;
uniform vec2 uSun, uRes;
uniform vec3 uDustColor;
float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
void main(){
  vec2 uv = vUv;
  // Wärmeflimmern am Horizont
  float band = exp(-pow((uv.y - uHorizonY) / 0.11, 2.0));
  float wob = sin(uv.y * 160.0 + uTime * 2.6) * 0.5 + sin(uv.y * 71.0 - uTime * 1.9 + uv.x * 9.0) * 0.5;
  uv.x += wob * 0.0016 * uHeat * band;
  uv.y += sin(uv.x * 90.0 + uTime * 2.2) * 0.0007 * uHeat * band;
  // Sandsturm: leichte Verzerrung
  uv += (vec2(hash(uv * 80.0 + uTime), hash(uv * 80.0 - uTime)) - 0.5) * 0.002 * uDust;
  vec3 c = texture2D(tDiffuse, uv).rgb;
  // ausgebleichter, staubiger Look
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.0 - uDesat);
  c = mix(c, c * vec3(1.06, 1.0, 0.88), 0.6);
  c = (c - 0.5) * 1.06 + 0.5 + 0.015;
  // Sonnenblendung
  vec2 d = (uv - uSun) * vec2(uRes.x / uRes.y, 1.0);
  float r = length(d);
  float g = (exp(-r * 4.0) * 0.55 + exp(-r * 12.0) * 0.5 + exp(-r * 1.4) * 0.12) * uGlare;
  c += vec3(1.0, 0.82, 0.55) * g;
  // Sandsturm-Dunst
  c = mix(c, uDustColor, uDust * 0.28);
  // Kälte / Schaden
  c = mix(c, c * vec3(0.78, 0.9, 1.15), uCold);
  c = mix(c, vec3(0.6, 0.02, 0.02) + c * 0.4, uDamage * 0.55);
  // Vignette
  vec2 q = vUv - 0.5;
  float vig = smoothstep(0.85, 0.2, length(q) * (1.0 + uNight * 0.2));
  c *= mix(0.58, 1.0, vig);
  c += (hash(vUv * uRes + uTime) - 0.5) * 0.018;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

export class PostFX {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.enabled = quality.post;
    this.samples = quality.msaa;
    this.rt = null;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, uTime: { value: 0 }, uHeat: { value: 0 }, uHorizonY: { value: 0.5 },
        uGlare: { value: 0 }, uDust: { value: 0 }, uDamage: { value: 0 }, uCold: { value: 0 }, uDesat: { value: 0.22 },
        uNight: { value: 0 }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uRes: { value: new THREE.Vector2(1, 1) },
        uDustColor: { value: new THREE.Color(0.7, 0.5, 0.3) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.qScene = new THREE.Scene();
    this.qScene.add(this.quad);
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h) {
    const pr = this.renderer.getPixelRatio();
    const W = Math.floor(w * pr);
    const H = Math.floor(h * pr);
    this.material.uniforms.uRes.value.set(W, H);
    if (this.rt) this.rt.dispose();
    this.rt = new THREE.WebGLRenderTarget(W, H, { samples: this.samples, depthBuffer: true });
  }

  render(scene, camera, vmScene, fx) {
    const r = this.renderer;
    if (!this.enabled) {
      r.setRenderTarget(null);
      r.autoClear = true;
      r.render(scene, camera);
      if (vmScene) {
        r.autoClear = false;
        r.clearDepth();
        r.render(vmScene, camera);
        r.autoClear = true;
      }
      return;
    }
    const u = this.material.uniforms;
    u.uTime.value = fx.time;
    u.uHeat.value = fx.heat;
    u.uHorizonY.value = fx.horizonY;
    u.uGlare.value = fx.glare;
    u.uSun.value.copy(fx.sun);
    u.uDust.value = fx.dust;
    u.uDamage.value = fx.damage;
    u.uCold.value = fx.cold;
    u.uNight.value = fx.night;
    u.uDustColor.value.copy(fx.dustColor);
    r.setRenderTarget(this.rt);
    r.autoClear = true;
    r.render(scene, camera);
    if (vmScene) {
      r.autoClear = false;
      r.clearDepth();
      r.render(vmScene, camera);
      r.autoClear = true;
    }
    u.tDiffuse.value = this.rt.texture;
    r.setRenderTarget(null);
    r.render(this.qScene, this.qCam);
  }
}
