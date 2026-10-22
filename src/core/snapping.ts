import type { Coordinate, FeatureId, GeometryFeatureCollection, SnapResult, SnappingOptions } from './types.js';

export interface ScreenPoint { x: number; y: number }
interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
interface Candidate extends Bounds {
  kind: 'vertex' | 'edge';
  featureId: FeatureId;
  index: number;
  order: number;
  a: ScreenPoint;
  b: ScreenPoint;
  start: Coordinate;
  end: Coordinate;
}
interface Node extends Bounds { items?: Candidate[]; left?: Node; right?: Node }

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

function bounds(items: Candidate[]): Bounds {
  const result = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const item of items) {
    result.minX = Math.min(result.minX, item.minX); result.minY = Math.min(result.minY, item.minY);
    result.maxX = Math.max(result.maxX, item.maxX); result.maxY = Math.max(result.maxY, item.maxY);
  }
  return result;
}
function tree(items: Candidate[]): Node {
  const box = bounds(items);
  if (items.length <= 16) return { ...box, items };
  const horizontal = box.maxX - box.minX >= box.maxY - box.minY;
  items.sort((a, b) => horizontal ? (a.minX + a.maxX) - (b.minX + b.maxX) : (a.minY + a.maxY) - (b.minY + b.maxY));
  const middle = Math.floor(items.length / 2);
  return { ...box, left: tree(items.slice(0, middle)), right: tree(items.slice(middle)) };
}
function intersects(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** Projected bounds hierarchy: exact pixel distances, no browser/map dependencies. */
export class SnapIndex {
  private readonly root: Node;

  constructor(collection: GeometryFeatureCollection, project: (coordinate: Coordinate) => ScreenPoint) {
    const items: Candidate[] = [];
    for (const [order, feature] of collection.features.entries()) {
      const polygon = feature.geometry.type === 'Polygon';
      const coordinates = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0]!.slice(0, -1) : feature.geometry.coordinates;
      const points = coordinates.map(project);
      for (let index = 0; index < coordinates.length; index++) {
        const a = points[index]!; const start = coordinates[index]!;
        if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
        items.push({ kind: 'vertex', featureId: feature.id, index, order, a, b: a, start: [...start], end: [...start],
          minX: a.x, minY: a.y, maxX: a.x, maxY: a.y });
        if (!polygon && index === coordinates.length - 1) continue;
        const next = (index + 1) % coordinates.length;
        const b = points[next]!;
        if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
        items.push({ kind: 'edge', featureId: feature.id, index, order, a, b, start: [...start], end: [...coordinates[next]!],
          minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) });
      }
    }
    this.root = tree(items);
  }

  query(point: ScreenPoint, options: SnappingOptions, unproject: (point: ScreenPoint) => Coordinate, excludedFeatureId: FeatureId | null = null): SnapResult | null {
    if (!options.enabled || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const distance = options.distance;
    const box: Bounds = { minX: point.x - distance, minY: point.y - distance, maxX: point.x + distance, maxY: point.y + distance };
    let best: { candidate: Candidate; point: ScreenPoint; t: number; distance: number } | undefined;
    const visit = (node: Node): void => {
      if (!intersects(node, box)) return;
      if (node.left) visit(node.left);
      if (node.right) visit(node.right);
      for (const candidate of node.items ?? []) {
        // Exclude the entire saved edit target without rebuilding the shared index.
        if (candidate.featureId === excludedFeatureId) continue;
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
          || candidate.order === best.candidate.order && candidate.index < best.candidate.index))) {
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
    return { kind: candidate.kind, featureId: candidate.featureId, index: candidate.index, coordinate, distance: best.distance };
  }
}
