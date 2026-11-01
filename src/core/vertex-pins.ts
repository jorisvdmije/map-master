import { geometryParts, mapGeometry, withGeometry } from './geometry.js';
import { samePosition } from './polygon.js';
import type { Coordinate, FeatureChange, FeatureId, GeometryFeature } from './types.js';

/** Zero-based open-ring addressing. Point uses index 0; omitted part/ring mean 0. */
export interface VertexAddress { featureId: FeatureId; index: number; partIndex?: number; ringIndex?: number }
/** Matching uses planar longitude/latitude degrees, default 0 (exact). */
export interface PinVerticesOptions { tolerance?: number }
export interface VertexPin { id: string; coordinate: Coordinate }
export interface PinnedVertexGroup extends VertexPin { vertices: VertexAddress[] }
export type PinningErrorCode = 'pin-conflict' | 'pin-invalid-result' | 'pin-locked';
/** A rejected operation leaves all committed data and history unchanged. */
export class VertexPinError extends Error {
  constructor(public readonly code: PinningErrorCode, message: string) { super(message); this.name = 'VertexPinError'; }
}

/** Closing copies are excluded; every address returned here identifies a real vertex. */
export function featureVertices(feature: GeometryFeature): (Required<VertexAddress> & { coordinate: Coordinate })[] {
  return geometryParts(feature.geometry).flatMap((part, partIndex) => {
    const rings = part.type === 'Polygon' ? part.coordinates : [part.type === 'Point' ? [part.coordinates] : part.coordinates];
    return rings.flatMap((ring, ringIndex) => ring.slice(0, part.type === 'Polygon' ? -1 : undefined).map((coordinate, index) =>
      ({ featureId: feature.id, partIndex, ringIndex, index, coordinate })));
  });
}

/** Metadata uses coordinates so ring winding and vertex insertion cannot silently retarget links. */
export function readVertexPins(feature: GeometryFeature): VertexPin[] {
  const value = feature.properties?.mapMasterPins;
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError('mapMasterPins must be an array.');
  const ids = new Set<string>(); const points = new Set<string>();
  const pins = value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => key !== 'id' && key !== 'coordinate')
      || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 200 || ids.has(item.id)
      || !Array.isArray(item.coordinate) || item.coordinate.length !== 2) throw new TypeError('Invalid or duplicate vertex pin.');
    const [x, y] = item.coordinate;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 90
      || points.has(`${x},${y}`)) throw new TypeError('Invalid or duplicate pin coordinate.');
    ids.add(item.id); points.add(`${x},${y}`);
    return { id: item.id, coordinate: [x, y] as Coordinate };
  });
  if (pins.length) {
    const vertices = new Set(featureVertices(feature).map(vertex => `${vertex.coordinate[0]},${vertex.coordinate[1]}`));
    if (pins.some(pin => !vertices.has(`${pin.coordinate[0]},${pin.coordinate[1]}`))) throw new TypeError('A pinned coordinate must identify an existing vertex. Unpin before removing it.');
  }
  return pins;
}

export function withVertexPins(feature: GeometryFeature, pins: readonly VertexPin[]): GeometryFeature {
  const properties = { ...feature.properties };
  if (pins.length) properties.mapMasterPins = pins.map(pin => ({ id: pin.id, coordinate: [...pin.coordinate] }));
  else delete properties.mapMasterPins;
  return withGeometry({ ...feature, properties: feature.properties === null && !pins.length ? null : properties }, feature.geometry);
}

/** Remap linked positions simultaneously; optionally leave the actively edited path alone. */
export function moveVertexPins(feature: GeometryFeature, destinations: ReadonlyMap<string, Coordinate>, skip?: { partIndex: number; ringIndex: number }, pins = readVertexPins(feature)): GeometryFeature {
  const moves = new Map(pins.filter(pin => destinations.has(pin.id)).map(pin => [pin.coordinate.join(','), destinations.get(pin.id)!]));
  const geometry = mapGeometry(feature.geometry, point => [...point]);
  for (const [partIndex, part] of geometryParts(geometry).entries()) {
    const rings = part.type === 'Polygon' ? part.coordinates : [part.type === 'Point' ? [part.coordinates] : part.coordinates];
    for (const [ringIndex, ring] of rings.entries()) {
      if (skip?.partIndex === partIndex && skip.ringIndex === ringIndex) continue;
      for (const point of ring) {
        const target = moves.get(point.join(','));
        if (target) { point[0] = target[0]; point[1] = target[1]; }
      }
    }
  }
  return withVertexPins(withGeometry(feature, geometry), pins.map(pin => ({ id: pin.id, coordinate: destinations.get(pin.id) ?? pin.coordinate })));
}

/** Incremental committed membership index. Ordinary unpinned edits never scan the dataset. */
export class VertexPinIndex {
  private readonly groups = new Map<string, Map<FeatureId, Coordinate>>();
  private readonly members = new Map<FeatureId, VertexPin[]>();

  pins(id: FeatureId): readonly VertexPin[] { return this.members.get(id) ?? []; }
  related(id: FeatureId): FeatureId[] {
    return [...new Set(this.pins(id).flatMap(pin => [...this.groups.get(pin.id)!.keys()]))];
  }
  has(id: string): boolean { return this.groups.has(id); }
  group(id: string): Iterable<readonly [FeatureId, Coordinate]> { return this.groups.get(id) ?? []; }

  validate(changes: readonly FeatureChange[]): void {
    const touched = new Set<string>(); const changed = new Set<FeatureId>();
    const next = new Map<string, Coordinate>();
    for (const { before, after } of changes) {
      changed.add((before ?? after)!.id);
      if (before) for (const pin of this.pins(before.id)) touched.add(pin.id);
      if (after) for (const pin of readVertexPins(after)) {
        touched.add(pin.id);
        if (next.has(pin.id) && !samePosition(next.get(pin.id)!, pin.coordinate)) throw new VertexPinError('pin-conflict', `Pin ${pin.id} must have identical coordinates in every feature.`);
        next.set(pin.id, pin.coordinate);
      }
    }
    for (const id of touched) for (const [featureId, coordinate] of this.groups.get(id) ?? []) {
      if (changed.has(featureId) || !next.has(id)) continue;
      if (!samePosition(next.get(id)!, coordinate)) throw new VertexPinError('pin-conflict', `Move every participant of pin ${id} together, or unpin first.`);
    }
  }

  apply(changes: readonly FeatureChange[]): void {
    for (const { before, after } of changes) {
      const featureId = (before ?? after)!.id;
      for (const pin of this.pins(featureId)) {
        const group = this.groups.get(pin.id)!; group.delete(featureId);
        if (!group.size) this.groups.delete(pin.id);
      }
      this.members.delete(featureId);
      const pins = after ? readVertexPins(after) : [];
      if (pins.length) this.members.set(featureId, pins);
      for (const pin of pins) {
        if (!this.groups.has(pin.id)) this.groups.set(pin.id, new Map());
        this.groups.get(pin.id)!.set(featureId, pin.coordinate);
      }
    }
  }

  snapshot(features: ReadonlyMap<FeatureId, GeometryFeature>): PinnedVertexGroup[] {
    const addresses = new Map<FeatureId, Map<string, VertexAddress[]>>();
    for (const featureId of this.members.keys()) {
      const points = new Map<string, VertexAddress[]>();
      for (const vertex of featureVertices(features.get(featureId)!)) {
        const key = vertex.coordinate.join(',');
        if (!points.has(key)) points.set(key, []);
        points.get(key)!.push({ featureId, partIndex: vertex.partIndex, ringIndex: vertex.ringIndex, index: vertex.index });
      }
      addresses.set(featureId, points);
    }
    return [...this.groups].map(([id, members]) => ({ id, coordinate: [...members.values().next().value!] as Coordinate,
      vertices: [...members].flatMap(([featureId, coordinate]) => addresses.get(featureId)!.get(coordinate.join(','))!.map(address => ({ ...address }))) }));
  }
}
