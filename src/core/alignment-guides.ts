import { geometryParts } from './geometry.js';
import type { Coordinate, FeatureId, GeometryFeatureCollection } from './types.js';
import type { ScreenPoint } from './snapping.js';

export interface AlignmentGuidesOptions {
  enabled: boolean;
  /** Radial acquisition tolerance, (0, 32] CSS pixels; default 8. */
  distance: number;
  horizontal: boolean;
  vertical: boolean;
  extensions: boolean;
  /** Total inspected index entries per query, 6–512; default 96. */
  maxCandidates: number;
}
export interface AlignmentGuide {
  kind: 'horizontal' | 'vertical' | 'extension';
  /** null identifies the current uncommitted draft. */
  featureId: FeatureId | null;
  index: number;
  partIndex?: number;
  ringIndex?: number;
  /** Canvas-relative CSS pixels, for the current camera only. */
  start: ScreenPoint;
  end: ScreenPoint;
}
export interface AlignmentResult {
  coordinate: Coordinate;
  distance: number;
  guides: AlignmentGuide[];
  examinedCandidates: number;
  /** A candidate budget or dense extension bucket omitted additional sources. */
  limited: boolean;
}
export interface AlignmentPath {
  featureId: FeatureId | null;
  coordinates: readonly Coordinate[];
  closed: boolean;
  partIndex?: number;
  ringIndex?: number;
  excluded?: ReadonlySet<number>;
}
interface Source {
  featureId: FeatureId | null; index: number; partIndex?: number; ringIndex?: number;
  a: ScreenPoint; b: ScreenPoint; order: number;
}
interface Match { source: Source; point: ScreenPoint; distance: number; kind: AlignmentGuide['kind']; }
export interface AlignmentQuery {
  point: ScreenPoint | null;
  distance: number;
  guides: AlignmentGuide[];
  examinedCandidates: number;
  limited: boolean;
}

export function alignmentGuidesOptions(update: Partial<AlignmentGuidesOptions> = {}, previous: AlignmentGuidesOptions = {
  enabled: false, distance: 8, horizontal: true, vertical: true, extensions: true, maxCandidates: 96,
}): AlignmentGuidesOptions {
  if (typeof update !== 'object' || update === null || Array.isArray(update)
    || Object.keys(update).some(key => !Object.hasOwn(previous, key))) throw new TypeError('Expected alignment guide settings.');
  const next = { ...previous, ...update };
  for (const key of ['enabled', 'horizontal', 'vertical', 'extensions'] as const) if (typeof next[key] !== 'boolean') throw new TypeError(`Alignment ${key} must be a boolean.`);
  if (typeof next.distance !== 'number' || !Number.isFinite(next.distance) || next.distance <= 0 || next.distance > 32) throw new RangeError('Alignment distance must be greater than zero and at most 32 CSS pixels.');
  if (!Number.isInteger(next.maxCandidates) || next.maxCandidates < 6 || next.maxCandidates > 512) throw new RangeError('Alignment maxCandidates must be an integer between 6 and 512.');
  return next;
}

export function alignmentPaths(collection: GeometryFeatureCollection, excluded: ReadonlySet<FeatureId> = new Set()): AlignmentPath[] {
  return collection.features.filter(feature => !excluded.has(feature.id)).flatMap(feature => geometryParts(feature.geometry).flatMap((part, partIndex) => {
    const paths = part.type === 'Polygon' ? part.coordinates.map(ring => ring.slice(0, -1)) : part.type === 'Point' ? [[part.coordinates]] : [part.coordinates];
    return paths.map((coordinates, ringIndex) => ({ featureId: feature.id, coordinates, closed: part.type === 'Polygon', partIndex,
      ...(part.type === 'Polygon' ? { ringIndex } : {}) }));
  }));
}

/** Clip an infinite straight line; keeps extension indexing independent of source edge length. */
function clip(a: ScreenPoint, b: ScreenPoint, width: number, height: number): [ScreenPoint, ScreenPoint] | null {
  const dx = b.x - a.x; const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  let low = -Infinity; let high = Infinity;
  for (const [start, delta, maximum] of [[a.x, dx, width], [a.y, dy, height]] as const) {
    if (delta === 0) { if (start < -32 || start > maximum + 32) return null; continue; }
    const p = (-32 - start) / delta; const q = (maximum + 32 - start) / delta;
    low = Math.max(low, Math.min(p, q)); high = Math.min(high, Math.max(p, q));
  }
  return low <= high ? [{ x: a.x + low * dx, y: a.y + low * dy }, { x: a.x + high * dx, y: a.y + high * dy }] : null;
}

function better(next: Match, previous: Match | null, pointer: ScreenPoint): boolean {
  if (!previous || next.distance < previous.distance) return true;
  if (next.distance !== previous.distance) return false;
  const distance = (match: Match) => Math.hypot(match.source.a.x - pointer.x, match.source.a.y - pointer.y);
  return distance(next) < distance(previous) || distance(next) === distance(previous) && next.source.order < previous.source.order;
}

/** Sorted axis indexes and a capped viewport grid for infinite edge extensions.
 * Builds are separate from pointer queries. Queries never fall back to a full scan.
 */
export class AlignmentIndex {
  private readonly x: Source[] = [];
  private readonly y: Source[] = [];
  private readonly grid = new Map<string, Source[]>();
  private readonly saturated = new Set<string>();
  private readonly cell: number;

  constructor(paths: readonly AlignmentPath[], project: (coordinate: Coordinate) => ScreenPoint, private readonly width: number, private readonly height: number) {
    this.cell = Math.max(64, Math.ceil(Math.max(width, height) / 64));
    const visible = (point: ScreenPoint) => Number.isFinite(point.x) && Number.isFinite(point.y)
      && point.x >= -32 && point.y >= -32 && point.x <= width + 32 && point.y <= height + 32;
    const lines = new Set<string>(); let order = 0;
    for (const path of paths) {
      const points = path.coordinates.map(project);
      for (let index = 0; index < points.length; index++) {
        const a = points[index]!;
        if (path.excluded?.has(index) || !visible(a)) continue;
        const source: Source = { featureId: path.featureId, index, ...(path.partIndex === undefined ? {} : { partIndex: path.partIndex }),
          ...(path.ringIndex === undefined ? {} : { ringIndex: path.ringIndex }), a, b: a, order: order++ };
        this.x.push(source); this.y.push(source);
        if (!path.closed && index === points.length - 1) continue;
        const next = (index + 1) % points.length; const b = points[next]!;
        if (path.excluded?.has(next) || !visible(b)) continue;
        const dx = b.x - a.x; const dy = b.y - a.y; const length = Math.hypot(dx, dy);
        if (length < 1e-6) continue;
        let nx = -dy / length; let ny = dx / length;
        if (ny < 0 || ny === 0 && nx < 0) { nx = -nx; ny = -ny; }
        // Deduplicate visually identical infinite lines (0.001 pixel offset precision).
        const key = `${Math.round(nx * 1e6)}:${Math.round(ny * 1e6)}:${Math.round((nx * a.x + ny * a.y) * 1000)}`;
        if (lines.has(key)) continue; lines.add(key);
        this.addLine({ ...source, b });
      }
    }
    this.x.sort((a, b) => a.a.x - b.a.x || a.order - b.order);
    this.y.sort((a, b) => a.a.y - b.a.y || a.order - b.order);
  }

  private addLine(source: Source): void {
    const segment = clip(source.a, source.b, this.width, this.height); if (!segment) return;
    const [a, b] = segment; const size = this.cell; const dx = b.x - a.x; const dy = b.y - a.y;
    let x = Math.floor(a.x / size); let y = Math.floor(a.y / size);
    const endX = Math.floor(b.x / size); const endY = Math.floor(b.y / size);
    const stepX = Math.sign(dx); const stepY = Math.sign(dy);
    const deltaX = dx === 0 ? Infinity : size / Math.abs(dx); const deltaY = dy === 0 ? Infinity : size / Math.abs(dy);
    let nextX = dx === 0 ? Infinity : ((x + (stepX > 0 ? 1 : 0)) * size - a.x) / dx;
    let nextY = dy === 0 ? Infinity : ((y + (stepY > 0 ? 1 : 0)) * size - a.y) / dy;
    // At most 64 rows + 64 columns, plus the padded boundary cells.
    for (let steps = 0; steps < 140; steps++) {
      const key = `${x}:${y}`; let bucket = this.grid.get(key);
      if (!bucket) { bucket = []; this.grid.set(key, bucket); }
      if (bucket.length < 128) bucket.push(source); else this.saturated.add(key);
      if (x === endX && y === endY) break;
      if (nextX < nextY) { x += stepX; nextX += deltaX; }
      else if (nextY < nextX) { y += stepY; nextY += deltaY; }
      else { x += stepX; y += stepY; nextX += deltaX; nextY += deltaY; }
    }
  }

  /** An optional frozen draft index shares the same total inspection budget. */
  query(pointer: ScreenPoint, options: AlignmentGuidesOptions, draft?: AlignmentIndex): AlignmentQuery {
    const result: AlignmentQuery = { point: null, distance: 0, guides: [], examinedCandidates: 0, limited: false };
    if (!options.enabled || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)
      || pointer.x < 0 || pointer.y < 0 || pointer.x > this.width || pointer.y > this.height) return result;
    const indexes = draft ? [this, draft] : [this];
    const kinds = Number(options.horizontal) + Number(options.vertical) + Number(options.extensions);
    if (!kinds) return result;
    const budget = Math.floor(options.maxCandidates / (indexes.length * kinds));
    let horizontal: Match | null = null; let vertical: Match | null = null; let extension: Match | null = null;
    for (const index of indexes) {
      const search = (items: Source[], axis: 'x' | 'y', kind: 'horizontal' | 'vertical', best: Match | null): Match | null => {
        let low = 0; let high = items.length;
        while (low < high) { const mid = (low + high) >>> 1; if (items[mid]!.a[axis] < pointer[axis]) low = mid + 1; else high = mid; }
        let left = low - 1; let right = low; let used = 0;
        while (left >= 0 || right < items.length) {
          const dl = left < 0 ? Infinity : Math.abs(items[left]!.a[axis] - pointer[axis]);
          const dr = right >= items.length ? Infinity : Math.abs(items[right]!.a[axis] - pointer[axis]);
          if (Math.min(dl, dr) > options.distance) break;
          if (used === budget) { result.limited = true; break; }
          const source = dl < dr ? items[left--]! : items[right++]!;
          used++; result.examinedCandidates++;
          const point = axis === 'x' ? { x: source.a.x, y: pointer.y } : { x: pointer.x, y: source.a.y };
          const match: Match = { source, point, kind, distance: Math.abs(source.a[axis] - pointer[axis]) };
          if (better(match, best, pointer)) best = match;
        }
        return best;
      };
      if (options.horizontal) horizontal = search(index.y, 'y', 'horizontal', horizontal);
      if (options.vertical) vertical = search(index.x, 'x', 'vertical', vertical);
      if (options.extensions) {
        const x = Math.floor(pointer.x / index.cell); const y = Math.floor(pointer.y / index.cell);
        const seen = new Set<Source>(); let used = 0;
        outer: for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const key = `${x + dx!}:${y + dy!}`; const bucket = index.grid.get(key) ?? [];
          if (index.saturated.has(key)) result.limited = true;
          for (const source of bucket) {
            if (used === budget) { result.limited = true; break outer; }
            used++; result.examinedCandidates++;
            if (seen.has(source)) continue; seen.add(source);
            const vx = source.b.x - source.a.x; const vy = source.b.y - source.a.y;
            const t = ((pointer.x - source.a.x) * vx + (pointer.y - source.a.y) * vy) / (vx * vx + vy * vy);
            if (t >= 0 && t <= 1) continue; // Segment snapping owns points between the endpoints.
            const point = { x: source.a.x + t * vx, y: source.a.y + t * vy };
            const match: Match = { source, point, kind: 'extension', distance: Math.hypot(pointer.x - point.x, pointer.y - point.y) };
            if (match.distance <= options.distance && better(match, extension, pointer)) extension = match;
          }
        }
      }
    }
    let matches: Match[] = [];
    if (horizontal && vertical && Math.hypot(horizontal.distance, vertical.distance) <= options.distance) {
      result.point = { x: vertical.point.x, y: horizontal.point.y }; matches = [horizontal, vertical];
    } else {
      const singles = [horizontal, vertical, extension].filter((match): match is Match => match !== null);
      singles.sort((a, b) => a.distance - b.distance); // Stable ties prefer axes to extensions.
      if (singles[0]) { result.point = { ...singles[0].point }; matches = [singles[0]]; }
    }
    if (result.point) {
      result.distance = Math.hypot(pointer.x - result.point.x, pointer.y - result.point.y);
      result.guides = matches.map(({ source, kind }) => ({ kind, featureId: source.featureId, index: source.index,
        ...(source.partIndex === undefined ? {} : { partIndex: source.partIndex }), ...(source.ringIndex === undefined ? {} : { ringIndex: source.ringIndex }),
        start: { ...source.a }, end: { ...result.point! } }));
    }
    return result;
  }
}
