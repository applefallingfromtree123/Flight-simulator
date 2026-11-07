// Visual effects layered on the scene: animated rain / snow (streaks outside, drops running over the windshield in
// the cockpit), a sun lens flare, and contrails behind jet engines in the cold air at altitude.
import * as Cesium from 'cesium';
import type { Aircraft } from '../sim/fdm.ts';
import { FT, KT } from '../core/math.ts';

const PRECIP_FS = /* glsl */ `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform float time;
uniform float intensity;   // 0..1
uniform float snow;        // 0 rain, 1 snow
uniform float cockpit;     // 1 = looking through the windshield
uniform float airspeed;    // 0..1 (drives the slant and how fast drops run)
in vec2 v_textureCoordinates;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

void main() {
  vec2 uv = v_textureCoordinates;
  vec2 res = czm_viewport.zw;
  float aspect = res.x / max(res.y, 1.0);
  // only beyond the windshield (the cockpit interior is a few metres away)
  float depth = czm_readDepth(depthTexture, uv);
  float outside = depth >= 1.0 ? 1.0 : smoothstep(4.0, 7.0, -czm_windowToEyeCoordinates(gl_FragCoord.xy, depth).z);
  vec2 offs = vec2(0.0);
  float glint = 0.0;
  // windshield drops: round beads that refract the view and get blown up and outwards with airspeed
  if (cockpit > 0.5 && snow < 0.5) {
    vec2 p = vec2(uv.x * aspect, uv.y) * 9.0;
    p.y -= time * (0.15 + airspeed * 2.2);
    p.x += (uv.x - 0.5) * airspeed * time * 0.6;
    vec2 id = floor(p), f = fract(p) - 0.5;
    float h = hash(id);
    if (h < intensity * 0.9) {
      vec2 c = vec2(hash(id + 3.1) - 0.5, hash(id + 7.7) - 0.5) * 0.5;
      vec2 d = f - c;
      d.y *= 1.0 + airspeed * 2.5;            // stretched into streaks at speed
      float r = 0.08 + 0.1 * hash(id + 1.3);
      float m = smoothstep(r, r * 0.6, length(d));
      offs += d * m * 0.06 * outside;
      glint += m * smoothstep(0.02, -0.03, d.y - d.x) * 0.25 * outside;
    }
  }
  vec4 col = texture(colorTexture, uv + offs);
  // falling streaks / flakes (three depth layers)
  float acc = 0.0;
  for (int l = 0; l < 3; l++) {
    float s = float(l) + 1.0;
    vec2 q = vec2(uv.x * aspect, uv.y);
    if (snow > 0.5) {
      q *= 14.0 * s;
      q.y += time * (0.9 / s + airspeed * 3.0);
      q.x += sin(time * 0.7 + q.y * 0.3) * 0.4 + airspeed * time * 2.0;
      vec2 id = floor(q), f = fract(q) - 0.5;
      float h = hash(id + s * 17.0);
      acc += step(1.0 - intensity * 0.35, h) * smoothstep(0.12, 0.0, length(f - (vec2(hash(id), hash(id + 2.0)) - 0.5) * 0.6)) * (1.2 - 0.25 * s);
    } else {
      q *= vec2(70.0 * s, 4.0 * s);
      q.x += q.y * (0.15 + airspeed * 0.9) * 0.05;
      q.y += time * (6.0 + airspeed * 20.0) / s;
      vec2 id = floor(q), f = fract(q);
      float h = hash(id + s * 31.0);
      float streak = step(1.0 - intensity * 0.45, h) * smoothstep(0.0, 0.15, f.y) * smoothstep(1.0, 0.55, f.y) * smoothstep(0.18, 0.0, abs(f.x - 0.5));
      acc += streak * (0.9 - 0.2 * s);
    }
  }
  vec3 tint = snow > 0.5 ? vec3(0.95) : vec3(0.72, 0.76, 0.82);
  col.rgb = mix(col.rgb, tint, clamp(acc * (snow > 0.5 ? 0.85 : 0.32) * (cockpit > 0.5 ? 0.6 : 1.0), 0.0, 0.9) * outside);
  col.rgb += glint;
  // heavier precipitation greys the scene a little
  col.rgb = mix(col.rgb, vec3(dot(col.rgb, vec3(0.3, 0.59, 0.11))) * 0.9, intensity * 0.18 * outside);
  out_FragColor = col;
}`;

export class Effects {
  private precip: Cesium.PostProcessStage;
  private flare: Cesium.PostProcessStage | null = null;
  private trails: Cesium.PolylineCollection;
  private engineTrails: { line: Cesium.Polyline; pts: { p: Cesium.Cartesian3; t: number }[] }[] = [];
  private t0 = performance.now();
  private trailT = 0;
  private u = { time: 0, intensity: 0, snow: 0, cockpit: 0, airspeed: 0 };
  /** Switched off after render errors (see World.handleRenderError). */
  off = { precip: false, flare: false, trails: false };
  disable(k: 'precip' | 'flare' | 'trails') {
    this.off[k] = true;
    if (k === 'precip') this.precip.enabled = false;
    if (k === 'flare' && this.flare) this.flare.enabled = false;
    if (k === 'trails') { this.trails.removeAll(); this.trails.show = false; this.engineTrails = []; }
  }

  constructor(scene: Cesium.Scene) {
    const u = this.u;
    this.precip = scene.postProcessStages.add(new Cesium.PostProcessStage({
      name: 'sky_precip', fragmentShader: PRECIP_FS,
      uniforms: { time: () => u.time, intensity: () => u.intensity, snow: () => u.snow, cockpit: () => u.cockpit, airspeed: () => u.airspeed },
    })) as Cesium.PostProcessStage;
    this.precip.enabled = false;
    try {
      const f = Cesium.PostProcessStageLibrary.createLensFlareStage();
      f.uniforms.intensity = 1.6; f.uniforms.distortion = 12.0; f.uniforms.ghostDispersal = 0.42;
      f.uniforms.haloWidth = 0.45; f.uniforms.dirtAmount = 0.35; f.uniforms.earthRadius = Cesium.Ellipsoid.WGS84.maximumRadius;
      f.enabled = false;
      this.flare = scene.postProcessStages.add(f) as Cesium.PostProcessStage;
    } catch { this.flare = null; }
    this.trails = scene.primitives.add(new Cesium.PolylineCollection());
  }

  /**
   * @param precipLevel 0..3 from the weather; @param belowTops eye below the cloud tops (it rains under the clouds)
   * @param tier graphics tier (0 low .. 3 ultra); @param night 0..1
   */
  update(ac: Aircraft, acMatrix: Cesium.Matrix4, opts: { precipLevel: number; belowTops: boolean; cockpit: boolean; tier: number; night: number; inCloud: number; dt: number }) {
    const u = this.u;
    u.time = (performance.now() - this.t0) / 1000;
    const on = opts.precipLevel > 0 && opts.belowTops;
    this.precip.enabled = on && opts.tier >= 1 && !this.off.precip;
    u.intensity = Math.min(1, 0.35 + opts.precipLevel * 0.22);
    u.snow = ac.air.T < 272 ? 1 : 0;
    u.cockpit = opts.cockpit ? 1 : 0;
    u.airspeed = Math.min(1, ac.tas / (160 * KT));
    if (this.flare) this.flare.enabled = opts.tier >= 2 && opts.night < 0.3 && opts.inCloud < 0.3 && !on && !this.off.flare;
    if (!this.off.trails) this.updateContrails(ac, acMatrix, opts.dt);
  }

  /** Condensation trails: jets above ~FL260 in air colder than -40 °C leave a white trail that slowly fades. */
  private updateContrails(ac: Aircraft, m: Cesium.Matrix4, dt: number) {
    const d = ac.def;
    const jet = d.eng.t === 'fan' || d.eng.t === 'jet';
    const now = performance.now() / 1000;
    const making = jet && ac.alt / FT > 25000 && ac.air.T < 233 && ac.engines.some(e => e.running) && !ac.onGround;
    const n = Math.max(1, Math.min(4, d.eng.n));
    if (making && this.engineTrails.length !== n) {
      this.trails.removeAll();
      this.engineTrails = [];
      for (let i = 0; i < n; i++) {
        const line = this.trails.add({ positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.UNIT_X], width: 7,
          material: Cesium.Material.fromType('Fade', { fadeInColor: new Cesium.Color(1, 1, 1, 0.0), fadeOutColor: new Cesium.Color(1, 1, 1, 0.55), fadeDirection: { x: true, y: false }, repeat: false }) });
        line.show = false;
        this.engineTrails.push({ line, pts: [] });
      }
    }
    if (!this.engineTrails.length) return;
    this.trailT -= dt;
    if (this.trailT > 0) return;
    this.trailT = 0.25;
    // engine exits in the body frame (x fwd, y right, z down) -> model local (fwd, left, up)
    const span = d.b, L = d.L;
    const ys = n === 1 ? [0] : n === 2 ? [-0.18, 0.18] : n === 3 ? [-0.2, 0, 0.2] : [-0.33, -0.18, 0.18, 0.33];
    this.engineTrails.forEach((tr, i) => {
      if (making) {
        const local = new Cesium.Cartesian3(-L * 0.12 - 25, -(ys[i] ?? 0) * span, -0.8);  // ~25 m behind: the visible gap
        tr.pts.push({ p: Cesium.Matrix4.multiplyByPoint(m, local, new Cesium.Cartesian3()), t: now });
      }
      while (tr.pts.length && now - tr.pts[0].t > 70) tr.pts.shift();
      if (tr.pts.length > 300) tr.pts.shift();
      tr.line.show = tr.pts.length > 2;
      if (tr.line.show) tr.line.positions = tr.pts.map(x => x.p);
    });
    if (!making && this.engineTrails.every(t => t.pts.length === 0)) { this.trails.removeAll(); this.engineTrails = []; }
  }
}
