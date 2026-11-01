import {
  Map,
  NavigationControl,
  setWorkerUrl,
  type StyleSpecification,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import {
  DataLayerControl,
  EditorToolbar,
  GeoJSONImportError,
  GeometryEditor,
  type DataChangeEvent,
  type EditorAppearanceOptions,
  type EditorState,
  type GeometryFeature,
  type GeometryFeatureCollection,
  type KeyboardShortcuts,
  type ToolbarTool,
} from "@jorisvdmije/map-master";
import "maplibre-gl/dist/maplibre-gl.css";
import { center, demos, type DemoConfig } from "./demos";

setWorkerUrl(workerUrl);

// OpenFreeMap serves OpenStreetMap vector tiles without an account or API key.
export const basemapUrl = "https://tiles.openfreemap.org/styles/liberty";
const fallbackStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#eef0e8" } }],
};
let basemap: Promise<StyleSpecification> | undefined;
// Editing keeps working on a plain background when the tile service is unreachable.
const loadBasemap = () =>
  (basemap ??= fetch(basemapUrl, { signal: AbortSignal.timeout(8000) })
    .then((response) => {
      if (!response.ok) throw new Error(`Basemap ${response.status}`);
      return response.json() as Promise<StyleSpecification>;
    })
    .catch(() => fallbackStyle));

const themes: Record<string, EditorAppearanceOptions> = {
  "Blue & orange": {
    feature: { fillColor: "#3b5bdb", fillOpacity: 0.22, lineColor: "#364fc7", lineWidth: 2.5 },
    selected: { fillColor: "#f59f00", fillOpacity: 0.28, lineColor: "#e8590c", lineWidth: 3 },
    draft: { fillColor: "#f59f00", fillOpacity: 0.2, lineColor: "#e8590c", lineWidth: 2.5 },
    marker: { color: "#3b5bdb", radius: 7, strokeColor: "#ffffff", strokeWidth: 2 },
    selectedMarker: { color: "#e8590c", radius: 8, strokeColor: "#ffffff", strokeWidth: 2 },
    vertex: { color: "#ffffff", strokeColor: "#e8590c", radius: 5, activeColor: "#e8590c" },
  },
  Forest: {
    feature: { fillColor: "#2b8a3e", fillOpacity: 0.25, lineColor: "#1b5e20", lineWidth: 2 },
    selected: { fillColor: "#94d82d", fillOpacity: 0.35, lineColor: "#2b8a3e", lineWidth: 3.5 },
    draft: { fillColor: "#94d82d", fillOpacity: 0.25, lineColor: "#2b8a3e", lineWidth: 2.5 },
    marker: { color: "#2b8a3e", radius: 7, strokeColor: "#ffffff", strokeWidth: 2 },
    selectedMarker: { color: "#94d82d", radius: 8, strokeColor: "#1b5e20", strokeWidth: 2 },
    vertex: { color: "#ffffff", strokeColor: "#1b5e20", radius: 5, activeColor: "#94d82d" },
  },
  "High contrast": {
    feature: { fillColor: "#000000", fillOpacity: 0.15, lineColor: "#000000", lineWidth: 3 },
    selected: { fillColor: "#ffd43b", fillOpacity: 0.45, lineColor: "#000000", lineWidth: 4 },
    draft: { fillColor: "#ffd43b", fillOpacity: 0.35, lineColor: "#000000", lineWidth: 3 },
    marker: { color: "#000000", radius: 8, strokeColor: "#ffd43b", strokeWidth: 3 },
    selectedMarker: { color: "#ffd43b", radius: 9, strokeColor: "#000000", strokeWidth: 3 },
    vertex: { color: "#ffd43b", strokeColor: "#000000", radius: 6, activeColor: "#000000" },
  },
};
const defaultTheme = themes["Blue & orange"]!;

const instructions: Partial<Record<EditorState["mode"], string>> = {
  "draw-template": "Choose a template, then click to anchor it. Adjust size, rotation or coordinates and choose Finish. Escape cancels the whole placement.",
  "draw-text": "Click to anchor a label. Enter text and choose its appearance, then Finish. Enter adds a newline in the text field; Ctrl/Command+Enter saves.",
  "draw-point": "Click the map to place a marker.",
  "draw-line": "Click to add points. Choose Finish to complete the line.",
  "draw-polygon": "Click to add corners. Click the first corner or choose Finish.",
  "draw-hole": "Click inside the selected polygon to outline the hole, then Finish.",
  "remove-hole": "Click inside a hole or choose it in the dropdown. Apply fills it; Cancel keeps the original.",
  "select-lasso": "Press and drag to outline a loop, then release to select. Choose Replace/Add/Remove and Touches/Fully inside in the toolbar.",
  "draw-rectangle": "Click one corner, then the opposite corner.",
  "draw-circle": "Click the center, then a point on the edge.",
  "draw-ellipse": "Click the center, then a corner of the box around the ellipse.",
  "draw-freehand": "Press and drag to trace an outline. Releasing the pointer completes it.",
  "draw-cut": "Draw a polygon across the shapes. Close it or choose Apply to cut it away.",
  "draw-part": "Draw the new part, then Finish. Polygon parts may not overlap.",
  "edit-point": "Drag the marker to move it. For text markers, edit text and appearance in the toolbar, then Save.",
  "edit-line": "Drag a point, or click a small midpoint to add one. Save or Cancel.",
  "edit-polygon": "Drag a corner or an edge, or click a small midpoint to add a corner. Save or Cancel.",
  "split-polygon": "Draw a line that crosses the polygon. Apply splits it in two.",
  "reshape-polygon": "Draw a new boundary section that starts and ends on the outline.",
  "edit-shared-boundary": "Drag the common corners. Both polygons change together.",
  "union-polygons": "Preview of the merged shape. Apply merges the selection.",
  "difference-polygons": "The first selected shape minus the others. Apply subtracts them.",
  "intersection-polygons": "Only the area common to all shapes remains. Apply keeps it.",
  "rotate-features": "Drag the round handle or type an angle.",
  "scale-features": "Drag a corner handle or type a factor.",
  "buffer-features": "Drag the handle or type a distance in meters.",
  "offset-lines": "Drag the handle or type a distance. Positive is left of the line.",
  "simplify-features": "Type a tolerance in meters. Corners closer to the line disappear.",
};
const name = (feature: GeometryFeature | null) =>
  typeof feature?.properties?.name === "string" ? feature.properties.name : (feature?.geometry.type ?? "shape");
const words = (code: string) => code.replaceAll("-", " ");

function describe(editor: GeometryEditor, state: EditorState): string {
  const problem =
    (state.validationError !== "too-few-vertices" ? state.validationError : null) ??
    state.splitError ?? state.reshapeError ?? state.unionError ?? state.differenceError ??
    state.intersectionError ?? state.bufferError ?? state.offsetError ??
    state.simplificationError ?? state.scaleError ?? state.rotationError ?? state.sharedBoundaryError ?? state.pinningError ?? state.geofencingViolations[0]?.code;
  const note = problem ? ` Not possible yet: ${words(problem)}.` : "";
  if (state.mode !== "idle") return `${instructions[state.mode] ?? ""}${note}`;
  const selected = state.selectedFeatureIds.map((id) => name(editor.getFeature(id)));
  if (selected.length) return `Selected: ${selected.join(", ")}. Shift+click adds more shapes.`;
  return `${state.featureCount} ${state.featureCount === 1 ? "feature" : "features"}. Click a shape to select it, or choose a tool.`;
}

const isPair = (tools: DemoConfig["tools"]): tools is readonly [readonly ToolbarTool[], readonly ToolbarTool[]] =>
  typeof tools[0] !== "string";

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export async function mountDemo(container: HTMLElement): Promise<void> {
  const config: DemoConfig = demos[container.dataset.demo!] ?? demos.home!;
  const status = container.querySelector<HTMLElement>(".demo-status")!;
  const reset = container.querySelector<HTMLButtonElement>(".demo-reset")!;
  const style = await loadBasemap();
  const map = new Map({
    container: container.querySelector<HTMLElement>(".demo-map")!,
    style,
    center,
    zoom: config.zoom ?? 15.6,
    minZoom: 12,
    maxZoom: 20,
    cooperativeGestures: true,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    fadeDuration: 0,
    attributionControl: { compact: true },
  });
  map.touchZoomRotate.disableRotation();
  // Demos with every tool need both sides of the map; they include a zoom-to-features tool.
  if (!isPair(config.tools)) map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
  let disposed = false;
  window.addEventListener(
    "pagehide",
    () => {
      disposed = true;
      map.remove();
    },
    { once: true },
  );
  map.on("error", (event) => {
    if (!map.loaded() && !(event.error?.message ?? "").includes("tiles"))
      status.textContent = "The map could not load. Check that WebGL is available and reload the page.";
  });
  await map.once("load");
  if (disposed) return;

  const options = config.options ?? {};
  const editor = new GeometryEditor(map, {
    ...options,
    snapping: { enabled: true, ...options.snapping },
    appearance: { ...defaultTheme, ...options.appearance },
  });
  // Large tool sets are split over a toolbar on each side of the map.
  const [left, right] = isPair(config.tools) ? config.tools : [config.tools, undefined];
  container.classList.toggle("demo--tall", right !== undefined);
  // On narrow screens the toolbars start collapsed, so the map stays visible.
  const narrow = container.clientWidth < 640;
  const toolbar = { collapsible: narrow, collapsed: narrow && right !== undefined };
  map.addControl(new EditorToolbar(editor, { ...toolbar, tools: left }), "top-left");
  if (config.extras?.includes("data-layers")) map.addControl(new DataLayerControl(editor), "top-right");
  if (right) map.addControl(new EditorToolbar(editor, { ...toolbar, tools: right }), "top-right");

  let message = "";
  const extras = new Set(config.extras ?? []);
  const initialShortcuts = editor.getKeyboardShortcuts();
  const initialDataLayers = editor.getDataLayers();
  const initialActiveLayer = editor.getActiveDataLayer();
  const initialLayerScope = editor.getState().dataLayerSelectionScope;
  let renderShortcuts = () => {};
  const log = extras.has("events") ? element("ol", "demo-log") : null;
  const output = extras.has("geojson") ? element("pre", "geojson-output") : null;
  function restore() {
    editor.cancel();
    if (extras.has("shortcuts")) editor.setKeyboardShortcuts(initialShortcuts);
    editor.setLockedFeatureIds([]);
    const ids = editor.exportGeoJSON().features.map((feature) => feature.id!);
    if (ids.length && extras.has("data-layers")) editor.setDataLayers(editor.getDataLayers().map(layer => ({ ...layer, visible: true, editable: true, locked: false })));
    if (ids.length) editor.applyTransaction({ delete: ids });
    if (config.features.length)
      editor.importGeoJSON({ type: "FeatureCollection", features: config.features });
    if (extras.has("data-layers")) { editor.setDataLayers(initialDataLayers); editor.setActiveDataLayer(initialActiveLayer); editor.setDataLayerSelectionScope(initialLayerScope); }
    if (config.locked) editor.setLockedFeatureIds(config.locked);
    editor.selectMany(config.select ?? []);
    editor.clearHistory();
    log?.replaceChildren();
    message = "";
    render(editor.getState());
  }
  function render(state: EditorState) {
    status.textContent = message || describe(editor, state);
    container.dataset.mode = state.mode;
    container.dataset.featureCount = String(state.featureCount);
    if (output) output.textContent = JSON.stringify(editor.exportGeoJSON(), null, 2);
    renderShortcuts();
    for (const button of container.querySelectorAll<HTMLButtonElement>(".demo-panel:not(.demo-shortcuts) button"))
      button.disabled = state.mode !== "idle" || button.dataset.requires?.split(" ").some((id) => !editor.getFeature(id)) === true;
  }
  editor.onChange((state) => {
    message = "";
    render(state);
  });
  if (log)
    editor.onDataChange((event: DataChangeEvent) => {
      const item = element("li", "", `${event.source} · ${event.changes
        .map(({ before, after }) => `${!before ? "+" : !after ? "−" : "~"} ${name(after ?? before)}`)
        .join(", ")}`);
      const revision = element("span", "", `revision ${event.dataRevision}`);
      item.append(revision);
      log.prepend(item);
      while (log.children.length > 6) log.lastElementChild!.remove();
    });

  const caption = container.querySelector(".demo-caption")!;
  if (extras.has("shortcuts")) {
    const panel = element("div", "demo-panel demo-shortcuts");
    const label = element("label", "", "Shortcut preset ");
    const select = element("select", "");
    for (const [value, text] of [["standard", "Standard: P / Enter / Escape"], ["alternative", "Alternative: G / Ctrl+Enter / C"], ["off", "Shortcuts off"]]) {
      const option = element("option", "", text); option.value = value!; select.append(option);
    }
    label.append(select);
    const alternate: KeyboardShortcuts = {
      polygon: [{ key: "g" }], finish: [{ key: "Enter", modifiers: ["Control"] }], cancel: [{ key: "c" }], delete: [{ key: "x" }],
    };
    select.addEventListener("change", () => {
      editor.setKeyboardShortcuts(select.value === "off" ? false : { ...initialShortcuts, ...(select.value === "alternative" ? alternate : {}) });
    });
    const focus = element("button", "button small", "Focus map"); focus.type = "button";
    focus.addEventListener("click", () => { map.getCanvas().focus({ preventScroll: true }); });
    const inputLabel = element("label", "", "Try typing here ");
    const input = element("input", ""); input.type = "text"; input.placeholder = "Shortcuts leave text fields alone"; inputLabel.append(input);
    const reference = element("p", "demo-shortcut-reference"); reference.setAttribute("role", "status");
    renderShortcuts = () => {
      const bindings = editor.getKeyboardShortcuts();
      select.value = bindings.polygon.length === 0 ? "off" : bindings.polygon[0]?.key === "g" ? "alternative" : "standard";
      reference.textContent = (["polygon", "line", "edit", "finish", "cancel", "delete", "undo", "redo"] as const)
        .map(action => `${action}: ${editor.getKeyboardShortcutLabel(action) || "off"}`).join(" · ");
    };
    panel.append(label, focus, inputLabel, reference); caption.after(panel);
  }
  if (extras.has("transaction")) {
    const panel = element("div", "demo-panel");
    const run = element("button", "button small", "Rename the lawn and remove the kiosk");
    run.type = "button";
    run.dataset.requires = "lawn kiosk";
    run.addEventListener("click", () => {
      const lawn = editor.getFeature("lawn")!;
      editor.applyTransaction({
        update: [{ ...lawn, properties: { ...lawn.properties, name: "Picnic lawn" } }],
        delete: ["kiosk"],
      });
    });
    panel.append(run, element("span", "", "One transaction, one Undo step."));
    caption.after(panel);
  }
  if (log) {
    const panel = element("div", "demo-panel demo-events");
    panel.append(element("strong", "", "onDataChange events"), log);
    (container.querySelector(".demo-panel") ?? caption).after(panel);
  }
  if (extras.has("appearance")) {
    const panel = element("div", "demo-panel");
    panel.append(element("span", "", "Theme:"));
    for (const theme of Object.keys(themes)) {
      const button = element("button", "", theme);
      button.type = "button";
      button.setAttribute("aria-pressed", String(theme === "Blue & orange"));
      button.addEventListener("click", () => {
        editor.setAppearance(themes[theme]!);
        for (const other of panel.querySelectorAll("button"))
          other.setAttribute("aria-pressed", String(other === button));
      });
      panel.append(button);
    }
    caption.after(panel);
  }
  if (output) {
    const panel = element("div", "demo-panel demo-data");
    const input = element("textarea", "geojson-input");
    input.rows = 6;
    input.spellcheck = false;
    input.setAttribute("aria-label", "GeoJSON to import");
    input.value = JSON.stringify(
      {
        type: "FeatureCollection",
        features: [{ type: "Feature", id: "meeting-point", properties: { name: "Meeting point" }, geometry: { type: "Point", coordinates: [4.8692, 52.3586] } }],
      },
      null,
      2,
    );
    const importButton = element("button", "button small", "Import GeoJSON");
    importButton.type = "button";
    importButton.addEventListener("click", () => {
      try {
        const added = editor.importGeoJSON(JSON.parse(input.value));
        message = `Imported ${added.features.length} feature${added.features.length === 1 ? "" : "s"}; existing features are kept.`;
      } catch (error) {
        message = error instanceof GeoJSONImportError
          ? `Import rejected (${error.code}${error.path ? ` at ${error.path}` : ""}). Nothing changed.`
          : error instanceof SyntaxError ? "That is not valid JSON. Nothing changed." : String(error);
      }
      render(editor.getState());
    });
    const download = element("button", "", "Download GeoJSON ↓");
    download.type = "button";
    download.addEventListener("click", () => {
      const data: GeometryFeatureCollection = editor.exportGeoJSON();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/geo+json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "map-master.geojson";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const actions = element("div", "demo-data-actions");
    actions.append(importButton, download);
    const details = element("details", "");
    details.append(element("summary", "", "Current GeoJSON"), output);
    panel.append(input, actions, details);
    caption.after(panel);
  }

  reset.addEventListener("click", restore);
  reset.disabled = false;
  restore();
  container.dataset.ready = "true";
}
