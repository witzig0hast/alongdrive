// Himmel: Farbverlauf, Sonne, Mond, Sterne, Nebel, Licht – gesteuert durch Tageszeit und Sandsturm.
import * as THREE from 'three';
import { smooth, lerp, clamp, mulberry32 } from '../core/rng.js';
import { hourOf, sunDirection, sunElevation, stormIntensity, ambientTemp } from './weather.js';

const C = (r, g, b) => new THREE.Color(r, g, b);
const NIGHT_Z = C(0.004, 0.008, 0.03);
const NIGHT_H = C(0.02, 0.03, 0.06);
const DAY_Z = C(0.22, 0.42, 0.78);
const DAY_H = C(0.78, 0.74, 0.64);
const DUSK = C(0.95, 0.42, 0.18);
const STORM_C = C(0.5, 0.34, 0.2);

export class Sky {
  constructor(scene, camera, quality) {
    this.scene = scene;
    this.camera = camera;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.state = { hour: 7, storm: 0, night: 0, elevation: 1, temp: 25, sunScreen: new THREE.Vector2(), glare: 0 };

    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 0.85, 0.6) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        varying vec3 vDir; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor;
        void main(){
          float h = max(vDir.y, 0.0);
          vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
          float sd = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
          col += uSunColor * (pow(sd, 900.0) * 3.0 + pow(sd, 40.0) * 0.45 + pow(sd, 6.0) * 0.18);
          if (vDir.y < 0.0) col = mix(uHorizon, uHorizon*0.85, clamp(-vDir.y*4.0, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    // Sterne
    const n = 1400;
    const pos = new Float32Array(n * 3);
    const r = mulberry32(7);
    for (let i = 0; i < n; i++) {
      const u = r() * 2 - 1;
      const a = r() * Math.PI * 2;
      const y = Math.abs(u) * 0.95 + 0.03;
      const s = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * s;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.sin(a) * s;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    scene.add(this.stars);

    this.moon = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: 0xe8ecf4, fog: false, depthWrite: false }));
    this.moon.frustumCulled = false;
    this.moon.renderOrder = -8;
    scene.add(this.moon);

    // Lichter
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = quality.shadows;
    const sc = this.sun.shadow.camera;
    const ext = quality.shadowSize >= 2048 ? 90 : 60;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.near = 1;
    sc.far = 400;
    this.shadowExt = ext;
    this.sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xaac4ff, 0xb59a6a, 0.6);
    scene.add(this.hemi);

    scene.fog = new THREE.Fog(0xcccccc, 100, 600);
    this.viewDist = 600;
    this._c1 = new THREE.Color();
    this._c2 = new THREE.Color();
    this._tmp = new THREE.Vector3();
  }

  setViewDistance(d) {
    this.viewDist = d;
  }

  update(gameTime, seedStr, focus) {
    const st = this.state;
    const hour = hourOf(gameTime);
    const storm = stormIntensity(seedStr, gameTime);
    sunDirection(hour, this.sunDir);
    const e = sunElevation(hour);
    const d = smooth(-0.08, 0.3, e);
    const night = 1 - smooth(-0.25, 0.02, e);
    const dusk = clamp(1 - Math.abs(e) / 0.3, 0, 1) * (e > -0.15 ? 1 : 0);
    st.hour = hour;
    st.storm = storm;
    st.night = night;
    st.elevation = e;
    st.temp = ambientTemp(hour, storm);

    const z = this._c1.copy(NIGHT_Z).lerp(DAY_Z, d);
    const hz = this._c2.copy(NIGHT_H).lerp(DAY_H, d);
    hz.lerp(DUSK, dusk * 0.75);
    z.lerp(DUSK, dusk * 0.18);
    const stormTint = storm * 0.88;
    const dark = lerp(1, 0.55, storm);
    z.lerp(STORM_C, stormTint).multiplyScalar(lerp(1, dark, storm));
    hz.lerp(STORM_C, stormTint).multiplyScalar(lerp(1, dark, storm) * (night > 0.5 ? 0.5 : 1));
    this.uniforms.uZenith.value.copy(z);
    this.uniforms.uHorizon.value.copy(hz);
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.uniforms.uSunColor.value.setRGB(1, lerp(0.55, 0.9, d), lerp(0.25, 0.7, d)).multiplyScalar(1 - storm * 0.9);

    // Kamera-Bezug
    const cp = this.camera.position;
    const far = this.camera.far;
    this.dome.position.copy(cp);
    this.dome.scale.setScalar(far * 0.9);
    this.stars.position.copy(cp);
    this.stars.scale.setScalar(far * 0.88);
    this.stars.rotation.y = gameTime * 0.0006;
    this.stars.rotation.z = 0.4;
    this.stars.material.opacity = clamp(night * 1.2, 0, 1) * (1 - storm);
    this.moon.position.copy(cp).addScaledVector(this.sunDir, -far * 0.85);
    this.moon.scale.setScalar(far * 0.85);
    this.moon.visible = night > 0.1;

    // Lichter
    const sunUp = this.sunDir.y > 0;
    this._tmp.copy(this.sunDir);
    if (!sunUp) this._tmp.multiplyScalar(-1); // Mond
    const sunI = smooth(-0.02, 0.28, e) * 3.1;
    const moonI = 0.6 * (1 - smooth(-0.2, 0.0, e));
    this.sun.intensity = (sunUp ? sunI : moonI) * (1 - storm * 0.55);
    this.sun.color.setRGB(1, lerp(0.62, 0.96, smooth(0.0, 0.5, e)), lerp(0.35, 0.88, smooth(0.0, 0.5, e)));
    if (!sunUp) this.sun.color.setRGB(0.55, 0.65, 1.0);
    const target = focus || cp;
    // Schatten-Kamera um den Fokus herum (Texel-Snapping gegen Flimmern)
    const snap = (this.shadowExt * 2) / this.sun.shadow.mapSize.x;
    const tx = Math.round(target.x / snap) * snap;
    const tz = Math.round(target.z / snap) * snap;
    this.sun.target.position.set(tx, target.y, tz);
    this.sun.position.set(tx + this._tmp.x * 150, target.y + Math.max(this._tmp.y, 0.15) * 150, tz + this._tmp.z * 150);
    this.sun.target.updateMatrixWorld();
    this.hemi.color.copy(z).lerp(new THREE.Color(1, 1, 1), 0.35);
    this.hemi.groundColor.setRGB(0.55, 0.45, 0.3).multiplyScalar(lerp(0.12, 1, d));
    this.hemi.intensity = lerp(0.38, 0.85, d) * (1 - storm * 0.3);

    // Nebel
    const fogCol = this.scene.fog.color;
    fogCol.copy(hz);
    this.scene.fog.near = lerp(this.viewDist * 0.18, 4, storm);
    this.scene.fog.far = lerp(this.viewDist, 75, storm);
    this.scene.background = null;

    // Blendung: Sonnenposition auf dem Bildschirm
    const sp = this._tmp.copy(cp).addScaledVector(this.sunDir, 100).project(this.camera);
    st.sunScreen.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
    const facing = sp.z < 1 ? 1 : 0;
    st.glare = facing * smooth(0.0, 0.2, this.sunDir.y) * (1 - storm);
  }
}
