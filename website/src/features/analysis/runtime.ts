import { Map as GLMap, NavigationControl, ScaleControl, setWorkerUrl, type GeoJSONSource, type ExpressionSpecification, type MapMouseEvent } from "maplibre-gl";
import { GeometryEditor, type GeometryFeature, type GeometryFeatureCollection } from "@jorisvdmije/map-master";
import type { QueryClient } from "@tanstack/react-query";
import { bbox } from "@turf/bbox";
import { assetPath } from "@/lib/paths";
import { basemapQuery, fallbackStyle } from "@/features/examples/queries";
import { categories, categoryKey, numericValue, valueLabel, type AnalysisArea, type Dataset, type Fields } from "./model";

import { PropertyCard, propertyContent } from "@/features/examples/property-card";

export async function mountAnalysis(container: HTMLElement, signal: AbortSignal, client: QueryClient, pick: (index: number) => void, notice: (text: string) => void) {
  if (signal.aborted) return;
  setWorkerUrl(assetPath("/maplibre-worker.mjs"));
  const map = new GLMap({ container, style: structuredClone(fallbackStyle), center: [4.897, 52.37], zoom: 12.5, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false, touchPitch: false, fadeDuration: 0 });
  map.touchZoomRotate.disableRotation();
  const remove = () => map.remove();
  signal.addEventListener("abort", remove, { once: true });
  await new Promise<void>(resolve => { map.once("load", () => resolve()); map.once("remove", () => resolve()); });
  if (signal.aborted) return;
  const runtime = new AnalysisRuntime(map, pick);
  signal.removeEventListener("abort", remove);
  signal.addEventListener("abort", () => runtime.destroy(), { once: true });
  void client.fetchQuery(basemapQuery).then(style => { if (!signal.aborted) map.setStyle(structuredClone(style)); }).catch(() => { if (!signal.aborted) notice("Street map unavailable. Your data and analysis still work on the plain map."); });
  return runtime;
}

/** The editor owns analysis polygons; source data is read-only and independently styled. */
export class AnalysisRuntime {
  readonly editor: GeometryEditor;
  private rendered: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  private source: Dataset | null = null;
  private card: PropertyCard;
  private unsubscribe: () => void;
  private observer: ResizeObserver;
  private frame = 0;
  constructor(readonly map: GLMap, pick: (index: number) => void) {
    this.editor = new GeometryEditor(map, { maxFeatures: 200, historyLimit: 100, snapping: { enabled: true },
      appearance: { feature: { fillColor: "#27836d", fillOpacity: .07, lineColor: "#216c58", lineWidth: 2 }, selected: { fillColor: "#27836d", fillOpacity: .10, lineColor: "#216c58", lineWidth: 2.5 }, draft: { fillColor: "#27836d", fillOpacity: .13, lineColor: "#216c58" }, vertex: { strokeColor: "#216c58", activeColor: "#216c58" } },
    });
    map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new ScaleControl({ maxWidth: 100 }), "bottom-left");
    this.card = new PropertyCard(map, "", "Feature properties"); this.card.addControl();
    this.unsubscribe = this.editor.onChange(() => { if (this.editor.getState().mode !== "idle") this.card.clear(); });
    map.on("mousemove", this.hover);
    map.on("idle", () => map.getContainer().setAttribute("aria-busy", "false"));
    map.on("dataloading", () => map.getContainer().setAttribute("aria-busy", "true"));
    map.on("style.load", this.attach);
    this.attach();
    map.on("click", event => {
      if (this.editor.getState().mode !== "idle" || !map.getLayer("analysis-points")) return;
      const hit = map.queryRenderedFeatures(event.point, { layers: ["analysis-points", "analysis-lines", "analysis-fills"] })[0];
      if (hit && typeof hit.id === "number") { pick(hit.id); this.showProperties(hit.id, event.point, true); } else this.card.clear();
    });
    this.observer = new ResizeObserver(() => {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => map.resize());
    });
    this.observer.observe(map.getContainer());
  }
  private attach = () => {
    if (this.map.getSource("analysis-data")) return;
    this.map.addSource("analysis-data", { type: "geojson", data: this.rendered });
    // Insert below the editor, so source polygons cannot hide area handles.
    const opacity: ExpressionSpecification = ["case", ["get", "matched"], 1, .12];
    this.map.addLayer({ id: "analysis-fills", type: "fill", source: "analysis-data", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "matched"], .28, .04] } });
    this.map.addLayer({ id: "analysis-lines", type: "line", source: "analysis-data", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": ["case", ["get", "focused"], "#122f28", ["get", "color"]], "line-width": ["case", ["get", "focused"], 4, 2], "line-opacity": [...opacity] } });
    this.map.addLayer({ id: "analysis-points", type: "circle", source: "analysis-data", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": ["get", "color"], "circle-radius": ["+", ["get", "radius"], ["case", ["get", "focused"], 3, 0]], "circle-opacity": [...opacity], "circle-stroke-color": ["case", ["get", "focused"], "#173e32", "#ffffff"], "circle-stroke-width": ["case", ["get", "focused"], 3, 1.5], "circle-stroke-opacity": [...opacity] } });
  };
  private hover = (event: MapMouseEvent) => {
    if (this.editor.getState().mode !== "idle" || this.map.isMoving() || event.originalEvent.buttons || window.matchMedia("(hover: none)").matches || !this.map.getLayer("analysis-points")) { this.card.hide(); return; }
    const hit = this.map.queryRenderedFeatures(event.point, { layers: ["analysis-points", "analysis-lines", "analysis-fills"] })[0];
    this.map.getCanvas().style.cursor = hit ? "pointer" : "";
    if (hit && typeof hit.id === "number") this.showProperties(hit.id, event.point); else this.card.leave();
  };
  private showProperties(index: number, point: { x: number; y: number }, pin = false) {
    const feature = this.source?.data.features[index]; if (!feature) return;
    const build = () => propertyContent(valueLabel(feature.properties.name ?? feature.id ?? `Feature ${index + 1}`), Object.entries(feature.properties).map(([label, value]) => ({ label, value: valueLabel(value) })), feature.geometry.type, "Click to pin in the center · Esc to dismiss");
    if (pin) this.card.pin(String(index), build); else this.card.hover(String(index), point, build);
  }
  render(dataset: Dataset, rows: number[], fields: Fields, focused: number | null) {
    if (this.source !== dataset) this.card.clear(); this.source = dataset;
    this.map.getContainer().setAttribute("aria-busy", "true");
    this.map.getContainer().dataset.featureCount = String(dataset.data.features.length);
    const matched = new Set(rows);
    const palette = new Map(categories(dataset.data.features, fields.category).map(c => [c.key, c.color]));
    const values = dataset.data.features.map(f => numericValue(f.properties[fields.metric])).filter(v => v !== null);
    const min = values.length ? Math.min(...values) : 0, max = values.length ? Math.max(...values) : 0;
    this.rendered = { type: "FeatureCollection", features: dataset.data.features.map((f, i) => {
      const value = numericValue(f.properties[fields.metric]);
      const radius = fields.size && value !== null ? 4 + (max === min ? .5 : Math.sqrt((value - min) / (max - min))) * 7 : 5.5;
      return { type: "Feature", id: i, geometry: f.geometry, properties: { color: palette.get(categoryKey(fields.category ? f.properties[fields.category] : "All features")) ?? "#27836d", radius, matched: matched.has(i), focused: focused === i } };
    }) };
    (this.map.getSource("analysis-data") as GeoJSONSource | undefined)?.setData(this.rendered);
  }
  fit(dataset: Dataset, row?: number) {
    const target = row === undefined ? dataset.data : dataset.data.features[row];
    if (!target || target.type === "FeatureCollection" && !target.features.length) return;
    const bounds = bbox(target);
    this.map.fitBounds([[bounds[0]!, bounds[1]!], [bounds[2]!, bounds[3]!]], { padding: 65, maxZoom: row === undefined ? 15 : 17, duration: 0 });
  }
  replaceAreas(areas: AnalysisArea[]) {
    if (this.editor.getState().mode !== "idle") throw new Error("Finish or cancel your current area first.");
    const current = this.editor.exportGeoJSON();
    const incoming = areas.map((f, i) => ({ ...f, id: `area-${i + 1}`, properties: { name: typeof f.properties?.name === "string" ? f.properties.name : `Area ${i + 1}` } })) as unknown as GeometryFeatureCollection["features"];
    const previous = new Set(current.features.map(f => f.id));
    const next = new Set(incoming.map(f => f.id));
    this.editor.applyTransaction({ update: incoming.filter(f => previous.has(f.id)), create: incoming.filter(f => !previous.has(f.id)), delete: current.features.filter(f => !next.has(f.id)).map(f => f.id) });
    this.editor.clearHistory();
  }
  addArea(feature: AnalysisArea) {
    this.editor.importGeoJSON({ type: "Feature", geometry: feature.geometry, id: crypto.randomUUID(), properties: { name: typeof feature.properties?.name === "string" ? feature.properties.name : "Imported area" } });
  }
  areas(): AnalysisArea[] {
    return this.editor.exportGeoJSON().features.filter((f: GeometryFeature) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon") as AnalysisArea[];
  }
  destroy() { this.unsubscribe(); this.card.destroy(); this.map.off("mousemove", this.hover); this.observer.disconnect(); cancelAnimationFrame(this.frame); this.map.off("style.load", this.attach); this.map.remove(); }
}
