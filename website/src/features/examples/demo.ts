import { Map, NavigationControl, setWorkerUrl, type StyleSpecification, type ErrorEvent as MapErrorEvent } from "maplibre-gl";
import { DataLayerControl, EditorToolbar, GeometryEditor, type ToolbarTool } from "@jorisvdmije/map-master";
import { assetPath } from "@/lib/paths";
import { defaultTheme } from "./appearance";
import { center, demos, type DemoConfig } from "./demos";
import type { DemoRuntime, DemoSnapshot } from "./types";
import { attachFeaturePreview } from "./feature-preview";

setWorkerUrl(assetPath("/maplibre-worker.mjs"));
const isPair = (tools: DemoConfig["tools"]): tools is readonly [readonly ToolbarTool[], readonly ToolbarTool[]] =>
  typeof tools[0] !== "string";

/** The only imperative UI boundary: MapLibre and the library's map controls. */
export async function mountDemo(container: HTMLElement, signal: AbortSignal, style: StyleSpecification): Promise<DemoRuntime | undefined> {
  if (signal.aborted) return;
  const config: DemoConfig = demos[container.dataset.demo!] ?? demos.home!;
  const map = new Map({
    container: container.querySelector<HTMLElement>(".demo-map")!,
    center, zoom: config.zoom ?? 15.6, minZoom: 12, maxZoom: 20,
    cooperativeGestures: true, dragRotate: false, pitchWithRotate: false,
    touchPitch: false, fadeDuration: 0, attributionControl: { compact: true },
  });
  map.touchZoomRotate.disableRotation();
  if (!isPair(config.tools)) map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
  let disposed = false;
  const subscriptions: (() => void)[] = [];
  const listeners = new Set<() => void>();
  signal.addEventListener("abort", () => {
    disposed = true;
    subscriptions.forEach(unsubscribe => unsubscribe());
    listeners.clear();
    map.remove(); // Also destroys the editor, controls and gesture listeners.
  }, { once: true });
  await new Promise<void>((resolve, reject) => {
    const onError = (event: MapErrorEvent) => {
      if (!map.loaded() && !event.error.message.includes("tiles")) reject(event.error);
    };
    map.on("error", onError);
    const settle = () => { map.off("error", onError); resolve(); };
    map.once("load", settle);
    map.once("remove", settle);
    // Validation errors can fire synchronously, before the constructor returns.
    map.setStyle(style);
  });
  if (disposed) return;

  const options = config.options ?? {};
  const editor = new GeometryEditor(map, {
    ...options, snapping: { enabled: true, ...options.snapping },
    appearance: { polygonOutline: { scaleWithZoom: true, referenceZoom: config.zoom ?? 15.6 }, ...defaultTheme, ...options.appearance },
  });
  subscriptions.push(attachFeaturePreview(map, editor).destroy);
  const [left, right] = isPair(config.tools) ? config.tools : [config.tools, undefined];
  const narrow = container.clientWidth < 640;
  const toolbar = { collapsible: narrow, collapsed: narrow && right !== undefined };
  map.addControl(new EditorToolbar(editor, { ...toolbar, tools: left }), "top-left");
  if (config.extras?.includes("data-layers")) map.addControl(new DataLayerControl(editor), "top-right");
  if (right) map.addControl(new EditorToolbar(editor, { ...toolbar, tools: right }), "top-right");

  const extras = new Set(config.extras ?? []);
  const initialShortcuts = editor.getKeyboardShortcuts();
  const initialDataLayers = editor.getDataLayers();
  const initialActiveLayer = editor.getActiveDataLayer();
  const initialLayerScope = editor.getState().dataLayerSelectionScope;
  // Cache the snapshot object: useSyncExternalStore must return stable identities.
  let snapshot: DemoSnapshot = { state: editor.getState(), events: [], revision: 0 };
  const publish = (update: Partial<DemoSnapshot>) => {
    if (disposed) return;
    snapshot = { ...snapshot, ...update, revision: snapshot.revision + 1 };
    listeners.forEach(listener => listener());
  };
  subscriptions.push(editor.onChange(state => publish({ state })));
  if (extras.has("events")) subscriptions.push(editor.onDataChange(event =>
    publish({ events: [event, ...snapshot.events].slice(0, 6) }),
  ));

  function reset() {
    editor.cancel();
    if (extras.has("shortcuts")) editor.setKeyboardShortcuts(initialShortcuts);
    editor.setLockedFeatureIds([]);
    const ids = editor.exportGeoJSON().features.map(feature => feature.id!);
    if (ids.length && extras.has("data-layers")) editor.setDataLayers(editor.getDataLayers().map(layer => ({ ...layer, visible: true, editable: true, locked: false })));
    if (ids.length) editor.applyTransaction({ delete: ids });
    if (config.features.length) editor.importGeoJSON({ type: "FeatureCollection", features: config.features });
    if (extras.has("data-layers")) {
      editor.setDataLayers(initialDataLayers);
      editor.setActiveDataLayer(initialActiveLayer);
      editor.setDataLayerSelectionScope(initialLayerScope);
    }
    if (config.locked) editor.setLockedFeatureIds(config.locked);
    editor.selectMany(config.select ?? []);
    editor.clearHistory();
    publish({ state: editor.getState(), events: [] });
  }
  reset();
  return {
    editor, map, config, tall: right !== undefined, reset,
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
