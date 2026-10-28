import { describe, expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import { closePolygon, validatePolygon } from '../src/core/polygon.js';
import type { Coordinate, DrawGeometryType, ValidationError } from '../src/core/types.js';

describe('simple polygon validation', () => {
  it.each<{ name: string; points: Coordinate[]; error: ValidationError }>([
    { name: 'too few distinct vertices', points: [[0, 0], [2, 0], [0, 0]], error: 'too-few-vertices' },
    { name: 'collinear ring', points: [[0, 0], [1, 1], [2, 2]], error: 'zero-area' },
    { name: 'bow tie', points: [[0, 0], [3, 3], [0, 3], [3, 0]], error: 'self-intersection' },
    { name: 'crossing closing edge', points: [[0, 0], [4, 0], [0, 4], [4, 4]], error: 'self-intersection' },
    { name: 'nonadjacent touch', points: [[0, 0], [4, 0], [4, 4], [2, 0], [0, 4]], error: 'self-intersection' },
    { name: 'adjacent overlap', points: [[0, 0], [4, 0], [2, 0], [2, 4]], error: 'self-intersection' },
    { name: 'duplicate interior vertex', points: [[0, 0], [4, 0], [4, 4], [4, 0], [0, 4]], error: 'duplicate-vertex' },
    { name: 'antimeridian edge', points: [[179, 0], [-179, 0], [179, 2]], error: 'antimeridian-crossing' },
    { name: 'antimeridian closing edge', points: [[-170, 0], [0, 1], [170, 0]], error: 'antimeridian-crossing' },
  ])('rejects $name', ({ points, error }) => {
    expect(validatePolygon(points)).toBe(error);
  });

  it.each<{ name: string; points: Coordinate[] }>([
    { name: 'triangle', points: [[0, 0], [4, 0], [0, 4]] },
    { name: 'concave polygon', points: [[0, 0], [4, 0], [2, 2], [4, 4], [0, 4]] },
    { name: 'collinear boundary vertices', points: [[0, 0], [2, 0], [4, 0], [4, 4], [0, 4]] },
    { name: 'explicitly closed ring', points: [[0, 0], [4, 0], [0, 4], [0, 0]] },
  ])('accepts $name and exports a closed CCW exterior for either input winding', ({ points }) => {
    for (const input of [points, [...points].reverse()]) {
      expect(validatePolygon(input)).toBeNull();
      const output = closePolygon(input);
      expect(output[0]).toEqual(input[0]);
      expect(output.at(-1)).toEqual(output[0]);
      expect(output.at(-1)).not.toBe(output[0]);
      const twiceArea = output.slice(1).reduce((sum, current, index) => {
        const previous = output[index]!;
        return sum + previous[0] * current[1] - current[0] * previous[1];
      }, 0);
      expect(twiceArea).toBeGreaterThan(0);
    }
  });

  it('preserves tiny valid polygons without imposing an arbitrary area epsilon', () => {
    const points: Coordinate[] = [[4, 52], [4, 52 + 1e-12], [4 + 1e-12, 52]];
    expect(validatePolygon(points)).toBeNull();
    expect(closePolygon(points)).toEqual([points[0], points[2], points[1], points[0]]);
  });
});

describe('mixed drawing session', () => {
  it('keeps invalid drafts uncommitted, allows recovery, and consumes IDs only on commit', () => {
    let id = 0;
    const session = new DrawingSession(() => String(++id));
    session.start('Polygon');
    session.add([0, 0]); session.add([2, 0]); session.add([4, 0]);
    expect(session.state).toMatchObject({ canFinish: false, validationError: 'zero-area' });
    expect(session.finish()).toBeNull();
    expect(session.exportGeoJSON().features).toHaveLength(0);
    session.add([4, 4]);
    expect(session.finish()?.id).toBe('1');
    session.start('LineString'); session.add([0, 0]); session.add([1, 1]);
    expect(session.finish()?.id).toBe('2');
    expect(session.exportGeoJSON().features.map((feature) => feature.geometry.type)).toEqual(['Polygon', 'LineString']);
    session.start('Polygon'); session.add([2, 2]); session.cancel();
    expect(session.state).toMatchObject({ mode: 'idle', featureCount: 2, validationError: null });
  });

  it('protects the active draft when switching tools or receiving invalid input', () => {
    const session = new DrawingSession(() => 'id');
    session.start('Polygon'); session.add([0, 0]);
    expect(session.start('Polygon')).toBe(false);
    expect(() => session.start('LineString')).toThrow('Finish or cancel');
    expect(() => session.start('Circle' as DrawGeometryType)).toThrow(TypeError);
    expect(() => session.add([NaN, 0])).toThrow(RangeError);
    expect(session.getDraft()).toEqual([[0, 0]]);
    expect(session.state.mode).toBe('draw-polygon');
  });

  it('isolates nested polygon coordinates in inputs, results, and exports', () => {
    const session = new DrawingSession(() => 'id');
    const point: Coordinate = [0, 0];
    session.start('Polygon'); session.add(point); point[0] = 99;
    session.add([4, 0]); session.add([0, 4]);
    const result = session.finish();
    if (result?.geometry.type !== 'Polygon') throw new Error('Expected a polygon');
    result.geometry.coordinates[0]![0]![0] = 99;
    const exported = session.exportGeoJSON();
    const polygon = exported.features[0];
    if (polygon?.geometry.type !== 'Polygon') throw new Error('Expected a polygon');
    polygon.geometry.coordinates[0]!.length = 0;
    expect(session.exportGeoJSON().features[0]?.geometry.coordinates).toEqual([
      [[0, 0], [4, 0], [0, 4], [0, 0]],
    ]);
  });
});
