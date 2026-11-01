import { describe, expect, it } from 'vitest';
import { DrawingSession } from '../src/core/drawing-session.js';
import { distance, ringArea } from '../src/core/measurement.js';
import { circleRing, circleSteps, destination, ellipseRing, freehandRing, rectangleRing, simplifyPath } from '../src/core/shapes.js';
import { validatePolygon } from '../src/core/polygon.js';
import type { Coordinate } from '../src/index.js';

describe('shape geometry', () => {
  it('spans a north/east-aligned rectangle between opposite corners', () => {
    expect(rectangleRing([4, 52], [5, 53])).toEqual([[4, 52], [5, 52], [5, 53], [4, 53]]);
    expect(rectangleRing([5, 53], [4, 52])).toEqual([[5, 53], [4, 53], [4, 52], [5, 52]]);
    expect(rectangleRing([4, 52], [4, 53])).toBeNull();
    expect(rectangleRing([4, 52], [5, 52])).toBeNull();
  });

  it('computes geodesic destinations and circles with a constant radius', () => {
    const north = destination([4.9, 52.37], 1000, 0);
    expect(north[0]).toBeCloseTo(4.9, 9);
    expect(distance([4.9, 52.37], north)).toBeCloseTo(1000, 6);
    expect(destination([179.999, 0], 1000, 90)[0]).toBeLessThan(-179.99);
    const center: Coordinate = [4.9, 52.37];
    const ring = circleRing(center, destination(center, 250, 30))!;
    expect(ring).toHaveLength(circleSteps);
    for (const point of ring) expect(distance(center, point)).toBeCloseTo(250, 3);
    expect(validatePolygon(ring)).toBeNull();
    expect(ringArea(ring)).toBeCloseTo(Math.PI * 250 ** 2, -3);
    expect(circleRing(center, center)).toBeNull();
    expect(circleRing([179.99, 0], [179.99, 0.1])).toBeNull();
    expect(circleRing([0, 89.95], [0, 89.99])).toBeNull();
  });

  it('computes ellipses from the east–west and north–south radii', () => {
    const center: Coordinate = [4.9, 52.37];
    const corner: Coordinate = [destination(center, 300, 90)[0], destination(center, 100, 0)[1]];
    const ring = ellipseRing(center, corner)!;
    expect(ring).toHaveLength(circleSteps);
    expect(distance(center, ring[0]!)).toBeCloseTo(100, 3);
    expect(distance(center, ring[circleSteps / 4]!)).toBeCloseTo(300, 3);
    expect(validatePolygon(ring)).toBeNull();
    expect(ringArea(ring)).toBeCloseTo(Math.PI * 300 * 100, -3);
    expect(ellipseRing(center, [center[0], corner[1]])).toBeNull();
    expect(ellipseRing(center, [corner[0], center[1]])).toBeNull();
    expect(ellipseRing([179.99, 0], [-179.9, 0.1])).toBeNull();
  });

  it('simplifies screen paths and keeps both ends', () => {
    expect(simplifyPath([[0, 0], [1, 0.2], [2, -0.1], [3, 0]], 1)).toEqual([[0, 0], [3, 0]]);
    expect(simplifyPath([[0, 0], [5, 5], [10, 0]], 1)).toEqual([[0, 0], [5, 5], [10, 0]]);
    expect(simplifyPath([[0, 0], [1, 1]], 1)).toEqual([[0, 0], [1, 1]]);
    expect(simplifyPath([[0, 0], [3, 3], [0, 0]], 1)).toEqual([[0, 0], [3, 3], [0, 0]]);
  });

  it('turns freehand outlines into one valid ring', () => {
    const square: Coordinate[] = [[0, 0], [1, 0], [1, 1], [0, 1], [0.0001, 0.0001]];
    const ring = freehandRing(square)!;
    expect(validatePolygon(ring)).toBeNull();
    // A figure eight keeps its larger loop.
    const eight = freehandRing([[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]].map(([x, y]) => [x!, y!] as Coordinate).concat([[-0.5, 1]]))!;
    expect(validatePolygon(eight)).toBeNull();
    expect(freehandRing([[0, 0], [1, 1], [2, 2]])).toBeNull();
    expect(freehandRing([[0, 0], [1, 1]])).toBeNull();
  });
});

describe('drawing shapes in a session', () => {
  const session = (): DrawingSession => { let id = 0; return new DrawingSession(() => `shape-${++id}`); };

  it('draws a rectangle from two clicks and supports removing the anchor', () => {
    const s = session();
    expect(s.start('Rectangle')).toBe(true);
    expect(s.state).toMatchObject({ mode: 'draw-rectangle', canFinish: false });
    expect(s.start('Rectangle')).toBe(false);
    expect(() => s.start('Circle')).toThrow('Finish or cancel');
    expect(s.add([4, 52])).toBe(true);
    expect(s.getShapePreview([4.01, 52.01])).toEqual([[4, 52], [4.01, 52], [4.01, 52.01], [4, 52.01]]);
    expect(s.removeLastDrawStep()).toBe(true);
    expect(s.state.vertexCount).toBe(0);
    expect(s.getShapePreview([4.01, 52.01])).toBeNull();
    s.add([4, 52]);
    expect(s.add([4, 52.5])).toBe(false);
    expect(s.state.vertexCount).toBe(1);
    expect(s.add([4.01, 52.01])).toBe(true);
    expect(s.state).toMatchObject({ vertexCount: 4, canFinish: true });
    const feature = s.finish()!;
    expect(feature).toMatchObject({ id: 'shape-1', geometry: { type: 'Polygon' } });
    expect(feature.geometry.coordinates[0]).toHaveLength(5);
    expect(s.state.mode).toBe('idle');
  });

  it('draws a circle polygon from its center and a point on its edge', () => {
    const s = session();
    s.start('Circle');
    expect(s.state.mode).toBe('draw-circle');
    s.add([4.9, 52.37]);
    expect(s.add(destination([4.9, 52.37], 100, 90))).toBe(true);
    const feature = s.finish()!;
    expect(feature.geometry.type).toBe('Polygon');
    expect((feature.geometry.coordinates as Coordinate[][])[0]).toHaveLength(circleSteps + 1);
  });

  it('draws an ellipse from its center and a corner of its bounding box', () => {
    const s = session();
    s.start('Ellipse');
    expect(s.state.mode).toBe('draw-ellipse');
    s.add([4.9, 52.37]);
    expect(s.add([4.9, 52.371])).toBe(false);
    expect(s.add([4.903, 52.371])).toBe(true);
    expect(s.finish()?.geometry.type).toBe('Polygon');
  });

  it('accepts a freehand outline only in freehand mode, never single clicks', () => {
    const s = session();
    expect(s.setFreehandPath([[0, 0], [1, 0], [1, 1]])).toBe(false);
    s.start('Freehand');
    expect(s.state.mode).toBe('draw-freehand');
    expect(s.add([0, 0])).toBe(false);
    expect(s.setFreehandPath([[0, 0], [1, 1]])).toBe(false);
    expect(s.state.canFinish).toBe(false);
    expect(() => s.setFreehandPath([[0, 0], [200, 0]] as Coordinate[])).toThrow(RangeError);
    expect(() => s.setFreehandPath('path' as never)).toThrow(TypeError);
    expect(s.setFreehandPath([[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]])).toBe(true);
    expect(s.finish()?.geometry.type).toBe('Polygon');
    s.start('Freehand'); s.cancel();
    expect(s.state.mode).toBe('idle');
  });
});
