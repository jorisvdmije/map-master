import type { MultiLineString, Position } from "geojson";

type Trace = { geometry: MultiLineString; kind: string; id: string };
const sx = 67900, sy = 111200; // Local metre approximation for Amsterdam, display only.
const distance = (a: Position, b: Position) => Math.hypot((a[0]! - b[0]!) * sx, (a[1]! - b[1]!) * sy);

/** Cartographic overview, never used for scoring, length, spatial assignment or exports.
 * Retain source curves, suppress nearby parallel carriageways within the SAME name,
 * then join nearby endpoints. Separate branches/components remain separate traces.
 */
export function overviewGeometry(roads: Trace[]): MultiLineString {
  const priority = (kind: string) => ["RB", "HR", "NRB", "ERF"].includes(kind) ? 0 : kind === "BUS" ? 1 : 2;
  const candidates = roads.flatMap(r => r.geometry.coordinates.map(line => ({ line, priority: priority(r.kind), id: r.id, length: line.slice(1).reduce((s, p, i) => s + distance(line[i]!, p), 0) })))
    .sort((a, b) => a.priority - b.priority || b.length - a.length || a.id.localeCompare(b.id));
  const cells = new Map<string, Position[]>(), result: Position[][] = [];
  const cell = (p: Position) => [Math.floor(p[0]! * sx / 28), Math.floor(p[1]! * sy / 28)];
  const covered = (p: Position) => {
    const [x, y] = cell(p);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (cells.get(`${x! + dx}:${y! + dy}`)?.some(q => distance(p, q) < 28)) return true;
    }
    return false;
  };
  for (const { line } of candidates) {
    if (line.length < 2) continue;
    const samples: Position[] = [line[0]!];
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!, b = line[i]!, steps = Math.max(1, Math.ceil(distance(a, b) / 9));
      for (let j = 1; j <= steps; j++) samples.push([a[0]! + (b[0]! - a[0]!) * j / steps, a[1]! + (b[1]! - a[1]!) * j / steps]);
    }
    // Compute against earlier traces, not against adjacent points on this trace.
    const mask = samples.map(covered);
    const retained: Position[] = [];
    let run: Position[] = [];
    const flush = () => { if (run.length > 1) { result.push(run); retained.push(...run); } run = []; };
    for (let i = 1; i < samples.length; i++) {
      if (!mask[i - 1] || !mask[i]) { if (!run.length) run.push(samples[i - 1]!); run.push(samples[i]!); }
      else flush();
    }
    flush();
    for (const p of retained) {
      const [x, y] = cell(p), key = `${x}:${y}`, points = cells.get(key);
      if (points) points.push(p); else cells.set(key, [p]);
    }
  }
  // Join nearby ends once, shortest joins first. Endpoint matching and union-find
  // avoid repeated global searches on large highway/unnamed networks.
  const endpoints = result.flatMap(line => [line[0]!, line.at(-1)!]);
  const endpointCells = new Map<string, number[]>(), pairs: { a: number; b: number; d: number }[] = [];
  endpoints.forEach((p, a) => {
    const [x, y] = cell(p);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
      for (const b of endpointCells.get(`${x! + dx}:${y! + dy}`) ?? []) {
        if (Math.floor(a / 2) === Math.floor(b / 2)) continue;
        const d = distance(p, endpoints[b]!); if (d < 38) pairs.push({ a, b, d });
      }
    }
    const key = `${x}:${y}`, ids = endpointCells.get(key); if (ids) ids.push(a); else endpointCells.set(key, [a]);
  });
  const parents = result.map((_, i) => i), links = new Map<number, number>();
  const root = (id: number): number => { while (parents[id] !== id) { parents[id] = parents[parents[id]!]!; id = parents[id]!; } return id; };
  for (const { a, b } of pairs.sort((a, b) => a.d - b.d)) {
    const ra = root(Math.floor(a / 2)), rb = root(Math.floor(b / 2));
    if (ra === rb || links.has(a) || links.has(b)) continue;
    parents[ra] = rb; links.set(a, b); links.set(b, a);
  }
  const coordinates: Position[][] = [], visited = new Set<number>();
  for (let start = 0; start < endpoints.length; start++) {
    if (links.has(start) || visited.has(Math.floor(start / 2))) continue;
    let end: number | undefined = start; const line: Position[] = [];
    while (end !== undefined) {
      const id = Math.floor(end / 2); if (visited.has(id)) break; visited.add(id);
      line.push(...(end % 2 ? result[id]!.slice().reverse() : result[id]!));
      end = links.get(end % 2 ? end - 1 : end + 1);
    }
    coordinates.push(line);
  }
  return { type: "MultiLineString", coordinates };
}
