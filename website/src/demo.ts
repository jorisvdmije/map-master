import {
  Map,
  NavigationControl,
  setWorkerUrl,
  type StyleSpecification,
} from "maplibre-gl";
import type * as GeoJSON from "geojson";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import {
  GeometryEditor,
  type EditorState,
  type GeometryFeatureCollection,
} from "@jorisvdmije/map-master";
import "maplibre-gl/dist/maplibre-gl.css";

setWorkerUrl(workerUrl);
// This small fictional neighborhood is bundled; no tile provider or token is needed.
const center: [number, number] = [4.9, 52.37];
const coordinate = (x: number, y: number): [number, number] => [
  center[0] + x * 0.001,
  center[1] + y * 0.0006,
];
const ring = (points: number[][]) => points.map(([x, y]) => coordinate(x, y));
const sample: GeometryFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "garden",
      properties: { name: "Community garden" },
      geometry: {
        type: "Polygon",
        coordinates: [
          ring([
            [-1.1, -0.7],
            [0.7, -0.9],
            [1.25, 0.5],
            [-0.5, 1.15],
            [-1.1, -0.7],
          ]),
        ],
      },
    },
    {
      type: "Feature",
      id: "route",
      properties: { name: "Walking route" },
      geometry: {
        type: "LineString",
        coordinates: ring([
          [-2.6, -1.8],
          [-2, -0.15],
          [-1.35, 1.6],
          [0.1, 2.1],
        ]),
      },
    },
  ],
};
const importExample: GeometryFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "meeting-point",
      properties: { name: "Meeting point" },
      geometry: { type: "Point", coordinates: coordinate(1.7, -1.1) },
    },
  ],
};
function style(): StyleSpecification {
  const roads: GeoJSON.Feature[] = [];
  for (let i = -8; i <= 8; i++) {
    roads.push({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: ring([
          [-10, i * 1.8 - 3],
          [10, i * 1.8 + 3],
        ]),
      },
    });
    roads.push({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: ring([
          [i * 1.8 - 3, -10],
          [i * 1.8 + 3, 10],
        ]),
      },
    });
  }
  const parks: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            ring([
              [-4, 1],
              [-1.8, 1.7],
              [-0.8, 4],
              [-3, 3.3],
              [-4, 1],
            ]),
          ],
        },
      },
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            ring([
              [2, -4],
              [4, -3.4],
              [4.7, -1.5],
              [2.6, -2.1],
              [2, -4],
            ]),
          ],
        },
      },
    ],
  };
  return {
    version: 8,
    sources: {
      streets: {
        type: "geojson",
        data: { type: "FeatureCollection", features: roads },
      },
      parks: { type: "geojson", data: parks },
      canal: {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: ring([
              [-8, -5],
              [-3, -3.7],
              [2.5, -1.9],
              [5, 1],
              [8, 8],
            ]),
          },
        },
      },
    },
    layers: [
      {
        id: "base",
        type: "background",
        paint: { "background-color": "#e9e7df" },
      },
      {
        id: "parks",
        type: "fill",
        source: "parks",
        paint: { "fill-color": "#d5dfcf" },
      },
      {
        id: "road-edge",
        type: "line",
        source: "streets",
        paint: { "line-color": "#dcd9d0", "line-width": 18 },
      },
      {
        id: "roads",
        type: "line",
        source: "streets",
        paint: { "line-color": "#faf9f5", "line-width": 14 },
      },
      {
        id: "canal-bank",
        type: "line",
        source: "canal",
        paint: { "line-color": "#d2ded7", "line-width": 33 },
        layout: { "line-cap": "round", "line-join": "round" },
      },
      {
        id: "canal",
        type: "line",
        source: "canal",
        paint: { "line-color": "#b7d3d1", "line-width": 26 },
        layout: { "line-cap": "round", "line-join": "round" },
      },
    ],
  };
}
export async function mountDemo(container: HTMLElement): Promise<void> {
  const kind = container.dataset.demo!;
  const status = container.querySelector<HTMLElement>(".demo-status")!;
  const list = container.querySelector<HTMLElement>(".demo-feature-list")!;
  const buttons = new globalThis.Map(
    Array.from(
      container.querySelectorAll<HTMLButtonElement>("[data-action]"),
    ).map((button) => [button.dataset.action!, button]),
  );
  let editor: GeometryEditor | undefined;
  let disposed = false;
  let notice = "";
  let revision = -1;
  let selected = "";
  const map = new Map({
    container: container.querySelector<HTMLElement>(".demo-map")!,
    style: style(),
    center,
    zoom: 15.7,
    minZoom: 12,
    maxZoom: 19,
    attributionControl: false,
    scrollZoom: false,
    dragRotate: false,
    pitchWithRotate: false,
    fadeDuration: 0,
  });
  map.addControl(new NavigationControl({ showCompass: false }), "top-right");
  map.on("error", () => {
    status.textContent =
      "The map could not render. Check WebGL support and reload to try again.";
  });
  const resize = new ResizeObserver(() => {
    if (!disposed) map.resize();
  });
  resize.observe(container);
  window.addEventListener(
    "pagehide",
    () => {
      disposed = true;
      resize.disconnect();
      editor?.destroy();
      map.remove();
    },
    { once: true },
  );
  await map.once("load");
  if (disposed) return;
  editor = new GeometryEditor(map, {
    snapping: { enabled: true, distance: 16 },
    appearance: {
      feature: {
        fillColor: "#3e8b67",
        fillOpacity: 0.25,
        lineColor: "#246648",
        lineWidth: 2.5,
      },
      selected: {
        fillColor: "#55a87a",
        fillOpacity: 0.3,
        lineColor: "#174b35",
        lineWidth: 3,
      },
      draft: { fillColor: "#63a483", lineColor: "#174b35", fillOpacity: 0.2 },
      vertex: { color: "#ffffff", strokeColor: "#174b35", radius: 5 },
    },
  });
  const instance = editor;
  function render(state: EditorState) {
    const idle = state.mode === "idle";
    const drawing = state.mode.startsWith("draw");
    buttons.get("reset")!.disabled = false;
    const exportButton = buttons.get("export");
    if (exportButton) exportButton.disabled = false;
    buttons.get("finish")!.disabled = !state.canFinish;
    buttons.get("finish")!.textContent = state.mode.startsWith("edit")
      ? "Save edit"
      : "Finish";
    buttons.get("cancel")!.disabled = idle;
    buttons.get("undo")!.disabled = !state.canUndo;
    buttons.get("edit")!.disabled =
      !idle || state.selectedFeatureIds.length !== 1;
    buttons.get("delete")!.disabled =
      !idle || state.selectedFeatureIds.length === 0;
    for (const action of ["polygon", "line", "marker", "sample", "import"]) {
      const button = buttons.get(action);
      if (button) button.disabled = !idle;
    }
    for (const action of ["polygon", "line", "marker"])
      buttons
        .get(action)!
        .setAttribute(
          "aria-pressed",
          String(
            state.mode === `draw-${action === "marker" ? "point" : action}`,
          ),
        );
    const validation =
      state.validationError && state.validationError !== "too-few-vertices"
        ? ` Cannot finish: ${state.validationError.replaceAll("-", " ")}.`
        : "";
    status.textContent =
      notice ||
      (drawing
        ? state.mode === "draw-point"
          ? "Click the map to place a marker."
          : `${state.vertexCount} points · click to add, Enter to finish, Escape to cancel.${validation}`
        : !idle
          ? `Drag a corner, then Save edit. Escape discards changes.${validation}`
          : `${state.featureCount} feature${state.featureCount === 1 ? "" : "s"} · ${state.selectedFeatureIds.length ? "Selection ready to edit or delete." : "Choose a drawing tool or select a shape."}`);
    container.dataset.mode = state.mode;
    container.dataset.featureCount = String(state.featureCount);
    const key = JSON.stringify(state.selectedFeatureIds);
    if (revision !== state.dataRevision || selected !== key) {
      revision = state.dataRevision;
      selected = key;
      list.replaceChildren();
      for (const [index, feature] of instance
        .exportGeoJSON()
        .features.entries()) {
        const button = document.createElement("button");
        button.textContent =
          typeof feature.properties?.name === "string"
            ? feature.properties.name
            : `${feature.geometry.type} ${index + 1}`;
        button.setAttribute(
          "aria-pressed",
          String(state.selectedFeatureIds.includes(feature.id!)),
        );
        button.addEventListener("click", () => {
          if (instance.getState().mode === "idle") {
            notice = "";
            instance.select(feature.id!);
          }
        });
        list.append(button);
      }
      const output = container.querySelector<HTMLElement>(".geojson-output");
      if (output)
        output.textContent = JSON.stringify(instance.exportGeoJSON(), null, 2);
    }
    list.querySelectorAll("button").forEach((button) => {
      button.disabled = !idle;
    });
  }
  instance.onChange(render);
  const clear = () => {
    instance.cancel();
    const ids = instance.exportGeoJSON().features.map((f) => f.id!);
    if (ids.length) instance.applyTransaction({ delete: ids });
    instance.clearHistory();
    map.jumpTo({ center, zoom: 15.7 });
  };
  function loadSample() {
    clear();
    instance.importGeoJSON(sample);
    instance.clearHistory();
    instance.select("garden");
  }
  for (const [action, button] of buttons)
    button.addEventListener("click", () => {
      notice = "";
      try {
        switch (action) {
          case "polygon":
            instance.draw("Polygon");
            break;
          case "line":
            instance.draw("LineString");
            break;
          case "marker":
            instance.draw("Point");
            break;
          case "finish":
            instance.finish();
            break;
          case "cancel":
            instance.cancel();
            break;
          case "edit":
            instance.editSelected();
            break;
          case "delete":
            instance.deleteSelection();
            break;
          case "undo":
            instance.undo();
            break;
          case "sample":
            loadSample();
            break;
          case "reset":
            clear();
            break;
          case "import": {
            const input =
              container.querySelector<HTMLTextAreaElement>(".geojson-input")!;
            const added = instance.importGeoJSON(JSON.parse(input.value));
            notice = `Imported ${added.features.length} feature${added.features.length === 1 ? "" : "s"}. Existing features are preserved.`;
            break;
          }
          case "export": {
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(instance.exportGeoJSON(), null, 2)], {
                type: "application/geo+json",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "map-master.geojson";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            notice = "GeoJSON downloaded. Only committed geometry is exported.";
            break;
          }
        }
      } catch (error) {
        notice =
          error instanceof Error
            ? error.message
            : "The operation could not be completed.";
      }
      render(instance.getState());
    });
  const input = container.querySelector<HTMLTextAreaElement>(".geojson-input");
  if (input) input.value = JSON.stringify(importExample, null, 2);
  // A visual starting point on the overview; the drawing guide starts empty.
  if (kind === "edit" || kind === "geojson" || document.querySelector(".home"))
    loadSample();
  render(instance.getState());
  container.dataset.ready = "true";
}
