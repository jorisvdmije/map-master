import { Popup, type Map, type MapMouseEvent } from "maplibre-gl";
import type { GeometryEditor, GeometryFeature } from "@jorisvdmije/map-master";
import { featurePreview, type FeaturePreviewOptions } from "@jorisvdmije/map-master";

/** One safe, bounded property card shared by the documentation and playground. */
export function attachFeaturePreview(map: Map, editor: GeometryEditor, options: (feature: GeometryFeature) => FeaturePreviewOptions = () => ({})): { destroy: () => void; refresh: () => void } {
  const popup = new Popup({ closeButton: false, closeOnClick: false, focusAfterOpen: false, offset: 16, maxWidth: "min(300px, calc(100% - 24px))", className: "mm-feature-preview-popup" });
  const canvas = map.getCanvas();
  let pending: number | null = null;
  let latest: { x: number; y: number } | null = null;
  let current: string | null = null;
  let dismissed: string | null = null;
  const key = (feature: GeometryFeature) => JSON.stringify(feature.id);
  const clear = () => { popup.remove(); current = null; latest = null; if (pending !== null) cancelAnimationFrame(pending); pending = null; };
  const show = (feature: GeometryFeature, point: { x: number; y: number }) => {
    const id = key(feature);
    if (id === dismissed || id === current) return;
    const content = featurePreview(feature, options(feature));
    if (!content) { clear(); return; }
    dismissed = null; current = id;
    const doc = canvas.ownerDocument; const card = doc.createElement("section");
    card.className = "mm-feature-preview"; card.setAttribute("aria-label", "Feature properties"); card.tabIndex = 0;
    card.style.maxHeight = `${Math.max(56, Math.min(280, Math.max(point.y, canvas.clientHeight - point.y) - 40))}px`;
    const title = doc.createElement("h3"); title.textContent = content.title; card.append(title);
    const meta = doc.createElement("p"); meta.textContent = `${feature.geometry.type} · ID ${String(feature.id).slice(0, 120)}`; card.append(meta);
    const list = doc.createElement("dl");
    for (const { label, value } of content.rows) {
      const dt = doc.createElement("dt"); dt.textContent = label;
      const dd = doc.createElement("dd"); dd.textContent = value; list.append(dt, dd);
    }
    card.append(list);
    const hint = doc.createElement("small"); hint.textContent = content.omittedFields ? `${content.omittedFields} more ${content.omittedFields === 1 ? "property" : "properties"} · Select to inspect all` : "Esc to dismiss · Select to inspect or edit";
    card.append(hint);
    popup.setLngLat(map.unproject([point.x, point.y])).setDOMContent(card).addTo(map);
    popup.getElement().addEventListener("mouseleave", clear, { once: true });
  };
  const move = (event: MapMouseEvent) => {
    latest = event.point;
    pending ??= requestAnimationFrame(() => {
      pending = null;
      if (!latest) return;
      const feature = editor.queryFeatures(latest)[0];
      if (!feature) { clear(); dismissed = null; return; }
      show(feature, latest);
    });
  };
  const leave = (event: MapMouseEvent) => {
    const target = event.originalEvent.relatedTarget;
    if (target instanceof Node && popup.getElement()?.contains(target)) return;
    clear(); dismissed = null;
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !popup.isOpen()) return;
    event.preventDefault(); event.stopPropagation(); dismissed = current; clear();
  };
  const inspectSelection = () => {
    const state = editor.getState();
    // Keyboard selection exposes the same information without hover.
    if (canvas.ownerDocument.activeElement !== canvas || state.mode !== "idle" || state.selectedFeatureIds.length !== 1) return;
    const feature = editor.getSelected();
    if (feature?.geometry.type === "Point") show(feature, map.project(feature.geometry.coordinates));
  };
  const changed = editor.onChange(() => {
    clear(); dismissed = null; inspectSelection();
  });
  canvas.addEventListener("focus", inspectSelection);
  map.on("mousemove", move); map.on("mouseout", leave); map.on("movestart", clear);
  canvas.ownerDocument.addEventListener("keydown", escape, true);
  const destroy = () => {
    changed(); clear(); map.off("mousemove", move); map.off("mouseout", leave); map.off("movestart", clear);
    canvas.removeEventListener("focus", inspectSelection);
    canvas.ownerDocument.removeEventListener("keydown", escape, true);
  };
  return { destroy, refresh: () => { clear(); dismissed = null; } };
}
