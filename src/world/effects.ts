// Visual effects layered on the scene: animated rain / snow (streaks outside, drops running over the windshield in
// the cockpit), a sun lens flare, contrails behind jet engines in the cold air at altitude, rotor / jet downwash
// (the water surface pushed down in rings with spray, dust over land) and lightning flashes in thunderstorms.
import * as Cesium from 'cesium';
import type { Aircraft } from '../sim/fdm.ts';
import { FT, KT } from '../core/math.ts';
import { VolumetricClouds } from './volclouds.ts';

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

/** Water pushed down by the downwash: a darker dimple with rings running outwards (animated). */
const WASH_MAT = `
uniform float time;
uniform float strength;
uniform float water;
czm_material czm_getMaterial(czm_materialInput mi) {
  czm_material m = czm_getDefaultMaterial(mi);
  vec2 st = mi.st - 0.5;
  float r = length(st) * 2.0;
  float rings = 0.5 + 0.5 * sin(r * 46.0 - time * 9.0);
  float edge = smoothstep(1.0, 0.55, r);
  float core = smoothstep(0.45, 0.0, r);
  if (water > 0.5) {
    m.diffuse = mix(vec3(0.82, 0.88, 0.92), vec3(0.08, 0.14, 0.18), core);
    m.alpha = strength * edge * (core * 0.45 + rings * 0.3 * smoothstep(0.08, 0.35, r));
  } else {
    m.diffuse = vec3(0.62, 0.55, 0.45);
    m.alpha = strength * edge * (0.12 + rings * 0.12) * smoothstep(0.05, 0.3, r);
  }
  return m;
}`;

const FLASH_FS = /* glsl */ `
uniform sampler2D colorTexture;
uniform float flash;
in vec2 v_textureCoordinates;
void main() {
  vec4 c = texture(colorTexture, v_textureCoordinates);
  out_FragColor = vec4(c.rgb + vec3(0.85, 0.9, 1.0) * flash * (0.35 + 0.65 * dot(c.rgb, vec3(0.33))), c.a);
}`;

/**
 * The "look": contrast-adaptive sharpening (crisper photogrammetry and imagery, like MSFS's sharpen filter), then a
 * filmic grade — richer colour, a gentle S-curve, warm highlights / cool shadows — and a soft vignette.
 */
const GRADE_FS = /* glsl */ `
uniform sampler2D colorTexture;
uniform float sharp;
uniform float sat;
uniform float contrast;
uniform float warmth;
uniform float vignette;
in vec2 v_textureCoordinates;
void main() {
  vec2 uv = v_textureCoordinates;
  vec2 px = 1.0 / czm_viewport.zw;
  vec3 c = texture(colorTexture, uv).rgb;
  vec3 n = texture(colorTexture, uv + vec2(0.0, px.y)).rgb, s = texture(colorTexture, uv - vec2(0.0, px.y)).rgb;
  vec3 e = texture(colorTexture, uv + vec2(px.x, 0.0)).rgb, w = texture(colorTexture, uv - vec2(px.x, 0.0)).rgb;
  vec3 mn = min(c, min(min(n, s), min(e, w))), mx = max(c, max(max(n, s), max(e, w)));
  vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(1e-3)), 0.0, 1.0));   // less where it would ring
  c = clamp(c + (c - (n + s + e + w) * 0.25) * sharp * amp * 2.0, 0.0, 1.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, sat);
  c = mix(c, c * c * (3.0 - 2.0 * c), contrast);                               // S-curve
  c += warmth * (vec3(0.035, 0.012, -0.022) * smoothstep(0.45, 1.0, l) + vec3(-0.012, 0.0, 0.03) * (1.0 - smoothstep(0.0, 0.45, l)));
  vec2 d = uv - 0.5;
  c *= 1.0 - vignette * dot(d, d) * 1.5;
  out_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

/** Soft round sprite for spray / dust particles. */
function puffImage(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return cv;
}

export class Effects {
  private precip: Cesium.PostProcessStage;
  private flare: Cesium.PostProcessStage | null = null;
  private trails: Cesium.PolylineCollection;
  private engineTrails: { line: Cesium.Polyline; pts: { p: Cesium.Cartesian3; t: number }[] }[] = [];
  private t0 = performance.now();
  private trailT = 0;
  private u = { time: 0, intensity: 0, snow: 0, cockpit: 0, airspeed: 0 };
  /** Switched off after render errors (see World.handleRenderError). */
  off = { precip: false, flare: false, trails: false, wash: false, flash: false, grade: false, vol: false };
  private wash: Cesium.Primitive | null = null;
  private washMat: Cesium.Material | null = null;
  private spray: Cesium.ParticleSystem | null = null;
  private flashStage: Cesium.PostProcessStage | null = null;
  private flashV = 0;
  private nextFlash = 0;
  /** Called on a lightning strike with the delay of its thunder (s). */
  onThunder: (delay: number) => void = () => {};
  disable(k: 'precip' | 'flare' | 'trails' | 'wash' | 'flash' | 'grade' | 'vol') {
    this.off[k] = true;
    if (k === 'grade' && this.grade) this.grade.enabled = false;
    if (k === 'vol') { this.vol.enabled = false; this.vol.stage.enabled = false; }
    if (k === 'wash') { if (this.wash) this.wash.show = false; if (this.spray) this.spray.show = false; }
    if (k === 'flash' && this.flashStage) this.flashStage.enabled = false;
    if (k === 'precip') this.precip.enabled = false;
    if (k === 'flare' && this.flare) this.flare.enabled = false;
    if (k === 'trails') { this.trails.removeAll(); this.trails.show = false; this.engineTrails = []; }
  }

  private grade: Cesium.PostProcessStage | null = null;
  private g = { sharp: 0.5, sat: 1.24, contrast: 0.4, warmth: 1.4, vignette: 0.45 };
  /** The look pass: on/off and strength from the graphics quality (tier 0 = off). */
  setLook(on: boolean, tier: number) {
    if (!this.grade) return;
    this.grade.enabled = on && tier >= 1 && !this.off.grade;
    this.g.sharp = [0, 0.45, 0.6, 0.7][tier] ?? 0.55;
  }

  /** Ray-marched volumetric clouds (before the colour grade so they get graded too). */
  vol: VolumetricClouds;
  constructor(private scene: Cesium.Scene) {
    const u = this.u;
    const g = this.g;
    this.vol = new VolumetricClouds(scene);
    this.grade = scene.postProcessStages.add(new Cesium.PostProcessStage({
      name: 'sky_grade', fragmentShader: GRADE_FS,
      uniforms: { sharp: () => g.sharp, sat: () => g.sat, contrast: () => g.contrast, warmth: () => g.warmth, vignette: () => g.vignette },
    })) as Cesium.PostProcessStage;
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
    this.flashStage = scene.postProcessStages.add(new Cesium.PostProcessStage({ name: 'sky_flash', fragmentShader: FLASH_FS, uniforms: { flash: () => this.flashV } })) as Cesium.PostProcessStage;
    this.flashStage.enabled = false;
  }

  /**
   * Downwash: a helicopter hovering low, or any aircraft skimming the surface, pushes the water down in rings and
   * throws spray (dust over land). @param ground surface under the aircraft (height MSL + geoid offset, water?)
   */
  updateWash(ac: Aircraft, ground: { h: number; water: boolean; offset: number }, dt: number) {
    if (this.off.wash) return;
    const heli = ac.isRotor;
    const agl = ac.alt - ground.h;
    const d = ac.def;
    const radius = heli ? Math.max(5, (d.b || 10) * 0.5) : Math.max(6, d.b * 0.4);
    const reach = heli ? radius * 3.2 : 12;
    const power = heli ? Math.min(1, 0.35 + ac.collective) : Math.min(1, (ac.engineCmd[0]?.throttle ?? 0) + 0.2);
    let k = agl > 0 && agl < reach ? (1 - agl / reach) * power : 0;
    if (!heli && ac.onGround) k = 0;               // fixed wing: only when skimming the surface
    if (!ground.water && !heli) k = 0;             // jet / prop dust on land is too subtle to bother with
    const pos = Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, ground.h + ground.offset + 0.25);
    if (k <= 0.02) {
      if (this.wash) this.wash.show = false;
      if (this.spray) this.spray.show = false;
      return;
    }
    const R = radius * (2.2 + (1 - agl / reach) * 1.5);
    // one unit disc (a quad; the material draws the round shape), moved and scaled every frame — never rebuilt,
    // so its material is never destroyed and re-used
    if (!this.wash) {
      this.washMat = new Cesium.Material({ fabric: { uniforms: { time: 0, strength: 0, water: 1 }, source: WASH_MAT }, translucent: true });
      const pos4 = new Float64Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
      const geometry = new Cesium.Geometry({
        attributes: {
          position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: pos4 }),
          st: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) }),
          normal: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]) }),
        } as unknown as Cesium.GeometryAttributes,
        indices: new Uint16Array([0, 1, 2, 0, 2, 3]), primitiveType: Cesium.PrimitiveType.TRIANGLES,
        boundingSphere: new Cesium.BoundingSphere(Cesium.Cartesian3.ZERO, 1.5),
      });
      this.wash = this.scene.primitives.add(new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({ geometry }),
        appearance: new Cesium.MaterialAppearance({ material: this.washMat, translucent: true, flat: true, faceForward: true, closed: false,
          renderState: { cull: { enabled: false }, depthMask: false, blending: Cesium.BlendingState.ALPHA_BLEND } }),
        asynchronous: false, allowPicking: false, compressVertices: false,
      })) as Cesium.Primitive;
    }
    Cesium.Matrix4.multiplyByUniformScale(Cesium.Transforms.eastNorthUpToFixedFrame(pos), R, this.wash.modelMatrix);
    this.wash!.show = true;
    const mu = this.washMat!.uniforms as Record<string, number>;
    mu.time = (performance.now() - this.t0) / 1000; mu.strength = Math.min(1, k * 1.4); mu.water = ground.water ? 1 : 0;
    // spray / dust particles thrown out from under the aircraft
    if (!this.spray) {
      this.spray = this.scene.primitives.add(new Cesium.ParticleSystem({
        image: puffImage(), sizeInMeters: true, minimumImageSize: new Cesium.Cartesian2(2, 2), maximumImageSize: new Cesium.Cartesian2(5, 5),
        startScale: 0.8, endScale: 3.2, minimumParticleLife: 1.0, maximumParticleLife: 2.2, minimumSpeed: 5, maximumSpeed: 11,
        emissionRate: 0, emitter: new Cesium.CircleEmitter(radius * 1.4), lifetime: 16, loop: true,
        startColor: new Cesium.Color(1, 1, 1, 0.55), endColor: new Cesium.Color(1, 1, 1, 0),
        updateCallback: (p: Cesium.Particle, dt2: number) => {
          // gravity, and a push outwards from the centre
          const up = Cesium.Cartesian3.normalize(p.position, new Cesium.Cartesian3());
          Cesium.Cartesian3.add(p.velocity, Cesium.Cartesian3.multiplyByScalar(up, -6 * dt2, new Cesium.Cartesian3()), p.velocity);
        },
      })) as Cesium.ParticleSystem;
    }
    const sp = this.spray!;
    sp.show = true;
    sp.modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(pos);
    sp.emissionRate = 30 + 220 * k;
    const col = ground.water ? new Cesium.Color(0.95, 0.97, 1, 0.5 * k + 0.1) : new Cesium.Color(0.66, 0.58, 0.47, 0.45 * k + 0.1);
    sp.startColor = col; sp.endColor = col.withAlpha(0);
  }

  /** Thunderstorm: random lightning flashes (with thunder a few seconds later). */
  updateLightning(storm: number, dt: number) {
    if (this.off.flash || !this.flashStage) return;
    const now = performance.now() / 1000;
    if (storm > 0 && now > this.nextFlash) {
      this.nextFlash = now + 5 + Math.random() * (30 / storm);
      if (this.nextFlash > 0 && Math.random() < 0.85) { this.flashV = 0.9 + Math.random() * 0.8; this.onThunder(1 + Math.random() * 6); }
    }
    // a strike flickers: decay with a second pulse
    if (this.flashV > 0.01) {
      this.flashV *= Math.exp(-dt * 9);
      if (Math.random() < dt * 4) this.flashV += 0.4;
      this.flashStage.enabled = true;
    } else { this.flashV = 0; this.flashStage.enabled = false; }
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
