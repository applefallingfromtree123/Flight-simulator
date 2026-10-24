// World-map airport picker: every airport as a clickable marker on the globe (like the MSFS world
// map), labels for the big ones, and highlighted departure / arrival.
import * as Cesium from 'cesium';
import type { Airport, AirportDB } from './airports.ts';

const COL = {
  3: Cesium.Color.fromCssColorString('#5ec8ff'),
  2: Cesium.Color.fromCssColorString('#e6edf3'),
  1: Cesium.Color.fromCssColorString('#a2adb8').withAlpha(0.85),
};

export class AirportMap {
  private points: Cesium.PointPrimitiveCollection;
  private labels: Cesium.LabelCollection;
  private marks: Cesium.PointPrimitiveCollection;
  private markLabels: Cesium.LabelCollection;
  private handler: Cesium.ScreenSpaceEventHandler;
  private built = false;
  active = false;
  onPick: (apt: Airport) => void = () => {};

  constructor(private scene: Cesium.Scene, private db: AirportDB) {
    this.points = scene.primitives.add(new Cesium.PointPrimitiveCollection());
    this.labels = scene.primitives.add(new Cesium.LabelCollection());
    this.marks = scene.primitives.add(new Cesium.PointPrimitiveCollection());
    this.markLabels = scene.primitives.add(new Cesium.LabelCollection());
    this.handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    this.handler.setInputAction((e: { position: Cesium.Cartesian2 }) => {
      if (!this.active) return;
      const apt = this.pickAt(e.position);
      if (apt) this.onPick(apt);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    this.setActive(false);
  }

  /** Nearest marker within a finger-sized radius of the click/tap. */
  private pickAt(pos: Cesium.Cartesian2): Airport | null {
    const hits = this.scene.drillPick(pos, 8, 22, 22) as { id?: unknown }[];
    for (const h of hits) if (typeof h.id === 'string' && this.db.get(h.id)) return this.db.get(h.id)!;
    return null;
  }

  private build() {
    if (this.built || !this.db.ready) return;
    this.built = true;
    const near = (m: number) => new Cesium.DistanceDisplayCondition(0, m);
    for (const a of this.db.airports) {
      const pos = Cesium.Cartesian3.fromDegrees(a.lon, a.lat, a.elev + 30);
      this.points.add({
        position: pos, id: a.icao, color: COL[a.size], pixelSize: a.size === 3 ? 7 : a.size === 2 ? 5 : 4,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.6), outlineWidth: 1,
        distanceDisplayCondition: a.size === 3 ? undefined : near(a.size === 2 ? 4.5e6 : 9e5),
        disableDepthTestDistance: 2e5,
      });
      if (a.size === 3 || a.size === 2) {
        this.labels.add({
          position: pos, id: a.icao, text: a.icao, font: '600 12px "B612 Mono", monospace',
          fillColor: COL[a.size], outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(7, -7), horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          distanceDisplayCondition: near(a.size === 3 ? 2.5e6 : 5e5), disableDepthTestDistance: 2e5,
        });
      }
    }
  }

  setActive(on: boolean) {
    this.active = on;
    if (on) this.build();
    this.points.show = this.labels.show = this.marks.show = this.markLabels.show = on;
  }

  /** Highlight departure (green), arrival (magenta) and the currently inspected airport (yellow). */
  setSelection(dep?: Airport, arr?: Airport, focus?: Airport) {
    this.marks.removeAll(); this.markLabels.removeAll();
    const mark = (a: Airport | undefined, css: string, tag: string) => {
      if (!a) return;
      const pos = Cesium.Cartesian3.fromDegrees(a.lon, a.lat, a.elev + 40);
      const color = Cesium.Color.fromCssColorString(css);
      this.marks.add({ position: pos, id: a.icao, color, pixelSize: 13, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY });
      this.markLabels.add({ position: pos, id: a.icao, text: `${tag} ${a.icao}`, font: 'bold 13px "B612 Mono", monospace', fillColor: color, outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(10, 12), horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        disableDepthTestDistance: Number.POSITIVE_INFINITY });
    };
    if (focus && focus !== dep && focus !== arr) mark(focus, '#ffd23f', '');
    mark(arr, '#e45bf2', 'ARR');
    mark(dep, '#3ee07a', 'DEP');
  }

  /** Whole-globe / regional view centred on a point. */
  view(lat: number, lon: number, height: number, duration = 1.5) {
    this.scene.screenSpaceCameraController.enableInputs = true;
    (this.scene.camera.frustum as Cesium.PerspectiveFrustum).yOffset = 0;
    this.scene.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, height), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 }, duration });
  }
}
