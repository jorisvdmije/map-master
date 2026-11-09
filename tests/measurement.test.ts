import { describe, expect, it } from 'vitest';
import { distance, formatArea, formatDistance, lineMeasurementAnchor, measure, measurementOptions, pathLength, ringArea, ringPerimeter } from '../src/core/measurement.js';
import type { Coordinate } from '../src/index.js';

// One degree of latitude on the 6,371,008.8 m sphere.
const degree = 6_371_008.8 * Math.PI / 180;

describe('geodesic measurement', () => {
  it('measures great-circle distances and path lengths', () => {
    expect(distance([0, 0], [0, 1])).toBeCloseTo(degree, 3);
    expect(distance([0, 60], [1, 60])).toBeCloseTo(degree / 2, -1);
    expect(distance([179.5, 0], [-179.5, 0])).toBeCloseTo(degree, 3);
    expect(pathLength([[0, 0], [0, 1], [0, 3]])).toBeCloseTo(3 * degree, 3);
    expect(pathLength([[0, 0]])).toBe(0);
  });

  it('measures ring areas independent of orientation and closing copies', () => {
    const square: Coordinate[] = [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]];
    const expected = (0.01 * degree) ** 2;
    expect(ringArea(square)).toBeCloseTo(expected, -2);
    expect(ringArea([...square].reverse())).toBeCloseTo(ringArea(square), 6);
    expect(ringArea([...square, square[0]!])).toBeCloseTo(ringArea(square), 6);
    expect(ringArea(square.slice(0, 2))).toBe(0);
    expect(ringPerimeter(square)).toBeCloseTo(4 * 0.01 * degree, 0);
  });

  it('subtracts holes, adds parts and measures lines and markers', () => {
    const outer: Coordinate[] = [[0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02], [0, 0]];
    const hole: Coordinate[] = [[0.005, 0.005], [0.005, 0.015], [0.015, 0.015], [0.015, 0.005], [0.005, 0.005]];
    const polygon = measure({ type: 'Polygon', coordinates: [outer, hole] });
    expect(polygon.area).toBeCloseTo(ringArea(outer) - ringArea(hole), 3);
    expect(polygon.perimeter).toBeCloseTo(ringPerimeter(outer) + ringPerimeter(hole), 3);
    expect(polygon.length).toBe(0);
    const multi = measure({ type: 'MultiPolygon', coordinates: [[outer], [outer.map(([x, y]) => [x + 1, y] as Coordinate)]] });
    expect(multi.area).toBeCloseTo(2 * ringArea(outer), 0);
    expect(measure({ type: 'MultiLineString', coordinates: [[[0, 0], [0, 1]], [[1, 0], [1, 2]]] }).length).toBeCloseTo(3 * degree, 2);
    expect(measure({ type: 'Point', coordinates: [4, 52] })).toEqual({ length: 0, area: 0, perimeter: 0 });
  });
});

describe('formatting', () => {
  it('chooses metric units and precision', () => {
    expect(formatDistance(4.26)).toBe('4.3 m');
    expect(formatDistance(812.4)).toBe('812 m');
    expect(formatDistance(1234)).toBe('1.23 km');
    expect(formatDistance(56_780)).toBe('56.8 km');
    expect(formatArea(512.3)).toBe('512 m²');
    expect(formatArea(24_500)).toBe('2.45 ha');
    expect(formatArea(3_200_000)).toBe('3.2 km²');
  });

  it('chooses imperial units and formats numbers for a locale', () => {
    expect(formatDistance(100, 'imperial')).toBe('328 ft');
    expect(formatDistance(3218.7, 'imperial')).toBe('2 mi');
    expect(formatArea(400, 'imperial')).toBe('4,306 ft²');
    expect(formatArea(40_468.6, 'imperial')).toBe('10 ac');
    expect(formatArea(5_179_976, 'imperial')).toBe('2 mi²');
    expect(formatDistance(1500, 'metric', 'nl')).toBe('1,5 km');
    expect(formatArea(12_345, 'metric', 'de')).toBe('1,23 ha');
  });

  it('validates and merges options', () => {
    expect(measurementOptions({ lineStyle: 'along-line' }).lineStyle).toBe('along-line');
    expect(() => measurementOptions({ lineStyle: 'unknown' as never })).toThrow(TypeError);
    expect(measurementOptions()).toEqual({ enabled: false, units: 'metric', locale: 'en' });
    const enabled = measurementOptions({ enabled: true });
    expect(measurementOptions({ units: 'imperial' }, enabled)).toEqual({ enabled: true, units: 'imperial', locale: 'en' });
    expect(() => measurementOptions({ enabled: 'yes' as never })).toThrow(TypeError);
    expect(() => measurementOptions({ units: 'nautical' as never })).toThrow(TypeError);
    expect(() => measurementOptions({ locale: '' })).toThrow(TypeError);
    expect(() => measurementOptions({ locale: 'not a locale!' })).toThrow(RangeError);
    expect(() => measurementOptions(null as never)).toThrow(TypeError);
  });
  it('anchors a curved path by distance, with a local tangent and no zero-length result', () => {
    expect(lineMeasurementAnchor([[0, 0], [3, 0], [3, 1]])).toMatchObject({ coordinate: [2, 0], direction: [[0, 0], [3, 0]] });
    expect(lineMeasurementAnchor([[0, 0], [0, 0]])).toBeNull();
    expect(Math.abs(lineMeasurementAnchor([[179.5, 0], [-179.5, 0]])!.coordinate[0])).toBe(180);
  });
});
