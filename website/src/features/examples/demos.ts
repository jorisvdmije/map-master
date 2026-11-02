import { defaultShapeTemplates } from "@jorisvdmije/map-master";
import type {
  Coordinate,
  EditorOptions,
  FeatureId,
  GeometryFeature,
  ToolbarTool,
} from "@jorisvdmije/map-master";

/** Extra panels below a demo map. */
export type DemoExtra = "geojson" | "events" | "transaction" | "appearance" | "shortcuts" | "data-layers";

export interface DemoConfig {
  /** Toolbar buttons; two lists place a second toolbar on the right. */
  tools: readonly ToolbarTool[] | readonly [readonly ToolbarTool[], readonly ToolbarTool[]];
  features: GeometryFeature[];
  select?: FeatureId[];
  locked?: FeatureId[];
  options?: EditorOptions;
  extras?: DemoExtra[];
  zoom?: number;
}

// Vondelpark, Amsterdam. Shapes are defined in meters east/north of this point.
export const center: Coordinate = [4.8679, 52.3579];
const metersPerDegree = 111_320;
const at = ([x, y]: readonly [number, number]): Coordinate => [
  Math.round((center[0] + x / (metersPerDegree * Math.cos((center[1] * Math.PI) / 180))) * 1e7) / 1e7,
  Math.round((center[1] + y / metersPerDegree) * 1e7) / 1e7,
];
const ring = (points: readonly (readonly [number, number])[]) => [...points.map(at), at(points[0]!)];
const polygon = (id: string, name: string, points: readonly (readonly [number, number])[], properties = {}): GeometryFeature => ({
  type: "Feature",
  id,
  properties: { name, ...properties },
  geometry: { type: "Polygon", coordinates: [ring(points)] },
});
const line = (id: string, name: string, points: readonly (readonly [number, number])[]): GeometryFeature => ({
  type: "Feature",
  id,
  properties: { name },
  geometry: { type: "LineString", coordinates: points.map(at) },
});
const marker = (id: string, name: string, point: readonly [number, number]): GeometryFeature => ({
  type: "Feature",
  id,
  properties: { name },
  geometry: { type: "Point", coordinates: at(point) },
});

const lawn = polygon("lawn", "Event lawn", [[-150, -30], [-40, -70], [0, 20], [-110, 60]], { kind: "lawn" });
const garden = polygon("garden", "Rose garden", [[40, -60], [150, -40], [140, 50], [50, 40]], { kind: "garden" });
const route = line("route", "Running route", [[-260, -110], [-150, -132], [-30, -118], [90, -142], [220, -100]]);
const benches = [
  marker("bench", "Bench", [-60, 95]),
  marker("info", "Information board", [110, 95]),
  marker("kiosk", "Kiosk", [200, 20]),
];
const zoneA = polygon("festival", "Festival area", [[-130, -70], [20, -80], [30, 60], [-120, 60]]);
const zoneB = polygon("market", "Market area", [[-40, -20], [120, -40], [130, 100], [-30, 90]]);
const plotA = polygon("plot-a", "Allotment A", [[-140, -60], [0, -80], [10, 70], [-130, 60]]);
const plotB = polygon("plot-b", "Allotment B", [[0, -80], [140, -60], [150, 80], [10, 70]]);
const pond = polygon("pond", "Pond", [[-170, -40], [-60, -90], [60, -60], [110, 20], [20, 80], [-120, 60]]);
const wetland = polygon(
  "wetland",
  "Wetland edge",
  Array.from({ length: 56 }, (_, i) => {
    const angle = (i / 56) * Math.PI * 2;
    const radius = 105 + 13 * Math.sin(i * 2.7) + 8 * Math.cos(i * 5.3);
    return [Math.cos(angle) * radius * 1.4, Math.sin(angle) * radius * 0.85] as const;
  }),
);
const islands: GeometryFeature = {
  type: "Feature",
  id: "islands",
  properties: { name: "Pond islands" },
  geometry: {
    type: "MultiPolygon",
    coordinates: [
      [ring([[-160, -50], [-60, -70], [-50, 30], [-150, 40]])],
      [ring([[30, -40], [130, -50], [140, 60], [40, 50]])],
    ],
  },
};
const bedA = polygon("bed-a", "Flower bed A", [[175, -70], [245, -60], [240, -10], [180, -15]]);
const bedB = polygon("bed-b", "Flower bed B", [[180, 20], [245, 15], [250, 70], [185, 75]]);
const park = polygon("park", "Park boundary (locked)", [[-280, -160], [270, -170], [290, 150], [-270, 165]]);
const playground = polygon("playground", "Playground", [[-60, 10], [60, -10], [70, 90], [-50, 100]], { kind: "playground" });

const everything = [lawn, garden, route, ...benches];
const courtyards: GeometryFeature = {
  type: "Feature", id: "courtyards", properties: { name: "Garden courtyards" },
  geometry: { type: "MultiPolygon", coordinates: [
    [ring([[-210, -115], [15, -115], [15, 115], [-210, 115]]),
      ring([[-175, -65], [-115, -65], [-115, -5], [-175, -5]]),
      ring([[-90, 25], [-30, 25], [-30, 85], [-90, 85]])],
    [ring([[65, -85], [210, -85], [210, 100], [65, 100]]),
      ring([[100, -30], [165, -30], [165, 40], [100, 40]])],
  ] },
};
const defaults: ToolbarTool[] = ["point", "line", "polygon", "rectangle", "edit", "split", "union", "rotate", "delete", "undo", "redo"];
const all: [ToolbarTool[], ToolbarTool[]] = [
  ["point", "line", "polygon", "rectangle", "circle", "ellipse", "freehand", "hole", "part",
    "edit", "split", "cut", "reshape", "shared-boundary", "union", "difference", "intersection"],
  ["lasso", "remove-hole", "combine", "explode", "rotate", "scale", "buffer", "offset", "simplify", "duplicate", "delete",
    "guides", "snapping", "constraints", "tracing", "measure", "zoom", "undo", "redo"],
];
const measuring = { measurements: { enabled: true } };
const tool = (name: ToolbarTool): ToolbarTool[] => [name, "undo", "redo"];
const zoneColors: Record<string, string> = { lawn: "#2f9e44", garden: "#d6336c", playground: "#f08c00" };

export const demos: Record<string, DemoConfig> = {
  home: { tools: defaults, features: everything, options: { snapping: { enabled: true } }, zoom: 15.3 },
  quickstart: { tools: ["polygon", "undo", "redo"], features: [] },
  examples: { tools: all, features: [...everything, zoneB], options: { snapping: { enabled: true } } },
  toolbar: { tools: all, features: [...everything, zoneB], select: ["lawn"], options: { snapping: { enabled: true } } },
  "geometry-editor": { tools: all, features: [...everything, zoneB], options: { snapping: { enabled: true } } },
  shapes: {
    tools: ["rectangle", "circle", "ellipse", "freehand", "polygon", "edit", "measure", "undo", "redo"],
    features: [garden],
    options: { ...measuring, snapping: { enabled: true } },
  },
  measurements: {
    tools: ["line", "polygon", "rectangle", "circle", "edit", "measure", "undo", "redo"],
    features: [lawn, route],
    select: ["lawn"],
    options: measuring,
  },
  cut: { tools: ["cut", "undo", "redo"], features: [lawn, garden, route] },
  "remove-hole": {
    tools: ["remove-hole", "hole", "undo", "redo"], features: [courtyards], select: ["courtyards"], extras: ["events"],
  },
  lasso: {
    tools: ["lasso", "edit", "duplicate", "delete", "undo", "redo"],
    features: [courtyards, marker("gate-west", "West gate", [-240, -120]), marker("gate-east", "East gate", [235, 110]),
      line("walk", "Crossing path", [[-260, 140], [250, 140]])],
  },
  draw: {
    tools: ["point", "line", "polygon", "snapping", "constraints", "undo", "redo"],
    features: [garden],
    // Also snap to the OpenStreetMap buildings of the basemap.
    options: { snapping: { enabled: true, layers: ["building"] } },
  },
  edit: { tools: ["edit", "duplicate", "delete", "undo", "redo"], features: [lawn, garden, route], select: ["lawn"] },
  geojson: { tools: defaults, features: [lawn, route], extras: ["geojson"] },
  persistence: { tools: defaults, features: [lawn, garden], extras: ["events"] },
  "data-layers": {
    tools: ["point", "line", "polygon", "edit", "duplicate", "delete", "undo", "redo"],
    features: [
      { ...plotA, properties: { ...plotA.properties, mapMasterLayer: "parcels" } },
      { ...plotB, properties: { ...plotB.properties, mapMasterLayer: "parcels" } },
      { ...marker("note", "Layer note", [50, 130]), properties: { mapMasterLayer: "notes", name: "Layer note", mapMasterText: { text: "Layer note" } } },
      { ...park, properties: { ...park.properties, mapMasterLayer: "reference" } },
      { ...marker("archived", "Hidden archive", [-30, -100]), properties: { mapMasterLayer: "archive", name: "Hidden archive" } },
    ],
    select: ["plot-a"], extras: ["geojson", "events", "data-layers"],
    options: { dataLayers: { activeLayerId: "parcels", selectionScope: "all", layers: [
      { id: "reference", name: "Reference", editable: false, selectable: false, style: { shape: { lineColor: "#64748b", fillColor: "#94a3b8", fillOpacity: 0.05 } } },
      { id: "parcels", name: "Parcels", style: { shape: { fillColor: "#15803d", lineColor: "#166534" } } },
      { id: "notes", name: "Notes", style: { marker: { color: "#ea580c" } } },
      { id: "archive", name: "Archive", visible: false },
    ] } },
  },
  geofencing: {
    tools: ["point", "line", "polygon", "rectangle", "edit", "scale", "geofencing", "undo", "redo"],
    features: [{ ...marker("moving", "Move this marker", [-120, 100]), properties: { name: "Move this marker", mapMasterText: { text: "Move me" } } }, line("route", "Allowed route", [[-180, -105], [-60, -105]])],
    select: ["moving"], extras: ["geojson", "events"],
    options: { keyboardShortcuts: { geofencing: [{ key: "f" }] }, geofencing: {
      enabled: true,
      allowed: [{ id: "park", geometry: { type: "Polygon", coordinates: [ring([[-230, -160], [230, -160], [230, 160], [-230, 160]])] } }],
      excluded: [{ id: "pond", geometry: { type: "Polygon", coordinates: [ring([[30, -50], [120, -50], [120, 55], [30, 55]])] } }],
    } },
  },
  "vertex-pinning": {
    tools: ["pin", "unpin", "edit", "duplicate", "delete", "snapping", "undo", "redo"],
    features: [plotA, plotB, line("junction-line", "Path to junction", [[0, -80], [80, -155]]), { ...marker("junction", "Shared corner", [0, -80]), properties: { name: "Shared corner", mapMasterText: { text: "Junction" } } }],
    select: ["plot-a", "plot-b", "junction-line", "junction"], extras: ["geojson", "events"],
    options: { keyboardShortcuts: { pin: [{ key: "p" }], unpin: [{ key: "p", modifiers: ["Shift"] }] } },
  },
  "alignment-guides": {
    tools: ["line", "polygon", "edit", "guides", "snapping", "undo", "redo"],
    features: [polygon("reference", "Reference corners", [[-170, -70], [-70, -70], [-70, 60], [-170, 60]]),
      line("edge", "Extended edge", [[50, -100], [110, -40]]), marker("moving", "Drag this marker", [140, 95])],
    select: ["moving"], locked: ["reference"], extras: ["events"],
    options: { snapping: { enabled: false }, alignmentGuides: { enabled: true }, keyboardShortcuts: { guides: [{ key: "g" }] } },
  },
  "shape-templates": {
    tools: ["template", "edit", "duplicate", "delete", "snapping", "undo", "redo"],
    features: [lawn, garden], locked: ["lawn"], extras: ["geojson", "events"],
    options: { snapping: { enabled: true }, keyboardShortcuts: { template: [{ key: "t" }] },
      shapeTemplates: [...defaultShapeTemplates(), { id: "booth", label: "Booth and entrance", data: { type: "FeatureCollection", features: [
        polygon("booth", "Event booth", [[-40, -25], [40, -25], [40, 25], [-40, 25]], { category: "booth" }),
        line("entrance", "Entrance path", [[0, -25], [0, -60]]),
      ] } }],
    },
  },
  "text-markers": {
    tools: ["text", "point", "edit", "duplicate", "delete", "undo", "redo"],
    features: [lawn, { ...marker("park-label", "Meeting point", [30, 100]),
      properties: { name: "Meeting point", mapMasterText: { text: "Meeting point\nVondelpark", style: { color: "#175c4c", fontSize: 20, fontWeight: "bold", backgroundColor: "#ffffff" } } } }],
    select: ["park-label"], extras: ["geojson"], options: { keyboardShortcuts: { text: [{ key: "t" }] } },
  },
  markers: { tools: ["point", "edit", "duplicate", "delete", "undo", "redo"], features: [...benches, lawn], select: ["bench"] },
  appearance: { tools: defaults, features: everything, select: ["garden"], extras: ["appearance"] },
  "keyboard-vertices": { tools: ["edit", "undo", "redo"], features: [lawn, garden], select: ["lawn"] },
  "keyboard-shortcuts": {
    tools: ["polygon", "line", "edit", "delete", "undo", "redo"], features: [lawn, garden], select: ["lawn"],
    extras: ["shortcuts"], options: { keyboardShortcuts: { polygon: [{ key: "p" }], line: [{ key: "l" }], edit: [{ key: "e" }] } },
  },
  "touch-pen-vertices": { tools: ["edit", "undo", "redo"], features: [lawn, garden], select: ["lawn"] },
  transactions: { tools: defaults, features: everything, extras: ["transaction", "events"] },
  "feature-styling": {
    tools: ["polygon", "edit", "union", "undo", "redo"],
    features: [lawn, garden, playground],
    options: {
      styling: {
        feature: (feature) => {
          const kind = feature.properties?.kind;
          const color = typeof kind === "string" ? zoneColors[kind] : undefined;
          return color ? { shape: { fillColor: color, lineColor: color } } : {};
        },
        overlap: { enabled: true },
      },
    },
  },
  "feature-locks": { tools: defaults, features: [park, lawn, garden], locked: ["park"], options: { snapping: { enabled: true } } },
  multipart: {
    tools: ["hole", "part", "edit", "remove-hole", "combine", "explode", "union", "undo", "redo"],
    features: [islands, bedA, bedB],
    select: ["islands"],
  },
  splitting: { tools: tool("split"), features: [lawn, garden], select: ["lawn"] },
  union: { tools: tool("union"), features: [zoneA, zoneB], select: ["festival", "market"] },
  difference: { tools: tool("difference"), features: [zoneA, zoneB], select: ["festival", "market"] },
  intersection: { tools: tool("intersection"), features: [zoneA, zoneB], select: ["festival", "market"] },
  buffer: { tools: tool("buffer"), features: [route, garden], select: ["route"] },
  offset: { tools: tool("offset"), features: [route, garden], select: ["route"] },
  simplification: { tools: tool("simplify"), features: [wetland], select: ["wetland"] },
  rotation: { tools: tool("rotate"), features: [garden, lawn], select: ["garden"] },
  scaling: { tools: tool("scale"), features: [garden, lawn], select: ["garden"] },
  reshape: { tools: tool("reshape"), features: [garden, lawn], select: ["garden"] },
  "shared-boundaries": { tools: tool("shared-boundary"), features: [plotA, plotB], select: ["plot-a", "plot-b"] },
  tracing: {
    tools: ["line", "polygon", "tracing", "snapping", "undo", "redo"],
    features: [pond, route],
    options: { snapping: { enabled: true }, tracing: { enabled: true } },
  },
  "drawing-constraints": {
    tools: ["line", "polygon", "constraints", "snapping", "undo", "redo"],
    features: [garden],
    options: { drawingConstraints: { enabled: true } },
  },
};
