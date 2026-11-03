import type { DataLayer, FeatureId, FeatureStyle, GeometryFeature, GeometryFeatureCollection, JsonValue } from "@jorisvdmije/map-master";
import { resolveFeaturePreview, type FeaturePreviewOptions } from "@jorisvdmije/map-master";

export type LayerFeaturePreview = { layerId: string; options: FeaturePreviewOptions };

export const projectFormat = "map-master-playground";
export const styleProperty = "mapMasterPlaygroundStyle";
export const maxFileBytes = 10 * 1024 * 1024;
const maxProjectBytes = 50 * 1024 * 1024;
export const maxFeatures = 20_000;
export const palette = ["#23836d", "#c77837", "#5278bd", "#9861a9", "#be626d", "#789443"];
export type Settings = { basemap: "streets" | "blank"; snapping: boolean; guides: boolean; measurements: boolean; scaleBorders: boolean; toolbarColumns: 1 | 2 };
export interface Project {
  format: typeof projectFormat;
  version: 1;
  name: string;
  data: GeometryFeatureCollection;
  layers: DataLayer[];
  activeLayerId: string | null;
  lockedFeatureIds: FeatureId[];
  camera: { center: [number, number]; zoom: number };
  settings: Settings;
  hoverPreviews: LayerFeaturePreview[];
}

export function layerStyle(color: string): FeatureStyle {
  return { shape: { fillColor: color, fillOpacity: 0.22, lineColor: color, lineWidth: 2, lineOpacity: 1 }, marker: { color, radius: 7, opacity: 1, strokeColor: "#ffffff", strokeWidth: 2 } };
}

export function newLayer(id: string, name: string, color = palette[0]!): DataLayer {
  return { id, name, visible: true, editable: true, locked: false, selectable: true, snapping: true, style: layerStyle(color) };
}

export function emptyProject(): Project {
  return {
    format: projectFormat, version: 1, name: "Untitled project",
    data: { type: "FeatureCollection", features: [] }, layers: [newLayer("default", "My first layer")],
    activeLayerId: "default", lockedFeatureIds: [], camera: { center: [4.895, 52.372], zoom: 13 },
    settings: { basemap: "streets", snapping: true, guides: false, measurements: false, scaleBorders: false, toolbarColumns: 2 },
    hoverPreviews: [],
  };
}

export const featureKey = (id: FeatureId) => `${typeof id}:${id}`;
export const layerId = (feature: GeometryFeature) => typeof feature.properties?.mapMasterLayer === "string" ? feature.properties.mapMasterLayer : "default";
export const featureName = (feature: GeometryFeature) => typeof feature.properties?.name === "string" && feature.properties.name.trim() ? feature.properties.name : String(feature.id);
const reserved = new Set(["mapMasterLayer", "mapMasterPins", styleProperty]);
export const editableField = (key: string) => !reserved.has(key);
export function displayValue(value: JsonValue | undefined): string {
  return value === undefined ? "—" : typeof value === "string" ? value : JSON.stringify(value);
}
export function download(content: string, filename: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const filename = (name: string) => name.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 100) || "map-project";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function number(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
function id(value: unknown): value is FeatureId { return typeof value === "string" || typeof value === "number" && Number.isFinite(value); }
function validStyle(value: unknown): value is FeatureStyle {
  if (!record(value) || Object.keys(value).some(key => !["shape", "marker", "sortKey"].includes(key))) return false;
  if (value.sortKey !== undefined && !number(value.sortKey, -Number.MAX_VALUE, Number.MAX_VALUE)) return false;
  for (const [group, allowed] of [["shape", ["lineColor", "lineWidth", "lineOpacity", "fillColor", "fillOpacity"]], ["marker", ["shape", "color", "radius", "opacity", "strokeColor", "strokeWidth"]]] as const) {
    const fields = value[group];
    if (fields === undefined) continue;
    if (!record(fields)) return false;
    for (const [key, val] of Object.entries(fields)) {
      if (!(allowed as readonly string[]).includes(key)) return false;
      if (key === "shape") { if (val !== "circle" && val !== "pin") return false; }
      else if (key.toLowerCase().includes("color")) { if (typeof val !== "string" || !/^#(?:[a-f\d]{3}|[a-f\d]{6})$/iu.test(val)) return false; }
      else if (!number(val, 0, key.toLowerCase().includes("opacity") ? 1 : key === "strokeWidth" ? 16 : 32)) return false;
    }
  }
  return true;
}
export function featureStyle(feature: GeometryFeature): FeatureStyle | undefined {
  const style = feature.properties?.[styleProperty];
  return validStyle(style) ? style : undefined;
}

/** Validate the envelope before changing the live editor. Geometry is checked by its public transaction API. */
export function parseProject(value: unknown): Project {
  if (!record(value) || value.format !== projectFormat || value.version !== 1) throw new Error("This is not a supported Map Master project (version 1).");
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 150) throw new Error("The project needs a name of 1–150 characters.");
  if (!record(value.data) || value.data.type !== "FeatureCollection" || !Array.isArray(value.data.features) || value.data.features.length > maxFeatures) throw new Error(`A project needs a FeatureCollection with at most ${maxFeatures.toLocaleString()} features.`);
  if (!Array.isArray(value.layers) || value.layers.length === 0 || value.layers.length > 200) throw new Error("A project needs 1–200 layers.");
  const ids = new Set<string>();
  for (const layer of value.layers as unknown[]) {
    if (!record(layer) || typeof layer.id !== "string" || !layer.id.trim() || layer.id.length > 200 || ids.has(layer.id)
      || typeof layer.name !== "string" || !layer.name.trim() || layer.name.length > 150 || !validStyle(layer.style)
      || ["visible", "editable", "locked", "selectable", "snapping"].some(key => typeof layer[key] !== "boolean")
      || Object.keys(layer).some(key => !["id", "name", "style", "visible", "editable", "locked", "selectable", "snapping"].includes(key))) throw new Error("The project contains an invalid or duplicate layer.");
    try { encodeURIComponent(layer.id); } catch { throw new Error("A layer ID contains invalid Unicode."); }
    ids.add(layer.id);
  }
  if (!ids.has("default")) throw new Error("The default layer is missing from this project.");
  const seen = new Set<FeatureId>();
  for (const feature of value.data.features as unknown[]) {
    if (!record(feature) || feature.type !== "Feature" || !id(feature.id) || seen.has(feature.id)) throw new Error("Project features need unique string or numeric IDs.");
    seen.add(feature.id);
    const membership = record(feature.properties) ? feature.properties.mapMasterLayer ?? "default" : "default";
    if (typeof membership !== "string" || !ids.has(membership)) throw new Error("A feature references a missing layer.");
  }
  if (!Array.isArray(value.lockedFeatureIds) || value.lockedFeatureIds.some(key => !id(key) || !seen.has(key))) throw new Error("The project contains an invalid feature lock.");
  if (value.activeLayerId !== null && (typeof value.activeLayerId !== "string" || !(value.layers as DataLayer[]).some(layer => layer.id === value.activeLayerId && layer.visible && layer.editable && !layer.locked))) throw new Error("The active layer must be visible and editable.");
  if (!record(value.camera) || !Array.isArray(value.camera.center) || value.camera.center.length !== 2 || !number(value.camera.center[0], -180, 180) || !number(value.camera.center[1], -85.05112878, 85.05112878) || !number(value.camera.zoom, -2, 22)) throw new Error("The project has an invalid map position.");
  if (!record(value.settings) || !["streets", "blank"].includes(String(value.settings.basemap)) || ["snapping", "guides", "measurements", "scaleBorders"].some(key => typeof (value.settings as Record<string, unknown>)[key] !== "boolean")) throw new Error("The project has invalid map settings.");
  if (value.settings.toolbarColumns !== undefined && value.settings.toolbarColumns !== 1 && value.settings.toolbarColumns !== 2) throw new Error("Toolbar columns must be 1 or 2.");
  const project = structuredClone(value) as unknown as Project;
  if (value.hoverPreviews !== undefined) {
    if (!Array.isArray(value.hoverPreviews) || value.hoverPreviews.length > 200) throw new Error("Invalid layer hover settings.");
    const configured = new Set<string>();
    for (const item of value.hoverPreviews) {
      if (!record(item) || !record(item.options) || Object.keys(item).some(key => !["layerId", "options"].includes(key)) || typeof item.layerId !== "string" || !ids.has(item.layerId) || configured.has(item.layerId)) throw new Error("Invalid or duplicate hover layer.");
      configured.add(item.layerId); resolveFeaturePreview(item.options as FeaturePreviewOptions);
    }
  }
  project.hoverPreviews ??= [];
  // Projects saved before the layout option use the new default.
  project.settings.toolbarColumns ??= 2;
  return project;
}

export async function readFile(file: File, project = false): Promise<unknown> {
  const projectFile = project || /\.mapmaster\.json$/iu.test(file.name);
  if (file.size > (projectFile ? maxProjectBytes : maxFileBytes)) throw new Error(projectFile ? "Choose a project smaller than 50 MB." : "Choose a GeoJSON file smaller than 10 MB.");
  try { return JSON.parse(await file.text()) as unknown; }
  catch { throw new Error("This file is not valid JSON. Choose GeoJSON or a Map Master project."); }
}

export function sampleProject(): Project {
  const project = emptyProject();
  project.name = "Amsterdam field notes";
  project.layers = [newLayer("default", "Places", palette[2]), newLayer("routes", "Walking routes", palette[1]), newLayer("areas", "Study areas", palette[0])];
  project.layers[0]!.style.marker = { ...project.layers[0]!.style.marker, shape: "pin", radius: 10 };
  project.hoverPreviews = [
    { layerId: "default", options: { fields: [{ key: "category", label: "Type" }, { key: "capacity", label: "Capacity", format: "number", decimals: 0 }] } },
    { layerId: "areas", options: { fields: [{ key: "status", label: "Status" }] } },
    { layerId: "routes", options: { fields: [{ key: "accessible", label: "Accessible" }] } },
  ];
  project.activeLayerId = "areas";
  project.camera = { center: [4.8876, 52.371], zoom: 14.1 };
  project.data.features = [
    { type: "Feature", id: "area-1", properties: { name: "Western study area", category: "Survey", status: "In progress", mapMasterLayer: "areas" }, geometry: { type: "Polygon", coordinates: [[[4.874, 52.370], [4.882, 52.370], [4.882, 52.376], [4.874, 52.376], [4.874, 52.370]]] } },
    { type: "Feature", id: "area-2", properties: { name: "Canal district", category: "Survey", status: "Planned", mapMasterLayer: "areas" }, geometry: { type: "Polygon", coordinates: [[[4.889, 52.366], [4.900, 52.366], [4.900, 52.372], [4.889, 52.372], [4.889, 52.366]]] } },
    { type: "Feature", id: "route-1", properties: { name: "Morning walk", distance_km: 1.4, accessible: true, mapMasterLayer: "routes" }, geometry: { type: "LineString", coordinates: [[4.877, 52.373], [4.885, 52.374], [4.890, 52.371], [4.896, 52.369]] } },
    { type: "Feature", id: "place-1", properties: { name: "Meeting point", category: "Start", capacity: 12 }, geometry: { type: "Point", coordinates: [4.877, 52.373] } },
    { type: "Feature", id: "place-2", properties: { name: "Observation point", category: "Survey", capacity: 4 }, geometry: { type: "Point", coordinates: [4.890, 52.371] } },
    { type: "Feature", id: "place-3", properties: { name: "Finish", category: "End", capacity: 20 }, geometry: { type: "Point", coordinates: [4.896, 52.369] } },
  ];
  return project;
}
