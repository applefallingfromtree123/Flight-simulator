// Real-world globe rendering (CesiumJS): imagery, streamed terrain, photorealistic 3D tiles,
// sun/sky/fog, clouds, aircraft model, aircraft & airport lighting, and camera views.
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { DEG, RAD, clamp, qMul, qFromEuler, qRot, qToEuler, type Q, type V3 } from '../core/math.ts';
import { destination, distance } from '../core/geo.ts';
import type { Aircraft } from '../sim/fdm.ts';
import type { WeatherState } from '../sim/atmosphere.ts';
import { buildAircraftGlb, type ModelNodes } from './modelBuilder.ts';
import { ElevationService } from './terrain.ts';
import { RunwayRenderer } from './runways.ts';
import type { AirportDB, Runway, RunwayEnd } from './airports.ts';

export type ImagerySource = 'google' | 'esri' | 'bing-ion' | 'sentinel2' | 'osm';
const IMAGERY_LABEL: Record<ImagerySource, string> = { google: 'Google', esri: 'Esri', 'bing-ion': 'Bing', sentinel2: 'Sentinel-2', osm: 'OSM' };
export interface SceneOptions {
  imagery: ImagerySource;
  googleKey: string;
  ionToken: string;
  photoreal: boolean;
  shadows: boolean;
  quality: 'low' | 'medium' | 'high';
}
export type ViewMode = 'cockpit' | 'cockpit-hud' | 'chase' | 'tower' | 'flyby' | 'free';

export class World {
  viewer: Cesium.Viewer;
  scene: Cesium.Scene;
  elevation: ElevationService;
  private model: Cesium.Model | null = null;
  private modelNodes: ModelNodes | null = null;
  private propAngle: number[] = [];
  private lights: Cesium.PointPrimitiveCollection;
  private acLights: Cesium.PointPrimitive[] = [];
  private rwyLights: Cesium.PointPrimitiveCollection;
  private papi: { p: Cesium.PointPrimitive; pos: { lat: number; lon: number; h: number }; thr: number; end: RunwayEnd }[] = [];
  private rwyLightsAt: { lat: number; lon: number } | null = null;
  private clouds: Cesium.CloudCollection;
  private cloudsAt: { lat: number; lon: number; key: string } | null = null;
  private tileset: Cesium.Cesium3DTileset | null = null;
  geoidOffset = 0;
  runways: RunwayRenderer;
  view: ViewMode = 'cockpit';
  head = { yaw: 0, pitch: 0, zoom: 1 };
  chase = { yaw: 180, pitch: -8, dist: 1 };
  panelFrac = 0.36;
  private towerPos: { lat: number; lon: number; h: number } | null = null;
  private flybyPos: { lat: number; lon: number; h: number } | null = null;
  private chaseQ: Q | null = null;

  constructor(container: HTMLElement, public db: AirportDB, public opts: SceneOptions) {
    Cesium.Ion.defaultAccessToken = opts.ionToken || '';
    this.elevation = new ElevationService(db);
    const terrainProvider = new Cesium.CustomHeightmapTerrainProvider({
      width: 33, height: 33,
      credit: 'Terrain: AWS Terrain Tiles (Mapzen/SRTM/GMTED)',
      callback: (x, y, level) => {
        const rect = terrainProvider.tilingScheme.tileXYToRectangle(x, y, level);
        return this.elevation.heightGrid(rect.west * RAD, rect.south * RAD, rect.east * RAD, rect.north * RAD, level, 33, 33);
      },
    });
    this.viewer = new Cesium.Viewer(container, {
      baseLayer: false, terrainProvider,
      animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
      sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false,
      selectionIndicator: false, shouldAnimate: true, requestRenderMode: false,
      showRenderLoopErrors: false, // handled below: recover instead of freezing the screen
      msaaSamples: opts.quality === 'high' ? 4 : 1,
      contextOptions: { webgl: { powerPreference: 'high-performance' } },
    });
    const v = this.viewer;
    this.scene = v.scene;
    (v.cesiumWidget.creditContainer as HTMLElement).classList.add('credits');
    this.setImagery(opts.imagery);
    const s = this.scene;
    s.globe.enableLighting = true;
    s.globe.baseColor = Cesium.Color.fromCssColorString('#1b2430'); // dark slate while imagery streams in or if it fails — never literal black
    s.globe.depthTestAgainstTerrain = true;
    s.globe.maximumScreenSpaceError = opts.quality === 'high' ? 1.5 : opts.quality === 'medium' ? 2 : 3;
    s.globe.tileCacheSize = 400;
    s.globe.preloadSiblings = false;
    s.globe.loadingDescendantLimit = 30;
    s.globe.showGroundAtmosphere = true;
    s.fog.enabled = true;
    s.fog.density = 2.0e-4;
    if (s.skyAtmosphere) s.skyAtmosphere.show = true;
    s.highDynamicRange = false;
    s.postProcessStages.fxaa.enabled = true;
    v.shadows = opts.shadows;
    v.shadowMap.softShadows = true;
    v.shadowMap.maximumDistance = 800;
    s.screenSpaceCameraController.enableInputs = false;
    const cam = s.camera;
    (cam.frustum as Cesium.PerspectiveFrustum).near = 0.3;
    this.lights = s.primitives.add(new Cesium.PointPrimitiveCollection());
    this.rwyLights = s.primitives.add(new Cesium.PointPrimitiveCollection());
    this.clouds = s.primitives.add(new Cesium.CloudCollection({ noiseDetail: 16 }));
    this.routeLines = s.primitives.add(new Cesium.PolylineCollection());
    this.runways = new RunwayRenderer(s, db);
    s.renderError.addEventListener((_scene, err) => this.handleRenderError(err));
    if (opts.photoreal && opts.googleKey) this.enablePhotoreal(opts.googleKey);
  }

  private imageryGen = 0;
  /**
   * @param chain sources already tried in this fallback cascade (prevents looping back to a source
   * that just failed, and lets us give up with a clear message instead of going silently blank).
   */
  setImagery(src: ImagerySource, chain: ImagerySource[] = []) {
    const gen = ++this.imageryGen;
    const tried = [...chain, src];
    const next = (): ImagerySource | null => (['esri', 'sentinel2', 'osm'] as ImagerySource[]).find(s => !tried.includes(s)) ?? null;
    // Per-tile fetch failures surface on the *imagery provider's* errorEvent, not the ImageryLayer's
    // (the layer's own errorEvent only fires if the provider itself never got constructed at all —
    // a blocked host or bad API key still "constructs" fine and then fails every tile request).
    // A handful of failures within a short window (not just one — a single dropped tile over open
    // ocean is normal) means the source is actually unreachable, not just having a bad moment.
    let fails = 0, firstFailAt = 0;
    const onTileError = (label: string) => {
      if (gen !== this.imageryGen) return;
      const now = performance.now();
      if (now - firstFailAt > 6000) { fails = 0; firstFailAt = now; }
      if (++fails < 3) return;
      const n = next();
      if (n) { this.onRenderIssue(`${label}를 불러오지 못했습니다 — ${IMAGERY_LABEL[n]}(으)로 전환`, false); this.setImagery(n, tried); }
      else this.onRenderIssue(`위성지도를 하나도 불러오지 못했습니다 (${tried.map(s => IMAGERY_LABEL[s]).join(', ')}) — 네트워크 연결을 확인하세요. 지형과 활주로, 비행은 계속 정상 동작합니다.`, false);
    };
    /** Attach onTileError to a provider we already have in hand (sync-constructed providers). */
    const watch = (provider: Cesium.ImageryProvider, label: string) => provider.errorEvent.addEventListener(() => onTileError(label));
    /** Same, but for fromProviderAsync layers whose provider only exists once the layer is ready
     *  (and cover the rarer case where the provider promise itself rejects before ever existing). */
    const watchAsync = (layer: Cesium.ImageryLayer, label: string) => {
      layer.readyEvent.addEventListener(provider => watch(provider, label));
      layer.errorEvent.addEventListener(() => onTileError(label));
    };
    const layers = this.viewer.imageryLayers;
    layers.removeAll();
    // offline base layer bundled with Cesium (always available, shows through while tiles stream)
    layers.add(Cesium.ImageryLayer.fromProviderAsync(Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')), {}));
    if (src === 'google' && this.opts.googleKey) {
      // Official Google Maps Platform 2D satellite tiles (Map Tiles API key required)
      const layer = Cesium.ImageryLayer.fromProviderAsync(
        Cesium.Google2DImageryProvider.fromUrl({ key: this.opts.googleKey, mapType: 'satellite', language: 'ko', region: 'KR' }) as unknown as Promise<Cesium.ImageryProvider>, {});
      watchAsync(layer, 'Google 위성지도 (API 키 / Map Tiles API 활성화 확인)');
      layers.add(layer);
    } else if (src === 'bing-ion' && this.opts.ionToken) {
      const layer = Cesium.ImageryLayer.fromProviderAsync(Cesium.IonImageryProvider.fromAssetId(2), {});
      watchAsync(layer, 'Bing 위성지도 (ion 토큰 확인)');
      layers.add(layer);
    } else if (src === 'bing-ion' && !this.opts.ionToken) {
      const n = next() ?? 'esri';
      this.onRenderIssue(`Bing 위성지도를 쓰려면 설정에 Cesium ion 토큰을 입력하세요 — ${IMAGERY_LABEL[n]}(으)로 전환`, false);
      this.setImagery(n, tried);
      return;
    } else if (src === 'sentinel2') {
      // Sentinel-2 cloudless (EOX IT Services) — free, no key, ~10 m/px global mosaic, genuinely
      // independent satellite source from Esri/Google. Coarser up close (good to ~FL100 and above).
      const provider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
        maximumLevel: 14,
        credit: new Cesium.Credit('Sentinel-2 cloudless by EOX IT Services GmbH (Contains modified Copernicus Sentinel data)'),
      });
      watch(provider, 'Sentinel-2 위성지도');
      layers.add(new Cesium.ImageryLayer(provider));
    } else if (src === 'osm') {
      const provider = new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' });
      watch(provider, 'OpenStreetMap');
      layers.add(new Cesium.ImageryLayer(provider));
    } else {
      const provider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
        credit: new Cesium.Credit('Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community'),
      });
      watch(provider, 'Esri 위성지도');
      layers.add(new Cesium.ImageryLayer(provider));
    }
  }

  private photorealGen = 0;
  async enablePhotoreal(key: string) {
    const gen = ++this.photorealGen;
    // never leave the ground blank: keep the globe visible until the tileset has proven it can
    // actually render content (a valid-looking tileset.json can still fail every tile request —
    // wrong API restriction, billing not enabled, quota — which used to hide the globe over nothing)
    try {
      const tileset = await Cesium.createGooglePhotorealistic3DTileset({ key }, { maximumScreenSpaceError: 12, cacheBytes: 1024 * 1024 * 1024 });
      if (gen !== this.photorealGen) { tileset.destroy(); return; } // superseded while awaiting
      this.scene.primitives.add(tileset);
      this.tileset = tileset;
      let loaded = false, failed = 0;
      const onLoad = () => {
        if (loaded || gen !== this.photorealGen) return;
        loaded = true;
        this.scene.globe.show = false;
      };
      const onFail = () => { failed++; };
      tileset.tileLoad.addEventListener(onLoad);
      tileset.tileFailed.addEventListener(onFail);
      setTimeout(() => {
        tileset.tileLoad.removeEventListener(onLoad);
        tileset.tileFailed.removeEventListener(onFail);
        if (loaded || gen !== this.photorealGen || tileset.isDestroyed()) return;
        // 12 s and not a single tile rendered: treat it as a dead key/quota, not slow network
        this.scene.primitives.remove(tileset);
        if (this.tileset === tileset) this.tileset = null;
        this.scene.globe.show = true;
        this.onRenderIssue(`Google 3D Tiles를 불러오지 못했습니다${failed > 0 ? ' (API 키의 결제·권한 확인)' : ' (응답 없음 — 네트워크 확인)'} — 일반 지형으로 전환`, false);
      }, 12000);
    } catch (e) {
      console.warn('Photorealistic 3D Tiles failed', e);
      if (gen === this.photorealGen) this.onRenderIssue('Google 3D Tiles 초기화 실패 — 일반 지형으로 전환', false);
    }
  }
  /** Turn photorealistic 3D tiles back off and restore the normal globe. */
  disablePhotoreal() {
    this.photorealGen++;
    if (this.tileset) { this.scene.primitives.remove(this.tileset); this.tileset = null; }
    this.scene.globe.show = true;
  }

  /** With photorealistic tiles (ellipsoidal heights), measure the MSL→ellipsoid offset at a runway. */
  async calibrateGeoid(lat: number, lon: number, mslElev: number) {
    if (!this.tileset) { this.geoidOffset = 0; return; }
    try {
      const c = Cesium.Cartographic.fromDegrees(lon, lat);
      const [r] = await this.scene.sampleHeightMostDetailed([c], [this.model as unknown as object].filter(Boolean));
      if (r?.height !== undefined) this.geoidOffset = clamp(r.height - mslElev, -120, 120);
    } catch { /* keep previous */ }
  }

  // ───────────────────────── aircraft model ─────────────────────────
  async loadAircraft(ac: Aircraft) {
    if (this.model) { this.scene.primitives.remove(this.model); this.model = null; }
    const { glb, nodes } = buildAircraftGlb(ac.def, ac.aero);
    const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
    this.model = await Cesium.Model.fromGltfAsync({ url, shadows: Cesium.ShadowMode.ENABLED, backFaceCulling: false, color: Cesium.Color.WHITE });
    this.scene.primitives.add(this.model);
    this.modelNodes = nodes;
    this.propAngle = nodes.props.map(() => 0);
    this.buildAircraftLights(ac);
    this.chaseQ = null;
  }

  private buildAircraftLights(ac: Aircraft) {
    this.lights.removeAll();
    this.acLights = [];
    const mk = (color: Cesium.Color, size: number) => {
      const p = this.lights.add({ position: Cesium.Cartesian3.ZERO, color, pixelSize: size, show: false,
        scaleByDistance: new Cesium.NearFarScalar(50, 1.4, 20000, 0.6) });
      this.acLights.push(p);
      return p;
    };
    mk(Cesium.Color.RED, 6); mk(Cesium.Color.LIME, 6); mk(Cesium.Color.WHITE, 5); // nav L, R, tail
    mk(Cesium.Color.WHITE, 9); mk(Cesium.Color.WHITE, 9);                         // strobes
    mk(Cesium.Color.RED, 7); mk(Cesium.Color.RED, 7);                             // beacons top/bottom
    mk(Cesium.Color.fromCssColorString('#fff6d8'), 12);                            // landing
    void ac;
  }

  /** Body-frame point -> Cartesian3. */
  private bodyToWorld(ac: Aircraft, p: V3, out?: Cesium.Cartesian3) {
    const n = qRot(ac.q, p);
    const R = 6371008.8 + ac.alt;
    const lat = ac.lat + (n[0] / R) * RAD;
    const lon = ac.lon + (n[1] / (R * Math.cos(ac.lat * DEG))) * RAD;
    return Cesium.Cartesian3.fromDegrees(lon, lat, ac.alt - n[2] + this.geoidOffset, undefined, out);
  }

  private tmpM3 = new Cesium.Matrix3();
  private tmpM4 = new Cesium.Matrix4();
  modelMatrixFor(ac: Aircraft, result: Cesium.Matrix4) {
    const pos = Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, ac.alt + this.geoidOffset);
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(pos, undefined, result);
    // body(FRD) -> NED rotation matrix from quaternion
    const [w, x, y, z] = ac.q;
    const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - w * z), r02 = 2 * (x * z + w * y);
    const r10 = 2 * (x * y + w * z), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - w * x);
    const r20 = 2 * (x * z - w * y), r21 = 2 * (y * z + w * x), r22 = 1 - 2 * (x * x + y * y);
    // model local (fwd, left, up) -> ENU:  ENU = P * R_nb * diag(1,-1,-1)
    // P: (n,e,d) -> (e,n,-d)
    const m = this.tmpM3;
    // column 0 (fwd): R col0 -> (r10, r00, -r20)
    // column 1 (left): -R col1 -> (-r11, -r01, r21)
    // column 2 (up):  -R col2 -> (-r12, -r02, r22)
    Cesium.Matrix3.fromArray([r10, r00, -r20, -r11, -r01, r21, -r12, -r02, r22], 0, m);
    const rot = Cesium.Matrix4.fromRotationTranslation(m, Cesium.Cartesian3.ZERO, this.tmpM4);
    return Cesium.Matrix4.multiply(enu, rot, result);
  }

  updateAircraft(ac: Aircraft, dt: number, lightsState: { nav: boolean; beacon: boolean; strobe: boolean; landing: boolean }, t: number) {
    if (!this.model) return;
    this.modelMatrixFor(ac, this.model.modelMatrix);
    this.model.show = this.view !== 'cockpit' && this.view !== 'cockpit-hud';
    const nodes = this.modelNodes!;
    if (this.model.ready) {
      const gear = nodes.gear.length ? this.model.getNode('gear') : undefined;
      if (gear) gear.show = ac.gearPos > 0.05;
      nodes.props.forEach((pr, i) => {
        const node = this.model!.getNode(pr.name);
        if (!node) return;
        const e = ac.engines[Math.min(i, ac.engines.length - 1)];
        let rpm = ac.isRotor ? ac.rotorRpm * (pr.axis === 'z' ? 390 : 2000) : e ? e.rpm : 0;
        if (e && (e.def.t === 'tprop')) rpm = e.np * 12;
        const rate = Math.min(rpm / 60 * Math.PI * 2, 28 + (pr.axis === 'z' ? 0 : 10)); // cap to avoid strobing
        this.propAngle[i] = (this.propAngle[i] + rate * dt * pr.dir) % (Math.PI * 2);
        const a = this.propAngle[i];
        const rot = pr.axis === 'x'
          ? Cesium.Matrix3.fromRotationZ(a)   // glTF +Z is body forward
          : Cesium.Matrix3.fromRotationY(a);  // glTF +Y is body up
        const tr = new Cesium.Cartesian3(-pr.pos[1], -pr.pos[2], pr.pos[0]);
        node.matrix = Cesium.Matrix4.fromRotationTranslation(rot, tr);
      });
    }
    // lights
    const A = ac.aero, def = ac.def;
    const tipX = A.structure.find(s => s.name === 'RWINGTIP')!.pos;
    const flash = (period: number, phase: number, on: number) => ((t + phase) % period) < on;
    const L = this.acLights;
    const set = (i: number, show: boolean, p: V3) => { L[i].show = show; if (show) L[i].position = this.bodyToWorld(ac, p, L[i].position); };
    set(0, lightsState.nav, [tipX[0], -tipX[1] - 0.2, tipX[2]]);
    set(1, lightsState.nav, [tipX[0], tipX[1] + 0.2, tipX[2]]);
    set(2, lightsState.nav, [-def.L * 0.5, 0, -def.dia * 0.2]);
    set(3, lightsState.strobe && flash(1.2, 0, 0.06), [tipX[0], -tipX[1] - 0.25, tipX[2]]);
    set(4, lightsState.strobe && flash(1.2, 0, 0.06), [tipX[0], tipX[1] + 0.25, tipX[2]]);
    set(5, lightsState.beacon && flash(1.0, 0.5, 0.12), [0, 0, -def.dia * 0.55]);
    set(6, lightsState.beacon && flash(1.0, 0.0, 0.12), [0, 0, def.dia * 0.55]);
    set(7, lightsState.landing && this.view !== 'cockpit' && this.view !== 'cockpit-hud', [def.L * 0.1, 0, def.dia * 0.5]);
  }

  // ───────────────────────── airport lighting (edge, centreline, approach, PAPI) ─────────────────────────
  updateAirportLights(ac: Aircraft, night: number, eye: { lat: number; lon: number; alt: number }) {
    this.runways.offset = this.geoidOffset;
    this.runways.update(ac.lat, ac.lon);
    const moved = !this.rwyLightsAt || distance(this.rwyLightsAt, ac) > 6000;
    if (moved && this.db.ready) {
      this.rwyLightsAt = { lat: ac.lat, lon: ac.lon };
      this.rwyLights.removeAll();
      this.papi = [];
      const near = this.db.nearest(ac, 6, 30000);
      for (const { apt } of near) for (const rw of apt.runways) if (rw.hard && (rw.lighted || apt.size >= 2)) this.buildRunwayLights(rw);
    }
    const vis = night > 0.05;
    const scale = 0.5 + night * 0.9;
    this.rwyLights.show = vis || night > 0;
    for (let i = 0; i < this.rwyLights.length; i++) {
      const p = this.rwyLights.get(i);
      p.pixelSize = (p as unknown as { base: number }).base * scale;
    }
    // PAPI: colour by observer glide angle (white above, red below; 2.5/2.83/3.17/3.5°)
    for (const pa of this.papi) {
      const d = distance(eye, pa.pos);
      const ang = Math.atan2(eye.alt - pa.pos.h, Math.max(d, 1)) * RAD;
      pa.p.color = ang > pa.thr ? Cesium.Color.WHITE : Cesium.Color.RED;
    }
  }
  private addLight(lat: number, lon: number, h: number, color: Cesium.Color, size: number) {
    const p = this.rwyLights.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, h + 0.4 + this.geoidOffset), color, pixelSize: size,
      scaleByDistance: new Cesium.NearFarScalar(200, 1.6, 12000, 0.35),
      translucencyByDistance: new Cesium.NearFarScalar(15000, 1, 30000, 0),
    });
    (p as unknown as { base: number }).base = size;
    return p;
  }
  private buildRunwayLights(rw: Runway) {
    const ends: [RunwayEnd, RunwayEnd][] = [[rw.le, rw.he], [rw.he, rw.le]];
    const len = distance(rw.le, rw.he);
    const half = rw.width / 2 + 1;
    const W = Cesium.Color.fromCssColorString('#fff3d6'), Y = Cesium.Color.fromCssColorString('#ffcc33');
    const G = Cesium.Color.fromCssColorString('#3dff6a'), R = Cesium.Color.fromCssColorString('#ff3030');
    const hAt = (t: number) => rw.le.elev + (rw.he.elev - rw.le.elev) * t;
    // edge lights
    for (let s = 0; s <= len; s += 60) {
      const t = s / len;
      const c = destination(rw.le, rw.le.hdg, s);
      for (const side of [-1, 1]) {
        const p = destination(c, rw.le.hdg + 90 * side, half);
        this.addLight(p.lat, p.lon, hAt(t), len - s < 600 || s < 600 ? Y : W, 4);
      }
      // centreline (large runways)
      if (rw.width > 40) {
        const col = len - s < 300 || s < 300 ? R : len - s < 900 || s < 900 ? (Math.floor(s / 60) % 2 ? R : W) : W;
        this.addLight(c.lat, c.lon, hAt(t), col, 3);
      }
    }
    for (const [end, opp] of ends) {
      void opp;
      const hdg = end.hdg;
      // threshold (green) & runway end (red, seen from the other direction; shown combined)
      for (let k = -half; k <= half; k += 3) {
        const p = destination(end, hdg + 90, k);
        this.addLight(p.lat, p.lon, end.elev, G, 5);
      }
      // approach lighting system (simplified ALSF-II): 900 m centreline bars + crossbar at 300 m
      if (rw.length > 1800) {
        for (let d = 60; d <= 900; d += 30) {
          const c = destination(end, hdg + 180, d);
          for (let k = -2; k <= 2; k++) {
            const p = destination(c, hdg + 90, k * 1.2);
            this.addLight(p.lat, p.lon, end.elev, W, 4);
          }
          if (d === 300) for (let k = -15; k <= 15; k += 1.5) { const p = destination(c, hdg + 90, k); this.addLight(p.lat, p.lon, end.elev, W, 4); }
        }
      }
      // PAPI on the left, 300 m past threshold
      const base = destination(end, hdg, 300);
      const thr = [3.5, 3.17, 2.83, 2.5];
      for (let i = 0; i < 4; i++) {
        const p = destination(base, hdg - 90, half + 15 + i * 9);
        const pt = this.addLight(p.lat, p.lon, end.elev + 0.6, R, 7);
        this.papi.push({ p: pt, pos: { lat: p.lat, lon: p.lon, h: end.elev + this.geoidOffset }, thr: thr[i], end });
      }
    }
  }

  // ───────────────────────── weather: clouds, fog, time ─────────────────────────
  updateWeather(w: WeatherState, ac: { lat: number; lon: number }, force = false) {
    const key = JSON.stringify(w.clouds);
    const need = force || !this.cloudsAt || this.cloudsAt.key !== key || distance(this.cloudsAt, ac) > 12000;
    // fog density from visibility (fog = 1 - exp(-(d*density)^2))
    this.scene.fog.density = clamp(1.8 / Math.max(w.visibility, 150), 1.5e-5, 0.012);
    this.scene.fog.minimumBrightness = 0.2;
    if (!need) return;
    this.cloudsAt = { lat: ac.lat, lon: ac.lon, key };
    this.clouds.removeAll();
    let seed = Math.floor(ac.lat * 100) * 7919 + Math.floor(ac.lon * 100);
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed & 0xffff) / 0xffff; };
    for (const layer of w.clouds) {
      const thick = layer.top - layer.base;
      const n = Math.round(60 + layer.cover * 260);
      const R = 45000;
      for (let i = 0; i < n; i++) {
        if (rnd() > layer.cover + 0.1) continue;
        const brg = rnd() * 360, d = Math.sqrt(rnd()) * R;
        const p = destination(ac, brg, d);
        const stratus = layer.cover > 0.8;
        const size = stratus ? 2500 + rnd() * 2500 : 700 + rnd() * 1500;
        const hgt = stratus ? Math.min(thick, 600) : Math.min(thick, size * (0.4 + rnd() * 0.5));
        this.clouds.add({
          position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, layer.base + hgt * 0.5),
          scale: new Cesium.Cartesian2(size * 1.6, hgt * 1.3),
          maximumSize: new Cesium.Cartesian3(size, hgt * 0.8, size * 0.8),
          slice: stratus ? 0.36 : 0.3 + rnd() * 0.3,
          brightness: w.precip >= 2 ? 0.55 : stratus ? 0.8 : 1.0,
        });
      }
    }
  }
  setTime(date: Date, rate: number) {
    this.viewer.clock.currentTime = Cesium.JulianDate.fromDate(date);
    this.viewer.clock.multiplier = rate;
  }
  /** Solar elevation-based darkness 0 (day) .. 1 (night) at a location. */
  nightFactor(lat: number, lon: number): number {
    const sun = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(this.viewer.clock.currentTime);
    const icrfToFixed = Cesium.Transforms.computeIcrfToFixedMatrix(this.viewer.clock.currentTime) ?? Cesium.Transforms.computeTemeToPseudoFixedMatrix(this.viewer.clock.currentTime);
    const sunF = Cesium.Matrix3.multiplyByVector(icrfToFixed, sun, new Cesium.Cartesian3());
    const up = Cesium.Cartesian3.normalize(Cesium.Cartesian3.fromDegrees(lon, lat, 0), new Cesium.Cartesian3());
    const s = Cesium.Cartesian3.normalize(sunF, new Cesium.Cartesian3());
    const elev = Math.asin(Cesium.Cartesian3.dot(up, s)) * RAD;
    return clamp((2 - elev) / 10, 0, 1);
  }

  // ───────────────────────── cameras ─────────────────────────
  eyePoint(ac: Aircraft): V3 {
    const d = ac.def, r = d.dia / 2;
    if (d.fdm === 'rotor') return [d.L * 0.5 - Math.min(2.2, d.L * 0.18), -0.45, -r * 0.35];
    const k = d.cockpit === 'fighter' ? 0.2 : d.cat === 'ga' || d.cat === 'vintage' || d.cat === 'glider' ? (d.eng.mount === 'nose' ? 0.33 : 0.25) : d.cat === 'turboprop' ? 0.22 : Math.min(0.1, 3.0 / d.L + 0.02);
    const seat = d.cockpit === 'fighter' || d.seats === 1 || d.cat === 'glider' || d.id === 'j3cub' || d.id === 'extra330' ? 0 : -Math.min(0.55, r * 0.35);
    return [d.L * 0.5 - k * d.L, seat, -r * (d.cockpit === 'fighter' ? 0.75 : 0.42)];
  }

  updateCamera(ac: Aircraft, dt: number) {
    const cam = this.scene.camera;
    const fr = cam.frustum as Cesium.PerspectiveFrustum;
    const cockpit = this.view === 'cockpit' || this.view === 'cockpit-hud';
    this.scene.screenSpaceCameraController.enableInputs = this.view === 'free';
    if (this.view === 'free') { fr.yOffset = 0; return; }
    if (cockpit) {
      const eye = this.bodyToWorld(ac, this.eyePoint(ac));
      const q = qMul(ac.q, qFromEuler(this.head.yaw * DEG, this.head.pitch * DEG, 0));
      const [psi, th, ph] = qToEuler(q);
      fr.fov = clamp(70 / this.head.zoom, 20, 100) * DEG;
      // shift the projection centre into the visible area above the instrument panel
      fr.yOffset = this.view === 'cockpit' ? 0 : 0;
      cam.setView({ destination: eye, orientation: { heading: psi, pitch: th, roll: ph } });
      return;
    }
    fr.yOffset = 0;
    fr.fov = clamp(60 / this.head.zoom, 10, 100) * DEG;
    const target = Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, ac.alt + this.geoidOffset);
    if (this.view === 'chase') {
      // follow heading and a smoothed fraction of pitch; not roll (like MSFS drone/chase)
      const size = Math.max(ac.def.L, ac.def.b) * 1.35 + 8;
      const tq = qFromEuler(ac.psi, ac.theta * 0.35, 0);
      this.chaseQ = this.chaseQ ? slerpQ(this.chaseQ, tq, 1 - Math.exp(-dt * 3)) : tq;
      const [cpsi, cth] = qToEuler(this.chaseQ);
      const hdg = cpsi + (this.chase.yaw - 180) * DEG + Math.PI;
      const pitch = cth + this.chase.pitch * DEG;
      cam.lookAt(target, new Cesium.HeadingPitchRange(hdg + Math.PI, pitch, size * this.chase.dist));
      cam.lookAtTransform(Cesium.Matrix4.IDENTITY);
      return;
    }
    if (this.view === 'tower') {
      if (!this.towerPos || distance(this.towerPos, ac) > 15000) {
        const n = this.db.nearest(ac, 1, 30000)[0];
        if (n) {
          const rw = n.apt.runways[0];
          const mid = rw ? destination(rw.le, rw.le.hdg, rw.length / 2) : n.apt;
          const p = destination(mid, (rw?.le.hdg ?? 0) + 90, 350);
          this.towerPos = { lat: p.lat, lon: p.lon, h: n.apt.elev + 35 };
        } else {
          const p = destination(ac, ac.heading + 30, 1500);
          this.towerPos = { lat: p.lat, lon: p.lon, h: ac.alt + 30 };
        }
      }
      this.lookFrom(this.towerPos, target, ac);
      return;
    }
    if (this.view === 'flyby') {
      if (!this.flybyPos || distance(this.flybyPos, ac) > 1500 + ac.gs * 6) {
        const p = destination(ac, ac.track + 8, 300 + ac.gs * 5);
        this.flybyPos = { lat: p.lat, lon: p.lon, h: Math.max(ac.alt - 15, this.elevation.ground(p.lat, p.lon).h + 3) };
      }
      this.lookFrom(this.flybyPos, target, ac);
    }
  }
  private lookFrom(from: { lat: number; lon: number; h: number }, target: Cesium.Cartesian3, ac: Aircraft) {
    const cam = this.scene.camera;
    const pos = Cesium.Cartesian3.fromDegrees(from.lon, from.lat, from.h + this.geoidOffset);
    const d = Cesium.Cartesian3.distance(pos, target);
    const fr = cam.frustum as Cesium.PerspectiveFrustum;
    fr.fov = clamp(2 * Math.atan((Math.max(ac.def.L, ac.def.b) * 3) / d) * this.head.zoom ** -1, 1.5 * DEG, 60 * DEG);
    const dir = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(target, pos, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    const up = Cesium.Cartesian3.normalize(pos, new Cesium.Cartesian3());
    cam.setView({ destination: pos, orientation: { direction: dir, up } });
  }

  /** World-map style overview (menu background). */
  flyOverview(lat: number, lon: number, height = 25000) {
    this.runways.update(lat, lon, true);
    this.scene.screenSpaceCameraController.enableInputs = true;
    (this.scene.camera.frustum as Cesium.PerspectiveFrustum).yOffset = 0;
    this.scene.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, lat - height / 180000, height), orientation: { heading: 0, pitch: -55 * DEG, roll: 0 }, duration: 2 });
  }

  private routeLines: Cesium.PolylineCollection;
  /** Route line drawn synchronously (no geometry web worker), densified along great circles. */
  showRoute(pts: { lat: number; lon: number }[]) {
    this.routeLines.removeAll();
    if (pts.length < 2) return;
    const positions: Cesium.Cartesian3[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const d = distance(a, b);
      const n = Math.max(1, Math.ceil(d / 40000));
      const va = Cesium.Cartesian3.fromDegrees(a.lon, a.lat, 0), vb = Cesium.Cartesian3.fromDegrees(b.lon, b.lat, 0);
      const ua = Cesium.Cartesian3.normalize(va, new Cesium.Cartesian3()), ub = Cesium.Cartesian3.normalize(vb, new Cesium.Cartesian3());
      const om = Math.acos(clamp(Cesium.Cartesian3.dot(ua, ub), -1, 1));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const w1 = om < 1e-9 ? 1 - t : Math.sin((1 - t) * om) / Math.sin(om), w2 = om < 1e-9 ? t : Math.sin(t * om) / Math.sin(om);
        const u = new Cesium.Cartesian3(ua.x * w1 + ub.x * w2, ua.y * w1 + ub.y * w2, ua.z * w1 + ub.z * w2);
        const c = Cesium.Cartographic.fromCartesian(u);
        if (c) positions.push(Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, 200));
      }
    }
    positions.push(Cesium.Cartesian3.fromDegrees(pts[pts.length - 1].lon, pts[pts.length - 1].lat, 200));
    this.routeLines.add({ positions, width: 3, material: Cesium.Material.fromType('PolylineDash', { color: Cesium.Color.fromCssColorString('#d946ef'), dashLength: 16 }) });
  }

  // ───────────────────────── render-error recovery ─────────────────────────
  onRenderIssue: (msg: string, fatal: boolean) => void = () => {};
  private errTimes: number[] = [];
  private degraded = 0;
  static describeError(e: unknown): string {
    if (e === null || e === undefined) return String(e);
    if (typeof e === 'string') return e;
    const o = e as Record<string, unknown>;
    if (typeof o.name === 'string' && typeof o.message === 'string') return `${o.name}: ${o.message}`;
    if (typeof o.message === 'string') return o.message;
    const parts: string[] = [];
    if (typeof Event !== 'undefined' && e instanceof Event) parts.push(`Event(${e.type})`);
    for (const k of ['statusCode', 'status', 'type', 'filename', 'url', 'response', 'error']) if (o[k] !== undefined) parts.push(`${k}=${String(o[k]).slice(0, 120)}`);
    try { const t = String(e); if (t !== '[object Object]') parts.push(t); } catch { /* ignore */ }
    if (!parts.length) { try { parts.push(JSON.stringify(e).slice(0, 200)); } catch { parts.push(Object.prototype.toString.call(e)); } }
    return parts.join(' ');
  }
  private handleRenderError(err: unknown) {
    const msg = World.describeError(err);
    console.error('Render error:', msg, err);
    // Benign race: an imagery layer's async provider settles just after the layer was replaced
    // (e.g. an imagery-source switch or its own error fallback) and is destroyed by then. The
    // switch's own explicit message has already told the user what happened — resume quietly.
    if (/was destroyed/i.test(msg)) { setTimeout(() => { this.viewer.useDefaultRenderLoop = true; }, 50); return; }
    const now = performance.now();
    this.errTimes = this.errTimes.filter(t => now - t < 10000);
    this.errTimes.push(now);
    // progressively disable optional features if the error keeps coming back
    if (this.errTimes.length >= 3 && this.degraded < 3) {
      this.degraded++;
      this.errTimes = [];
      if (this.degraded === 1) { this.routeLines.show = false; this.clouds.show = false; }
      if (this.degraded === 2) { this.scene.postProcessStages.fxaa.enabled = false; this.lights.show = false; this.rwyLights.show = false; if (this.tileset) this.tileset.show = false; this.scene.globe.show = true; }
      if (this.degraded === 3) { this.setImageryFallback(); }
    }
    const fatal = this.degraded >= 3 && this.errTimes.length >= 3;
    this.onRenderIssue(msg, fatal);
    if (!fatal) setTimeout(() => { this.viewer.useDefaultRenderLoop = true; }, 50); // resume rendering
  }
  private setImageryFallback() {
    const layers = this.viewer.imageryLayers;
    layers.removeAll();
    layers.add(Cesium.ImageryLayer.fromProviderAsync(Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')), {}));
  }

  hideRoute() { this.showRoute([]); }
}

function slerpQ(a: Q, b: Q, t: number): Q {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb: Q = d < 0 ? [-b[0], -b[1], -b[2], -b[3]] : b;
  d = Math.abs(d);
  if (d > 0.9995) {
    const r: Q = [a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t];
    const n = Math.hypot(...r);
    return [r[0] / n, r[1] / n, r[2] / n, r[3] / n];
  }
  const th = Math.acos(d), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
}
