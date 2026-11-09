import {
  Map as GLMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";
import {
  GeometryEditor,
  type ReachabilityResult,
  type Coordinate,
} from "@jorisvdmije/map-master";
import type { FeatureCollection } from "geojson";
import type { QueryClient } from "@tanstack/react-query";
import { bbox } from "@turf/bbox";
import { assetPath } from "@/lib/paths";
import { basemapQuery, fallbackStyle } from "@/features/examples/queries";

export type MeasureState = {
  drawing: boolean;
  canFinish: boolean;
  count: number;
};
export async function mountReachability(
  container: HTMLElement,
  signal: AbortSignal,
  client: QueryClient,
  origin: Coordinate,
  choose: (p: Coordinate) => void,
  state: (s: MeasureState) => void,
) {
  if (signal.aborted) return;
  setWorkerUrl(assetPath("/maplibre-worker.mjs"));
  const map = new GLMap({
    container,
    style: structuredClone(fallbackStyle),
    center: origin,
    zoom: 12.5,
    attributionControl: { compact: true },
    fadeDuration: 0,
  });
  const remove = () => map.remove();
  signal.addEventListener("abort", remove, { once: true });
  await new Promise<void>((resolve) => {
    map.once("load", () => resolve());
    map.once("remove", () => resolve());
  });
  if (signal.aborted) return;
  const runtime = new ReachabilityRuntime(map, choose, state);
  signal.removeEventListener("abort", remove);
  signal.addEventListener("abort", () => runtime.destroy(), { once: true });
  void client
    .fetchQuery(basemapQuery)
    .then((style) => {
      if (!signal.aborted) map.setStyle(style);
    })
    .catch(() => {
      if (!signal.aborted) container.dataset.basemap = "unavailable";
    });
  return runtime;
}
export class ReachabilityRuntime {
  readonly editor: GeometryEditor;
  private contours: FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };
  private points: FeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };
  private origin: Coordinate = [4.904, 52.367];
  private picking = false;
  private observer: ResizeObserver;
  private unsubscribe: () => void;
  private frame = 0;
  constructor(
    readonly map: GLMap,
    choose: (p: Coordinate) => void,
    changed: (s: MeasureState) => void,
  ) {
    map.addControl(new NavigationControl(), "bottom-right");
    map.addControl(new ScaleControl(), "bottom-left");
    this.editor = new GeometryEditor(map, {
      measurements: { enabled: true, locale: "nl", lineStyle: "along-line" },
    });
    const offChange = this.editor.onChange(() => {
      const state = this.editor.getState();
      changed({
        drawing: state.mode === "draw-line",
        canFinish: state.canFinish,
        count: this.editor.exportGeoJSON().features.length,
      });
    });
    const offCreate = this.editor.onCreate((feature) => {
      this.editor.select(feature.id);
    });
    this.unsubscribe = () => {
      offChange();
      offCreate();
    };
    map.on("style.load", this.attach);
    this.attach();
    map.on("click", (e) => {
      if (this.picking && this.editor.getState().mode === "idle") {
        this.pickOrigin(false);
        choose([e.lngLat.lng, e.lngLat.lat]);
      }
    });
    map.on("idle", () => {
      map.getContainer().dataset.idle = "true";
      map.getContainer().dataset.camera = JSON.stringify([
        map.getCenter().lng,
        map.getCenter().lat,
        map.getZoom(),
      ]);
    });
    map.on("movestart", () => {
      map.getContainer().dataset.idle = "false";
    });
    this.observer = new ResizeObserver(() => {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => map.resize());
    });
    this.observer.observe(map.getContainer());
  }
  private attach = () => {
    if (this.map.getSource("ra-contours")) return;
    this.map.addSource("ra-contours", { type: "geojson", data: this.contours });
    this.map.addSource("ra-data", { type: "geojson", data: this.points });
    this.map.addSource("ra-origin", {
      type: "geojson",
      data: { type: "Point", coordinates: this.origin },
    });
    const before = this.map
      .getStyle()
      .layers.find((l) => l.type === "symbol")?.id;
    this.map.addLayer(
      {
        id: "ra-fill",
        type: "fill",
        source: "ra-contours",
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.22 },
      },
      before,
    );
    this.map.addLayer(
      {
        id: "ra-lines",
        type: "line",
        source: "ra-contours",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2,
          "line-opacity": 0.8,
        },
      },
      before,
    );
    this.map.addLayer({
      id: "ra-data-fills",
      type: "fill",
      source: "ra-data",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#bf774d", "fill-opacity": 0.12 },
    });
    this.map.addLayer({
      id: "ra-data-lines",
      type: "line",
      source: "ra-data",
      filter: ["in", ["geometry-type"], ["literal", ["LineString", "Polygon"]]],
      paint: {
        "line-color": "#bf774d",
        "line-width": 1.5,
        "line-opacity": 0.75,
      },
    });
    this.map.addLayer({
      id: "ra-data",
      type: "circle",
      source: "ra-data",
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 4,
        "circle-color": "#bf774d",
        "circle-stroke-width": 0.8,
        "circle-stroke-color": "#fffdf5",
        "circle-opacity": 0.8,
      },
    });
    this.map.addLayer({
      id: "ra-origin",
      type: "circle",
      source: "ra-origin",
      paint: {
        "circle-radius": 7,
        "circle-color": "#275e50",
        "circle-stroke-width": 3,
        "circle-stroke-color": "#fffdf5",
      },
    });
  };
  setOrigin(origin: Coordinate) {
    this.origin = origin;
    this.map.getContainer().dataset.origin = JSON.stringify(origin);
    (this.map.getSource("ra-origin") as GeoJSONSource | undefined)?.setData({
      type: "Point",
      coordinates: origin,
    });
  }
  pickOrigin(enabled: boolean) {
    this.editor.cancel();
    this.picking = enabled;
    this.map.getCanvas().style.cursor = enabled ? "crosshair" : "";
  }
  measure() {
    this.pickOrigin(false);
    this.editor.draw("LineString");
  }
  clearMeasurement() {
    this.editor.cancel();
    this.editor.selectMany(
      this.editor.exportGeoJSON().features.map((f) => f.id),
    );
    this.editor.deleteSelection();
  }
  render(
    result: ReachabilityResult | undefined,
    intervals: boolean,
    data?: FeatureCollection,
  ) {
    const palette = ["#258d80", "#b99742", "#b96752", "#8572ac"];
    const source = result
      ? intervals
        ? result.bands
        : { ...result.contours, features: result.contours.features.slice(-1) }
      : { type: "FeatureCollection", features: [] };
    this.contours = {
      type: "FeatureCollection",
      features: source.features.map((f, i) => ({
        ...f,
        properties: { ...f.properties, color: palette[i % palette.length] },
      })),
    };
    this.points = data ?? { type: "FeatureCollection", features: [] };
    (this.map.getSource("ra-contours") as GeoJSONSource | undefined)?.setData(
      this.contours,
    );
    (this.map.getSource("ra-data") as GeoJSONSource | undefined)?.setData(
      this.points,
    );
    this.map.getContainer().dataset.contours = String(source.features.length);
  }
  fit() {
    if (!this.contours.features.length) return;
    const b = bbox(this.contours);
    this.map.fitBounds(
      [
        [b[0], b[1]],
        [b[2], b[3]],
      ],
      { padding: 45, maxZoom: 16, duration: 0 },
    );
  }
  destroy() {
    cancelAnimationFrame(this.frame);
    this.unsubscribe();
    this.observer.disconnect();
    this.editor.destroy();
    this.map.remove();
  }
}
