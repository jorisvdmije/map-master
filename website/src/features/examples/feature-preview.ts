import type { Map, MapMouseEvent } from "maplibre-gl";
import type { GeometryEditor, GeometryFeature } from "@jorisvdmije/map-master";
import { featurePreview, type FeaturePreviewOptions } from "@jorisvdmije/map-master";
import { PropertyCard, propertyContent } from "./property-card";

/** Safe property cards shared by documentation and playground. */
export function attachFeaturePreview(map: Map, editor: GeometryEditor, options: (feature: GeometryFeature) => FeaturePreviewOptions = () => ({})): { destroy: () => void; refresh: () => void } {
  const card = new PropertyCard(map, "mm-feature-preview-popup", "Feature properties"); card.addControl();
  const canvas = map.getCanvas();
  let pending: number | null = null, latest: { x: number; y: number } | null = null;
  const clear = () => { card.clear(); latest = null; if (pending !== null) cancelAnimationFrame(pending); pending = null; };
  const show = (feature: GeometryFeature, point: { x: number; y: number }, pin = false) => {
    if (!pin && card.pinned) return;
    const config = options(feature);
    if (config.enabled === false) { card.clear(); return; }
    const build = () => {
      const content = featurePreview(feature, config)!;
      return propertyContent(content.title, content.rows, `${feature.geometry.type} · ID ${String(feature.id).slice(0, 120)}`, content.omittedFields ? `${content.omittedFields} more ${content.omittedFields === 1 ? "property" : "properties"} · Click to pin in the center` : "Click to pin in the center · Esc to dismiss");
    };
    if (pin) card.pin(JSON.stringify(feature.id), build); else card.hover(JSON.stringify(feature.id), point, build);
  };
  const move = (event: MapMouseEvent) => {
    if (editor.getState().mode !== "idle" || map.isMoving() || event.originalEvent.buttons || window.matchMedia("(hover: none)").matches) { card.hide(); return; }
    latest = { x: event.point.x, y: event.point.y };
    pending ??= requestAnimationFrame(() => {
      pending = null; if (!latest) return;
      const feature = editor.queryFeatures(latest)[0];
      if (feature) show(feature, latest); else card.leave();
    });
  };
  const click = (event: MapMouseEvent) => {
    if (editor.getState().mode !== "idle") return;
    const feature = editor.queryFeatures(event.point)[0];
    if (feature) show(feature, event.point, true); else clear();
  };
  const inspectSelection = () => {
    const state = editor.getState();
    if (canvas.ownerDocument.activeElement !== canvas || state.mode !== "idle" || state.selectedFeatureIds.length !== 1) return;
    const feature = editor.getSelected(); if (feature && !card.isDismissed(JSON.stringify(feature.id))) show(feature, { x: 0, y: 0 }, true);
  };
  let revision = editor.getState().dataRevision, layers = editor.getState().dataLayerRevision, selection = JSON.stringify(editor.getState().selectedFeatureIds);
  const changed = editor.onChange(() => {
    if (editor.getState().mode !== "idle") { clear(); return; }
    const state = editor.getState();
    if (state.dataRevision !== revision || state.dataLayerRevision !== layers) clear();
    revision = state.dataRevision; layers = state.dataLayerRevision;
    card.hide();
    const nextSelection = JSON.stringify(state.selectedFeatureIds);
    if (selection !== nextSelection) { selection = nextSelection; inspectSelection(); }
  });
  canvas.addEventListener("focus", inspectSelection);
  map.on("mousemove", move); map.on("click", click);
  return { destroy: () => { changed(); clear(); card.destroy(); map.off("mousemove", move); map.off("click", click); canvas.removeEventListener("focus", inspectSelection); }, refresh: clear };
}
