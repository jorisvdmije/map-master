import { geometryParts } from './geometry.js';
import type { Coordinate, FeatureId, GeometryFeatureCollection, SnapResult, SnappingOptions } from './types.js';

export interface ScreenPoint { x: number; y: number }
interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
interface Candidate extends Bounds {
  kind: 'vertex' | 'edge';
  featureId: FeatureId;
  index: number;
  ringIndex: number | undefined;
  partIndex: number | undefined;
  order: number;
  a: ScreenPoint;
  b: ScreenPoint;
  start: Coordinate;
  end: Coordinate;
}
interface Node extends Bounds { start: number; end: number; left?: Node; right?: Node }

export function snappingOptions(update: Partial<SnappingOptions> = {}, previous: SnappingOptions = {
  enabled: false, distance: 18, vertices: true, edges: true,
}): SnappingOptions {
  const options = { ...previous, ...update };
  if (typeof options.enabled !== 'boolean' || typeof options.vertices !== 'boolean' || typeof options.edges !== 'boolean') {
    throw new TypeError('Snapping enabled, vertices, and edges must be booleans.');
  }
  if (!Number.isFinite(options.distance) || options.distance <= 0 || options.distance > 100) {
    throw new RangeError('Snapping distance must be greater than 0 and at most 100 CSS pixels.');
  }
  return options;
}

/** Partition around the median without re-sorting and copying every subtree. */
function partition(items: Candidate[], start: number, end: number, middle: number, horizontal: boolean): void {
  const center = (item: Candidate) => horizontal ? item.minX / 2 + item.maxX / 2 : item.minY / 2 + item.maxY / 2;
  let low = start; let high = end - 1;
  let remaining = 2 * Math.ceil(Math.log2(end - start));
  while (low < high) {
    // Bound adversarial partitioning: sorting this remaining range still places
    // the median correctly, without quadratic worst-case construction.
    if (remaining-- === 0) {
      const sorted = items.slice(low, high + 1).sort((a, b) => center(a) - center(b));
      for (let i = 0; i < sorted.length; i++) items[low + i] = sorted[i]!;
      return;
    }
    const a = center(items[low]!); const b = center(items[(low + high) >>> 1]!); const c = center(items[high]!);
    const pivot = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
    let left = low; let right = high;
    while (left <= right) {
      while (center(items[left]!) < pivot) left++;
      while (center(items[right]!) > pivot) right--;
      if (left <= right) {
        [items[left], items[right]] = [items[right]!, items[left]!];
        left++; right--;
      }
    }
    if (middle <= right) high = right;
    else if (middle >= left) low = left;
    else return;
  }
}
function tree(items: Candidate[], start = 0, end = items.length): Node {
  const node: Node = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, start, end };
  for (let i = start; i < end; i++) {
    const item = items[i]!;
    node.minX = Math.min(node.minX, item.minX); node.minY = Math.min(node.minY, item.minY);
    node.maxX = Math.max(node.maxX, item.maxX); node.maxY = Math.max(node.maxY, item.maxY);
  }
  if (end - start <= 16) return node;
  const middle = (start + end) >>> 1;
  partition(items, start, end, middle, node.maxX - node.minX >= node.maxY - node.minY);
  node.left = tree(items, start, middle); node.right = tree(items, middle, end);
  return node;
}
function intersects(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** Feature order is handled first; component, ring and vertex indices break remaining ties. */
function earlierAddress(a: Candidate, b: Candidate): boolean {
  return (a.partIndex ?? 0) - (b.partIndex ?? 0) < 0
    || a.partIndex === b.partIndex && ((a.ringIndex ?? 0) - (b.ringIndex ?? 0) < 0
      || a.ringIndex === b.ringIndex && a.index < b.index);
}

/** Projected bounds hierarchy: exact pixel distances, no browser/map dependencies. */
export class SnapIndex {
  private readonly root: Node;
  private readonly items: Candidate[];

  constructor(collection: GeometryFeatureCollection, project: (coordinate: Coordinate) => ScreenPoint) {
    const items: Candidate[] = [];
    for (const [order, feature] of collection.features.entries()) {
      const multipart = feature.geometry.type === 'MultiPolygon' || feature.geometry.type === 'MultiLineString';
      for (const [partIndex, part] of geometryParts(feature.geometry).entries()) {
        const polygon = part.type === 'Polygon';
        const rings = part.type === 'Polygon' ? part.coordinates.map((ring) => ring.slice(0, -1)) : part.type === 'Point' ? [[part.coordinates]] : [part.coordinates];
        for (const [ringIndex, coordinates] of rings.entries()) {
          // Keep one object shape for every candidate. Spreading a different
          // address object for each geometry makes cold index builds expensive.
          const candidatePart = multipart ? partIndex : undefined;
          const candidateRing = polygon ? ringIndex : undefined;
          const points = coordinates.map(project);
          for (let index = 0; index < coordinates.length; index++) {
            const a = points[index]!; const start = coordinates[index]!;
            if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
            items.push({ kind: 'vertex', featureId: feature.id, partIndex: candidatePart, ringIndex: candidateRing, index, order, a, b: a, start: [...start], end: [...start],
              minX: a.x, minY: a.y, maxX: a.x, maxY: a.y });
            if (!polygon && index === coordinates.length - 1) continue;
            const next = (index + 1) % coordinates.length;
            const b = points[next]!;
            if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
            items.push({ kind: 'edge', featureId: feature.id, partIndex: candidatePart, ringIndex: candidateRing, index, order, a, b, start: [...start], end: [...coordinates[next]!],
              minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) });
          }
        }
      }
    }
    this.items = items;
    this.root = tree(items);
  }

  query(point: ScreenPoint, options: SnappingOptions, unproject: (point: ScreenPoint) => Coordinate, excludedFeatureId: FeatureId | ReadonlySet<FeatureId> | null = null): SnapResult | null {
    if (!options.enabled || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const distance = options.distance;
    const box: Bounds = { minX: point.x - distance, minY: point.y - distance, maxX: point.x + distance, maxY: point.y + distance };
    let best: { candidate: Candidate; point: ScreenPoint; t: number; distance: number } | undefined;
    const visit = (node: Node): void => {
      if (!intersects(node, box)) return;
      if (node.left && node.right) { visit(node.left); visit(node.right); return; }
      for (let i = node.start; i < node.end; i++) {
        const candidate = this.items[i]!;
        // Exclude the entire saved edit target without rebuilding the shared index.
        if (typeof excludedFeatureId === 'object' && excludedFeatureId !== null ? excludedFeatureId.has(candidate.featureId) : candidate.featureId === excludedFeatureId) continue;
        if (!intersects(candidate, box) || candidate.kind === 'vertex' && !options.vertices || candidate.kind === 'edge' && !options.edges) continue;
        const { a, b } = candidate;
        const dx = b.x - a.x; const dy = b.y - a.y;
        const length = dx * dx + dy * dy;
        const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
        const nearest = { x: a.x + t * dx, y: a.y + t * dy };
        const pixels = Math.hypot(point.x - nearest.x, point.y - nearest.y);
        if (pixels > distance) continue;
        const priority = candidate.kind === 'vertex' ? 0 : 1;
        const previous = best?.candidate.kind === 'vertex' ? 0 : 1;
        if (!best || priority < previous || priority === previous && (pixels < best.distance
          || pixels === best.distance && (candidate.order > best.candidate.order
          || candidate.order === best.candidate.order && earlierAddress(candidate, best.candidate)))) {
          best = { candidate, point: nearest, t, distance: pixels };
        }
      }
    };
    visit(this.root);
    if (!best) return null;
    const { candidate, t } = best;
    // Preserve source coordinates exactly at vertices/endpoints; inverse projection
    // is only used for interior edge points along the displayed straight segment.
    const coordinate = t === 0 ? [...candidate.start] as Coordinate : t === 1 ? [...candidate.end] as Coordinate : unproject(best.point);
    return { kind: candidate.kind, featureId: candidate.featureId, index: candidate.index, ...(candidate.ringIndex !== undefined ? { ringIndex: candidate.ringIndex } : {}), ...(candidate.partIndex !== undefined ? { partIndex: candidate.partIndex } : {}), coordinate, distance: best.distance };
  }
}
