import { Map as GLMap, NavigationControl, ScaleControl, setWorkerUrl, type GeoJSONSource, type MapMouseEvent } from "maplibre-gl";
import type { QueryClient } from "@tanstack/react-query";
import type { FeatureCollection } from "geojson";
import { bbox } from "@turf/bbox";
import { assetPath } from "@/lib/paths";
import { basemapQuery, fallbackStyle } from "@/features/examples/queries";
import { available, availabilityColor, wardStats, statusColor, statusLabel, type CapacityMode, type Model, type Permit, type Ward, type Statistics, type HoverMode } from "./model";

import { PropertyCard, propertyContent } from "@/features/examples/property-card";

type Handlers = { ward: (code: string) => void; permit: (id: string) => void; notice: (text: string) => void };

export async function mountBnb(container: HTMLElement, signal: AbortSignal, client: QueryClient, handlers: Handlers) {
  if (signal.aborted) return;
  setWorkerUrl(assetPath("/maplibre-worker.mjs"));
  const map = new GLMap({ container, style: structuredClone(fallbackStyle), center: [4.94, 52.36], zoom: 10.5, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false, touchPitch: false, fadeDuration: 0 });
  map.touchZoomRotate.disableRotation();
  const remove = () => map.remove(); signal.addEventListener("abort", remove, { once: true });
  await new Promise<void>(resolve => { map.once("load", () => resolve()); map.once("remove", () => resolve()); });
  if (signal.aborted) return;
  const runtime = new BnbRuntime(map, handlers);
  signal.removeEventListener("abort", remove); signal.addEventListener("abort", () => runtime.destroy(), { once: true });
  void client.fetchQuery(basemapQuery).then(style => { if (!signal.aborted) map.setStyle(structuredClone(style)); }).catch(() => { if (!signal.aborted) handlers.notice("De achtergrondkaart is niet beschikbaar. De wijken en het dashboard blijven werken."); });
  return runtime;
}

export class BnbRuntime {
  private wards: FeatureCollection = { type: "FeatureCollection", features: [] };
  private permits: FeatureCollection = { type: "FeatureCollection", features: [] };
  private model: Model | null = null;
  private wardInfo = new Map<string, { ward: Ward; stats: Statistics }>();
  private permitInfo = new Map<string, Permit>();
  private mode: CapacityMode = "current";
  private card: PropertyCard;
  private hoverWard: string | null = null;
  private observer: ResizeObserver;
  private frame = 0;
  constructor(readonly map: GLMap, handlers: Handlers) {
    map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new ScaleControl({ maxWidth: 100 }), "bottom-left");
    this.card = new PropertyCard(map, "bb-hover-card");
    map.on("style.load", this.attach); this.attach();
    map.on("click", event => {
      if (!map.getLayer("bnb-locations")) return;
      const point = map.queryRenderedFeatures(event.point, { layers: ["bnb-locations"] })[0];
      // Tile encoding need not preserve string feature IDs; the record property does.
      if (typeof point?.properties?.recordId === "string") { handlers.permit(point.properties.recordId); const permit = this.permitInfo.get(point.properties.recordId); if (permit) this.showProperties(permit.ward, permit, event.point, true); return; }
      const ward = map.queryRenderedFeatures(event.point, { layers: ["bnb-wards"] })[0];
      if (typeof ward?.properties?.code === "string") { handlers.ward(ward.properties.code); this.showProperties(ward.properties.code, undefined, event.point, true); } else this.card.clear();
    });
    map.on("mousemove", this.moveHover);
    map.on("movestart", this.hideHover);
    map.on("moveend", this.syncCamera);
    map.on("dataloading", this.loading);
    map.on("idle", this.idle);
    this.loading();
    map.getCanvasContainer().addEventListener("mouseleave", this.hideHover);
    map.getCanvas().addEventListener("keydown", this.dismissHover);
    this.syncCamera();
    this.observer = new ResizeObserver(() => { cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(() => map.resize()); });
    this.observer.observe(map.getContainer());
  }
  private attach = () => {
    if (this.map.getSource("bnb-ward-data")) return;
    this.hideHover();
    this.map.addSource("bnb-ward-data", { type: "geojson", data: this.wards });
    this.map.addSource("bnb-location-data", { type: "geojson", data: this.permits });
    const before = this.map.getStyle().layers.find(l => l.type === "symbol")?.id;
    this.map.addLayer({ id: "bnb-wards", type: "fill", source: "bnb-ward-data", paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "muted"], .13, ["get", "selected"], .4, .48] } }, before);
    this.map.addLayer({ id: "bnb-ward-outlines", type: "line", source: "bnb-ward-data", paint: { "line-color": ["case", ["get", "selected"], "#173c2c", "#4a6654"], "line-width": ["case", ["get", "selected"], 2.8, 1.6], "line-opacity": 1 } }, before);
    this.map.addLayer({ id: "bnb-ward-hover", type: "line", source: "bnb-ward-data", filter: ["==", ["get", "code"], ""], paint: { "line-color": "#173c2c", "line-width": 3 } }, before);
    this.map.addLayer({ id: "bnb-locations", type: "circle", source: "bnb-location-data", paint: { "circle-radius": ["case", ["get", "focused"], 8, ["get", "pending"], 5.5, 4.5], "circle-color": ["get", "color"], "circle-opacity": .94, "circle-stroke-color": ["case", ["get", "focused"], "#193c30", "#ffffff"], "circle-stroke-width": ["case", ["get", "focused"], 2.5, ["get", "pending"], 2, 1.2] } });
  };
  render(model: Model, selected: string | null, permits: Permit[], mode: CapacityMode, focused: string | null) {
    if (this.mode !== mode) this.card.clear();
    this.hideHover(); this.mode = mode;
    if (this.model !== model) {
      this.model = model;
      this.wardInfo = new Map(model.wards.features.map(ward => [ward.properties.code, { ward, stats: wardStats(model, ward.properties.code) }]));
    }
    this.permitInfo = new Map(permits.map(p => [p.id, p]));
    if (this.card.key?.startsWith("permit:") && !this.permitInfo.has(this.card.key.slice(7))) this.card.clear();
    this.wards = { type: "FeatureCollection", features: model.wards.features.map(d => ({ ...d, properties: { ...d.properties, color: availabilityColor(available(this.wardInfo.get(d.properties.code)!.stats, mode)), selected: d.properties.code === selected, muted: selected !== null && d.properties.code !== selected } })) };
    this.permits = { type: "FeatureCollection", features: permits.map(p => ({ type: "Feature", id: p.id, geometry: { type: "Point", coordinates: p.coordinates }, properties: { recordId: p.id, pending: p.status === "pending", focused: p.id === focused, color: statusColor(p.status) } })) };
    (this.map.getSource("bnb-ward-data") as GeoJSONSource | undefined)?.setData(this.wards);
    (this.map.getSource("bnb-location-data") as GeoJSONSource | undefined)?.setData(this.permits);
  }
  setHoverMode(mode: HoverMode) { this.card.setMode(mode); this.hideHover(); }
  private syncCamera = () => { const c = this.map.getCenter(); this.map.getContainer().dataset.camera = JSON.stringify([c.lng, c.lat, this.map.getZoom()]); };
  private loading = () => { this.map.getContainer().setAttribute("aria-busy", "true"); };
  private idle = () => { this.map.getContainer().setAttribute("aria-busy", "false"); };
  private dismissHover = (event: KeyboardEvent) => { if (event.key === "Escape") this.hideHover(); };
  private hideHover = () => {
    this.card.hide();
    if (this.hoverWard !== null && this.map.getLayer("bnb-ward-hover")) this.map.setFilter("bnb-ward-hover", ["==", ["get", "code"], ""]);
    this.hoverWard = null;
  };
  private moveHover = (event: MapMouseEvent) => {
    if (!this.map.getLayer("bnb-wards") || this.map.isMoving() || event.originalEvent.buttons || window.matchMedia("(hover: none)").matches) { this.hideHover(); return; }
    const hits = this.map.queryRenderedFeatures(event.point, { layers: ["bnb-locations", "bnb-wards"] });
    const marker = hits.find(hit => typeof hit.properties?.recordId === "string");
    const permit = marker ? this.permitInfo.get(marker.properties.recordId as string) : undefined;
    const code = permit?.ward ?? hits.find(hit => typeof hit.properties?.code === "string")?.properties.code;
    const info = typeof code === "string" ? this.wardInfo.get(code) : undefined;
    this.map.getCanvas().style.cursor = info ? "pointer" : "";
    if (!info) { this.hideHover(); this.card.leave(); return; }
    if (this.hoverWard !== code) { this.hoverWard = code; this.map.setFilter("bnb-ward-hover", ["==", ["get", "code"], code]); }
    this.showProperties(String(code), permit, event.point);
  };
  private showProperties(code: string, permit: Permit | undefined, point: { x: number; y: number }, pin = false) {
    const info = this.wardInfo.get(code); if (!info) return;
    const key = permit ? `permit:${permit.id}` : `ward:${code}`;
    const build = () => {
      const rows = permit ? [{ label: "Status", value: statusLabel(permit.status) }, { label: "Gastplaatsen", value: String(permit.guests) }, ...(permit.pendingDays === null ? [] : [{ label: "In behandeling", value: `${permit.pendingDays} dagen` }])] : [];
      rows.push({ label: this.mode === "current" ? "Nu vrij" : "Vrij na aanvragen", value: String(available(info.stats, this.mode)) }, { label: "Verleend", value: String(info.stats.granted) }, { label: "Aanvragen in behandeling", value: String(info.stats.pending) }, { label: "Demoquotum", value: String(info.stats.quota) });
      return propertyContent(permit?.id ?? info.ward.properties.name, rows, permit ? `Fictieve locatie · ${info.ward.properties.name}` : "Vergunningswijk · voorbeeldcijfers", "Fictieve vergunningcijfers · klik om vast te zetten · Esc sluit", permit ? "mm-feature-preview bb-popup" : "mm-feature-preview");
    };
    if (pin) this.card.pin(key, build); else this.card.hover(key, point, build);
  }
  fit(model: Model, code: string | null) {
    const feature = code === null ? model.wards : model.wards.features.find(d => d.properties.code === code);
    if (!feature) return;
    const b = bbox(feature);
    this.map.fitBounds([[b[0]!, b[1]!], [b[2]!, b[3]!]], { padding: code === null ? 35 : 55, maxZoom: code === null ? 11.5 : 13.8, duration: 0 });
  }
  focus(permit: Permit | null) {
    if (!permit) { if (this.card.key?.startsWith("permit:")) this.card.clear(); return; }
    this.showProperties(permit.ward, permit, { x: 0, y: 0 }, true);
  }
  destroy() { this.observer.disconnect(); cancelAnimationFrame(this.frame); this.hideHover(); this.card.destroy(); this.map.off("mousemove", this.moveHover); this.map.off("movestart", this.hideHover); this.map.off("moveend", this.syncCamera); this.map.off("dataloading", this.loading); this.map.off("idle", this.idle); this.map.getCanvasContainer().removeEventListener("mouseleave", this.hideHover); this.map.getCanvas().removeEventListener("keydown", this.dismissHover); this.map.off("style.load", this.attach); this.map.remove(); }
}
