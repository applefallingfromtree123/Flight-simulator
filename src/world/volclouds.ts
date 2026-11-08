// Volumetric clouds: a ray-marched post-process. Each pixel's view ray is intersected with the cloud layers of the
// weather (shells around the Earth at their base / top heights), the cloud density is sampled from 3D fractal noise
// (coverage, flat bases, billowing tops, eroded edges, drifting with the wind), and sunlight is scattered through
// it (Beer–Lambert extinction, a "powder" term for dark crevices, Henyey–Greenstein forward scattering for silver
// linings, sky ambient). Clouds composite correctly with terrain, 3D tiles and the aircraft via the depth buffer.
import * as Cesium from 'cesium';

const FS = /* glsl */ `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform mat3 u_enu;        // world -> local east/north/up at the camera
uniform float u_camH;      // camera height (m)
uniform float u_R;         // local Earth radius (m)
uniform vec3 u_anchor;     // camera offset from the noise anchor (ENU m) - keeps the clouds still as you move
uniform vec4 u_l0;         // layer: base, top (m), cover 0..1, stratus 0/1
uniform vec4 u_l1;
uniform vec4 u_l2;
uniform float u_time;
uniform vec2 u_wind;       // m/s east, north
uniform float u_steps;
uniform float u_night;     // 0 day .. 1 night
uniform float u_debug;
in vec2 v_textureCoordinates;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.02 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
float fbm3(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.13 + vec3(5.1, 1.3, 7.7); a *= 0.5; } return s; }

// height of the point t metres along a ray with vertical cosine mu (curved Earth, precise for t << R)
float altAt(float t, float mu) { float RH = u_R + u_camH; return u_camH + t * mu + t * t * (1.0 - mu * mu) / (2.0 * RH); }
// roots of altAt(t) = h
vec2 roots(float h, float mu) {
  float RH = u_R + u_camH, a = (1.0 - mu * mu) / (2.0 * RH), b = mu, c = u_camH - h;
  if (a < 1e-12) { float t = -c / b; return vec2(t, t); }
  float disc = b * b - 4.0 * a * c;
  if (disc < 0.0) return vec2(-1.0, -1.0);
  float s = sqrt(disc);
  // stable form (no cancellation for small a)
  float q = -0.5 * (b + (b >= 0.0 ? s : -s));
  float r1 = q / a, r2 = c / q;
  return vec2(min(r1, r2), max(r1, r2));
}
// where the ray enters / leaves the slab between hb and ht (x < 0: no hit)
vec2 slab(float hb, float ht, float mu) {
  if (u_camH < hb) { vec2 b = roots(hb, mu), t = roots(ht, mu); return vec2(b.y, t.y); }
  if (u_camH > ht) {
    vec2 t = roots(ht, mu); if (t.x < 0.0) return vec2(-1.0);
    vec2 b = roots(hb, mu); return vec2(t.x, b.x > 0.0 ? b.x : t.y);
  }
  vec2 t = roots(ht, mu), b = roots(hb, mu);
  float ex = t.y; if (b.x > 0.0) ex = min(ex, b.x);
  return vec2(0.0, ex);
}

float density(vec3 p, float h, vec4 L) {
  float th = max(1.0, L.y - L.x), hf = (h - L.x) / th;
  if (hf < 0.0 || hf > 1.0) return 0.0;
  vec3 q = p + u_anchor - vec3(u_wind * u_time, 0.0);
  float stratus = L.w;
  // vertical profile: flat dark bases, rounded billowing tops (stratus: a flat sheet)
  float prof = stratus > 0.5 ? smoothstep(0.0, 0.2, hf) * smoothstep(1.0, 0.7, hf) : smoothstep(0.0, 0.08, hf) * smoothstep(1.0, 0.35, hf);
  float scale = stratus > 0.5 ? 1.0 / 5200.0 : 1.0 / 2600.0;
  float cov = fbm(vec3(q.xy * scale, hf * 0.35 + 0.37));
  // the share of the sky covered follows the layer's cover (fbm ~ 0.47 ± 0.12)
  float thr = 0.64 - L.z * 0.34;
  float shape = (cov - thr) * 4.0 * prof - (1.0 - prof) * 0.6;
  if (shape <= 0.0) return 0.0;
  // erode the edges with finer billows
  float detail = fbm3(q / (stratus > 0.5 ? 900.0 : 420.0) + vec3(0.0, 0.0, u_time * 0.02));
  float d = clamp(shape * 2.2 - detail * 0.45 * (1.0 - clamp(shape, 0.0, 1.0)), 0.0, 1.0);
  return d * (stratus > 0.5 ? 0.012 : 0.02);
}
float densityAll(vec3 p, float h) { return density(p, h, u_l0) + density(p, h, u_l1) + density(p, h, u_l2); }

void main() {
  vec2 uv = v_textureCoordinates;
  // view ray in local ENU
  vec4 eyeP = czm_windowToEyeCoordinates(gl_FragCoord.xy, 0.5);
  vec3 dirWC = normalize((czm_inverseView * vec4(normalize(eyeP.xyz), 0.0)).xyz);
  vec3 d = normalize(u_enu * dirWC);
  float mu = d.z;
  // distance to whatever the scene has drawn here
  float depth = czm_readDepth(depthTexture, uv);
  float sceneDist = 1e9;
  if (depth < 1.0) {
    // the depth buffer holds logarithmic depth: decode it to the eye-space distance along the view axis
    vec3 dirEC = normalize(eyeP.xyz);
    float z = exp2(depth / czm_oneOverLog2FarDepthFromNearPlusOne) - 1.0 + czm_currentFrustum.x;
    // trusted for nearby geometry only (the aircraft, the cockpit, a jet bridge); far terrain lies below the
    // cloud layers anyway, so it never needs to hide them
    if (z < 1500.0) sceneDist = z / max(1e-3, -dirEC.z);
  }
  if (u_debug > 2.5) { out_FragColor = vec4(czm_currentFrustum.x / 10.0, czm_currentFrustum.y / 1e9, czm_oneOverLog2FarDepthFromNearPlusOne * 10.0, 0.0); return; }
  if (u_debug > 1.5) { out_FragColor = vec4(sceneDist / 50000.0, depth, sceneDist < 1e8 ? 1.0 : 0.0, 0.0); return; }
  vec3 sun = normalize(u_enu * czm_sunDirectionWC);
  float sunUp = smoothstep(-0.08, 0.25, sun.z);
  vec3 sunCol = mix(vec3(1.0, 0.55, 0.32), vec3(1.0, 0.97, 0.92), smoothstep(0.0, 0.35, sun.z)) * mix(0.03, 1.15, sunUp);
  vec3 amb = mix(vec3(0.03, 0.04, 0.07), vec3(0.62, 0.68, 0.78), sunUp);
  float cosT = dot(d, sun);
  float g = 0.6, hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5) / 12.566;
  float phase = mix(0.08, 1.0, hg * 6.0) + 0.25;
  float T = 1.0;
  vec3 col = vec3(0.0);
  float tMax = min(sceneDist, 45000.0);
  float jitter = hash(vec3(gl_FragCoord.xy, fract(u_time * 7.3)));
  for (int li = 0; li < 3; li++) {
    // front to back: from below look at the low layer first, from above the high one
    int k = mu > 0.0 ? li : 2 - li;
    vec4 L = k == 0 ? u_l0 : k == 1 ? u_l1 : u_l2;
    if (L.z <= 0.01 || L.y <= L.x) continue;
    vec2 s = slab(L.x, L.y, mu);
    if (s.x < 0.0 || s.y <= s.x) continue;
    float t0 = s.x, t1 = min(s.y, tMax);
    if (u_debug > 0.5) { out_FragColor = vec4(t0 / 30000.0, t1 / 30000.0, 1.0, 0.0); return; }
    if (t1 <= t0) continue;
    float n = u_steps;
    float dt = (t1 - t0) / n;
    float t = t0 + dt * jitter;
    for (int i = 0; i < 96; i++) {
      if (float(i) >= n || T < 0.02) break;
      float h = altAt(t, mu);
      vec3 p = d * t;
      float den = density(p, h, L);
      if (den > 0.0001) {
        // light: march a few steps towards the sun through the same layer
        float od = 0.0;
        for (int j = 1; j <= 5; j++) {
          float lt = float(j) * float(j) * 60.0;
          vec3 lp = p + sun * lt;
          od += density(lp, h + sun.z * lt, L) * 60.0 * float(2 * j - 1);
        }
        float lightT = max(exp(-od * 0.22), 0.4 * exp(-od * 0.04));   // + multiple scattering: clouds stay bright
        float powder = 1.0 - exp(-den * 180.0);
        float hf = clamp((h - L.x) / max(1.0, L.y - L.x), 0.0, 1.0);
        vec3 S = sunCol * phase * lightT * mix(0.55, 1.0, powder) * 1.35 + amb * mix(0.45, 1.0, hf);
        float ext = den * dt;
        float a = 1.0 - exp(-ext);
        // far clouds fade into the haze
        float fade = exp(-t / 48000.0);
        col += T * a * S * fade;
        T *= mix(1.0, exp(-ext), fade);
      }
      t += dt;
    }
  }
  out_FragColor = vec4(col, T);   // composited over the full-resolution scene by COMP_FS
}`;

const COMP_FS = /* glsl */ `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform sampler2D cloudTexture;
uniform float u_debug;
uniform float u_inside;   // camera inside a cloud layer: near things are fogged too
in vec2 v_textureCoordinates;
void main() {
  vec4 s = texture(colorTexture, v_textureCoordinates);
  vec4 c = texture(cloudTexture, v_textureCoordinates);
  // nearby geometry (the aircraft, the cockpit) is in front of the clouds unless we are inside one
  float depth = czm_readDepth(depthTexture, v_textureCoordinates);
  float z = 1e9;
  if (depth < 1.0) z = exp2(depth / czm_oneOverLog2FarDepthFromNearPlusOne) - 1.0 + czm_currentFrustum.x;
  if (u_debug > 3.5) { out_FragColor = vec4(z / 2000.0, depth, 0.0, 1.0); return; }
  float near = (1.0 - smoothstep(1200.0, 1800.0, z)) * (1.0 - u_inside);
  c = mix(c, vec4(0.0, 0.0, 0.0, 1.0), near);
  out_FragColor = vec4(s.rgb * c.a + c.rgb, s.a);
}`;

export interface CloudLayerIn { base: number; top: number; cover: number }

export class VolumetricClouds {
  stage: Cesium.PostProcessStage;
  private enu = new Cesium.Matrix3();
  private u = { camH: 0, R: 6371000, anchor: new Cesium.Cartesian3(), l: [new Cesium.Cartesian4(), new Cesium.Cartesian4(), new Cesium.Cartesian4()], time: 0, wind: new Cesium.Cartesian2(), steps: 40, night: 0, inside: 0 };
  private anchor: Cesium.Cartesian3 | null = null;
  private anchorInv = new Cesium.Matrix4();
  private t0 = performance.now();
  enabled = true;
  debug = 0;

  constructor(scene: Cesium.Scene) {
    const u = this.u;
    // ray-march at half resolution (smooth clouds anyway), composite over the full-resolution scene
    const march = new Cesium.PostProcessStage({
      name: 'sky_vol_march', fragmentShader: FS, textureScale: 0.5,
      uniforms: {
        u_enu: () => this.enu, u_camH: () => u.camH, u_R: () => u.R, u_anchor: () => u.anchor,
        u_l0: () => u.l[0], u_l1: () => u.l[1], u_l2: () => u.l[2], u_time: () => u.time, u_wind: () => u.wind, u_steps: () => u.steps, u_night: () => u.night, u_debug: () => this.debug,
      },
    });
    const comp = new Cesium.PostProcessStage({ name: 'sky_vol_comp', fragmentShader: COMP_FS, uniforms: { cloudTexture: 'sky_vol_march', u_debug: () => this.debug, u_inside: () => u.inside } });
    this.stage = scene.postProcessStages.add(new Cesium.PostProcessStageComposite({ name: 'sky_volclouds', stages: [march, comp], inputPreviousStageTexture: false })) as unknown as Cesium.PostProcessStage;
    this.stage.enabled = false;
  }

  /** Per frame: the camera frame, the weather's layers (MSL m) and wind (blowing towards, m/s east/north). */
  update(scene: Cesium.Scene, layers: CloudLayerIn[], wind: { e: number; n: number }, tier: number, offset: number) {
    const on = this.enabled && tier >= 1 && layers.some(l => l.cover > 0.01);
    this.stage.enabled = on;
    if (!on) return;
    const u = this.u;
    const cam = scene.camera.positionWC;
    const carto = Cesium.Cartographic.fromCartesian(cam);
    if (!carto) return;
    u.camH = carto.height;
    u.R = Cesium.Cartesian3.magnitude(cam) - carto.height;
    const m4 = Cesium.Transforms.eastNorthUpToFixedFrame(cam);
    // world -> ENU: transpose of the ENU axes (column-major Matrix3 from the rotation part)
    const rot = Cesium.Matrix4.getMatrix3(m4, new Cesium.Matrix3());
    Cesium.Matrix3.transpose(rot, this.enu);
    // noise anchor: re-anchor after 300 km so the numbers stay small
    if (!this.anchor || Cesium.Cartesian3.distance(this.anchor, cam) > 300000) {
      this.anchor = Cesium.Cartesian3.clone(cam);
      Cesium.Matrix4.inverseTransformation(Cesium.Transforms.eastNorthUpToFixedFrame(this.anchor), this.anchorInv);
    }
    Cesium.Matrix4.multiplyByPoint(this.anchorInv, cam, u.anchor);
    u.anchor.z = 0;   // heights come from the shell geometry
    for (let i = 0; i < 3; i++) {
      const L = layers[i];
      if (!L) { u.l[i] = new Cesium.Cartesian4(0, 0, 0, 0); continue; }
      const thick = L.top - L.base;
      u.l[i] = new Cesium.Cartesian4(L.base + offset, L.top + offset, Math.min(1, L.cover), thick < 700 ? 1 : 0);
    }
    u.inside = layers.some(L => L.cover > 0.4 && u.camH > L.base + offset && u.camH < L.top + offset) ? 1 : 0;
    u.time = (performance.now() - this.t0) / 1000;
    u.wind = new Cesium.Cartesian2(wind.e, wind.n);
    u.steps = [0, 48, 64, 90][tier] ?? 64;
  }
}
