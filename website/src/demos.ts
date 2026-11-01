import type {
  Coordinate,
  EditorOptions,
  FeatureId,
  GeometryFeature,
  ToolbarTool,
} from "@jorisvdmije/map-master";

/** Extra panels below a demo map. */
export type DemoExtra = "geojson" | "events" | "transaction" | "appearance";

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
const park = polygon("park", "Park boundary (locked)", [[-280, -160], [270, -170], [290, 150], [-270, 165]]);
const playground = polygon("playground", "Playground", [[-60, 10], [60, -10], [70, 90], [-50, 100]], { kind: "playground" });

const everything = [lawn, garden, route, ...benches];
const defaults: ToolbarTool[] = ["point", "line", "polygon", "edit", "split", "union", "rotate", "delete", "undo", "redo"];
const all: [ToolbarTool[], ToolbarTool[]] = [
  ["point", "line", "polygon", "hole", "edit", "split", "reshape", "shared-boundary", "union", "difference", "intersection"],
  ["rotate", "scale", "buffer", "offset", "simplify", "duplicate", "delete", "snapping", "constraints", "tracing", "undo", "redo"],
];
const tool = (name: ToolbarTool): ToolbarTool[] => [name, "undo", "redo"];
const zoneColors: Record<string, string> = { lawn: "#2f9e44", garden: "#d6336c", playground: "#f08c00" };

export const demos: Record<string, DemoConfig> = {
  home: { tools: defaults, features: everything, options: { snapping: { enabled: true } }, zoom: 15.3 },
  quickstart: { tools: ["polygon", "undo", "redo"], features: [] },
  examples: { tools: all, features: [...everything, zoneB], options: { snapping: { enabled: true } } },
  toolbar: { tools: all, features: [...everything, zoneB], select: ["lawn"], options: { snapping: { enabled: true } } },
  "geometry-editor": { tools: all, features: [...everything, zoneB], options: { snapping: { enabled: true } } },
  draw: {
    tools: ["point", "line", "polygon", "snapping", "constraints", "undo", "redo"],
    features: [garden],
    options: { snapping: { enabled: true } },
  },
  edit: { tools: ["edit", "duplicate", "delete", "undo", "redo"], features: [lawn, garden, route], select: ["lawn"] },
  geojson: { tools: defaults, features: [lawn, route], extras: ["geojson"] },
  persistence: { tools: defaults, features: [lawn, garden], extras: ["events"] },
  markers: { tools: ["point", "edit", "duplicate", "delete", "undo", "redo"], features: [...benches, lawn], select: ["bench"] },
  appearance: { tools: defaults, features: everything, select: ["garden"], extras: ["appearance"] },
  "keyboard-vertices": { tools: ["edit", "undo", "redo"], features: [lawn, garden], select: ["lawn"] },
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
  multipart: { tools: ["hole", "edit", "split", "union", "undo", "redo"], features: [islands, garden], select: ["islands"] },
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
