import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { registry, catalogCheckedAt } from "../../src/features/catalog/registry.ts";
import { areasCsv } from "../../src/features/housing/model.ts";
const sha = content => createHash("sha256").update(content).digest("hex");

/** Publish metadata only to the app bundle; full files remain explicit downloads. */
export function createCatalog({ housing, geometry, observations, heat, observationMeta, queue }) {
  const artifacts = new Map();
  const publish = (path, content) => { artifacts.set(path, content); queue(path, content); return content; };
  const downloads = new Map();
  const file = (key, label, format, path, content, generated = false) => {
    if (generated) publish(path, content);
    const item = { label, format, path, bytes: Buffer.byteLength(content), sha256: sha(content) };
    downloads.set(key, [...downloads.get(key) ?? [], item]); return item;
  };
  const housingFile = file("housing", "Buurtvlakken met alle kenmerken", "GeoJSON", "/data/catalog/cbs-buurten.geojson", JSON.stringify({ ...housing.data, provenance: housing.meta }), true);
  const csvFile = file("housing", "Buurtcijfers als tabel", "CSV", "/data/catalog/cbs-buurten.csv", areasCsv(housing.data.features, housing.meta.indicators), true);
  const metadata = JSON.stringify({ version: 1, source: housing.meta, files: [housingFile, csvFile], selection: "Alle buurtvlakken in de vastgelegde Amsterdam-snapshot; geen minimumwoningfilter", csv: { delimiter: ";", decimal: ".", encoding: "UTF-8 with BOM", missing: "empty cell" } }, null, 2);
  file("housing", "Herkomst, definities en bestandscontroles", "JSON", "/data/catalog/cbs-buurten.metadata.json", metadata, true);
  file("roads", "Originele wegvakken", "GeoJSON", `/data/amsterdam-roads.${observationMeta.geometrySha256.slice(0, 16)}.geojson`, geometry);
  file("observations", "Tellingen per wegvak", "JSON", `/data/amsterdam-street-observations.${observationMeta.observationsSha256.slice(0, 16)}.json`, observations);
  file("heat", "Geaggregeerde bronvakken", "JSON", `/data/amsterdam-street-heat.${observationMeta.heatSha256.slice(0, 16)}.json`, heat);
  const snapshots = {
    housing: { retrievedAt: housing.meta.retrievedAt, count: housing.data.features.length, unit: "buurtvlakken", sha256: housing.meta.sha256 },
    roads: { retrievedAt: observationMeta.retrieved, count: JSON.parse(geometry).features.length, unit: "wegvakken", sha256: sha(geometry) },
    observations: { retrievedAt: observationMeta.retrieved, count: Object.keys(JSON.parse(observations).roads).length, unit: "wegvakken met tellingen", sha256: sha(observations) },
    heat: { retrievedAt: observationMeta.retrieved, count: JSON.parse(heat).cells.length, unit: "bronvakken", sha256: sha(heat) },
  };
  const catalog = { version: 1, checkedAt: catalogCheckedAt, datasets: registry.map(entry => ({ ...entry, downloads: downloads.get(entry.localKey) ?? [], ...(entry.localKey ? { snapshot: snapshots[entry.localKey] } : {}) })) };
  const ids = new Set();
  for (const entry of catalog.datasets) {
    if (!/^[a-z0-9-]+$/.test(entry.id) || entry.id === "catalog" || ids.has(entry.id)) throw new Error(`Invalid/duplicate catalog ID: ${entry.id}`);
    ids.add(entry.id);
    if (entry.availability === "local" && !entry.downloads.length) throw new Error(`Missing local dataset: ${entry.id}`);
    for (const download of entry.downloads) if (download.bytes <= 0 || !/^[a-f0-9]{64}$/.test(download.sha256)) throw new Error(`Invalid download: ${entry.id}`);
  }
  for (const entry of catalog.datasets) publish(`/data/catalog/${entry.id}.json`, JSON.stringify({ version: 1, checkedAt: catalog.checkedAt, meaning: "Bronprofiel; geen volledige dataset", dataset: entry }, null, 2));
  publish("/data/catalog/index.json", JSON.stringify(catalog));
  return { catalog, artifacts };
}
