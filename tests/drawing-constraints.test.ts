import { expect, it } from 'vitest';
import { constrainDrawingPoint, drawingConstraintsOptions } from '../src/core/drawing-constraints.js';
import { project, unproject } from '../src/core/mercator-transform.js';
import { DrawingSession } from '../src/core/drawing-session.js';
import type { Coordinate, DrawingConstraintsOptions } from '../src/index.js';

it('defaults off and validates updates without mutating caller options', () => {
  expect(drawingConstraintsOptions()).toEqual({ enabled: false, angleStep: 45 });
  const previous: DrawingConstraintsOptions = { enabled: true, angleStep: 45 };
  const next = drawingConstraintsOptions({ angleStep: 90 }, previous); next.enabled = false;
  expect(previous).toEqual({ enabled: true, angleStep: 45 });
});
it.each([0, 30, 360, NaN, Infinity, '45', null, undefined])('rejects unsupported step %s', (angleStep) => {
  expect(() => drawingConstraintsOptions({ angleStep } as Partial<DrawingConstraintsOptions>)).toThrow(TypeError);
});
it.each([1, 'true', null, undefined])('rejects nonboolean enablement %s', (enabled) => {
  expect(() => drawingConstraintsOptions({ enabled } as unknown as Partial<DrawingConstraintsOptions>)).toThrow(TypeError);
});
it.each([45, 90] as const)('quantizes every quadrant at %s degrees while preserving projected length', (step) => {
  const anchor: Coordinate = [4, 52]; const [ax, ay] = project(anchor);
  for (let degrees = -179; degrees < 180; degrees += 7) {
    const theta = degrees * Math.PI / 180;
    const pointer = unproject([ax + 0.01 * Math.cos(theta), ay + 0.01 * Math.sin(theta)]);
    const result = constrainDrawingPoint(anchor, pointer, step)!;
    const [x, y] = project(result);
    expect(Math.hypot(x - ax, y - ay)).toBeCloseTo(0.01, 12);
    const angle = Math.atan2(y - ay, x - ax) * 180 / Math.PI;
    expect(angle / step).toBeCloseTo(Math.round(angle / step), 9);
  }
  expect(anchor).toEqual([4, 52]);
});
it('preserves horizontal/vertical anchor coordinates exactly, and copies coincident points', () => {
  expect(constrainDrawingPoint([4, 52], [5, 52.1], 90)![1]).toBe(52);
  expect(constrainDrawingPoint([4, 52], [4.01, 53], 90)![0]).toBe(4);
  const anchor: Coordinate = [4, 52]; const result = constrainDrawingPoint(anchor, anchor, 45);
  expect(result).toEqual(anchor); expect(result).not.toBe(anchor);
});
it('resolves exact diagonal ties counterclockwise for 90-degree constraints', () => {
  for (const [pointer, expected] of [
    [[1, 1], [0, 1]], [[-1, 1], [-1, 0]], [[-1, -1], [0, -1]], [[1, -1], [1, 0]],
  ] as [Coordinate, Coordinate][]) {
    const result = constrainDrawingPoint([0, 0], unproject(pointer), 90)!;
    const actual = project(result); const length = Math.hypot(...actual);
    expect(actual[0] / length).toBeCloseTo(expected[0], 12);
    expect(actual[1] / length).toBeCloseTo(expected[1], 12);
  }
});
it('rejects polar, dateline, nonfinite and out-of-world results without mutation', () => {
  for (const [a, b] of [
    [[0, 86], [1, 85]], [[0, 0], [1, 86]], [[179, 0], [-179, 1]], [[0, 0], [NaN, 0]],
    [[181, 0], [179, 0]], [[179, 0], [180, 0.8]],
  ] as [Coordinate, Coordinate][]) expect(constrainDrawingPoint(a, b, 90)).toBeNull();
});
it('keeps the constant-time anchor snapshot isolated and follows Backspace/cancel', () => {
  const session = new DrawingSession(() => 'line'); session.start('LineString');
  expect(session.getLastDrawPoint()).toBeNull(); session.add([4, 52]); session.add([5, 52]);
  session.getLastDrawPoint()![0] = 80; expect(session.getLastDrawPoint()).toEqual([5, 52]);
  session.removeLastDrawStep(); expect(session.getLastDrawPoint()).toEqual([4, 52]);
  session.cancel(); expect(session.getLastDrawPoint()).toBeNull();
});
