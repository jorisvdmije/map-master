import { geometryParts, type Geometry } from './geometry.js';
import { openRing } from './polygon.js';
import type { Coordinate, MeasurementOptions, MeasurementUnits } from './types.js';

/** Mean Earth radius in meters (IUGG); every measurement uses this sphere. */
const earthRadius = 6_371_008.8;
const radians = Math.PI / 180;

/** Geodesic size of a geometry on a spherical Earth. */
export interface Measurement {
  /** Length of lines in meters; 0 for markers and polygons. */
  length: number;
  /** Area of polygons in square meters, holes excluded; 0 for markers and lines. */
  area: number;
  /** Length of every polygon ring, holes included, in meters; 0 for markers and lines. */
  perimeter: number;
}

/** Great-circle distance between two positions in meters. */
export function distance([lng1, lat1]: Coordinate, [lng2, lat2]: Coordinate): number {
  const dLat = (lat2 - lat1) * radians;
  const dLng = (lng2 - lng1) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total great-circle length of a path in meters. */
export function pathLength(points: readonly Coordinate[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index++) total += distance(points[index - 1]!, points[index]!);
  return total;
}

/** Unsigned spherical area of a ring in square meters; a closing copy is optional. */
export function ringArea(points: readonly Coordinate[]): number {
  const ring = openRing(points);
  const count = ring.length;
  if (count < 3) return 0;
  // Chamberlain & Duquette, "Some algorithms for polygons on a sphere" (JPL, 2007).
  let total = 0;
  for (let index = 0; index < count; index++) {
    const previous = ring[index]!;
    const current = ring[(index + 1) % count]!;
    const next = ring[(index + 2) % count]!;
    total += (next[0] - previous[0]) * radians * Math.sin(current[1] * radians);
  }
  return Math.abs(total * earthRadius * earthRadius / 2);
}

/** The ring length including its closing edge, in meters. */
export function ringPerimeter(points: readonly Coordinate[]): number {
  const ring = openRing(points);
  return ring.length < 2 ? 0 : pathLength([...ring, ring[0]!]);
}

/**
 * Measure a geometry on a spherical Earth: line length, polygon area and polygon perimeter.
 * Use it for the features returned by the editor, for example in an `onDataChange` listener.
 */
export function measure(geometry: Geometry): Measurement {
  const result: Measurement = { length: 0, area: 0, perimeter: 0 };
  for (const part of geometryParts(geometry)) {
    if (part.type === 'LineString') result.length += pathLength(part.coordinates);
    if (part.type !== 'Polygon') continue;
    part.coordinates.forEach((ring, index) => {
      const area = ringArea(ring);
      result.area += index === 0 ? area : -area;
      result.perimeter += ringPerimeter(ring);
    });
  }
  result.area = Math.max(0, result.area);
  return result;
}

const number = (value: number, locale: string, digits: number): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
const digits = (value: number): number => value < 10 ? 2 : value < 100 ? 1 : 0;

/** Format a distance in meters as m/km or ft/mi, for example `"1.25 km"`. */
export function formatDistance(meters: number, units: MeasurementUnits = 'metric', locale = 'en'): string {
  if (units === 'imperial') {
    const feet = meters / 0.3048;
    if (feet < 5280) return `${number(feet, locale, 0)} ft`;
    const miles = feet / 5280;
    return `${number(miles, locale, digits(miles))} mi`;
  }
  if (meters < 1000) return `${number(meters, locale, meters < 10 ? 1 : 0)} m`;
  const kilometers = meters / 1000;
  return `${number(kilometers, locale, digits(kilometers))} km`;
}

/** Format an area in square meters as m²/ha/km² or ft²/ac/mi², for example `"2.4 ha"`. */
export function formatArea(squareMeters: number, units: MeasurementUnits = 'metric', locale = 'en'): string {
  if (units === 'imperial') {
    const squareFeet = squareMeters / 0.09290304;
    if (squareFeet < 43_560) return `${number(squareFeet, locale, 0)} ft²`;
    const acres = squareFeet / 43_560;
    if (acres < 640) return `${number(acres, locale, digits(acres))} ac`;
    const squareMiles = acres / 640;
    return `${number(squareMiles, locale, digits(squareMiles))} mi²`;
  }
  if (squareMeters < 10_000) return `${number(squareMeters, locale, 0)} m²`;
  if (squareMeters < 1_000_000) {
    const hectares = squareMeters / 10_000;
    return `${number(hectares, locale, digits(hectares))} ha`;
  }
  const squareKilometers = squareMeters / 1_000_000;
  return `${number(squareKilometers, locale, digits(squareKilometers))} km²`;
}

/** Validate and merge measurement options. */
export function measurementOptions(update: Partial<MeasurementOptions> = {}, previous: MeasurementOptions = { enabled: false, units: 'metric', locale: 'en' }): MeasurementOptions {
  if (typeof update !== 'object' || update === null) throw new TypeError('Expected measurement options.');
  const next = { ...previous, ...update };
  if (typeof next.enabled !== 'boolean') throw new TypeError('measurements.enabled must be a boolean.');
  if (next.units !== 'metric' && next.units !== 'imperial') throw new TypeError("measurements.units must be 'metric' or 'imperial'.");
  if (typeof next.locale !== 'string' || !next.locale) throw new TypeError('measurements.locale must be a locale string.');
  if (next.lineStyle !== undefined && next.lineStyle !== 'badge' && next.lineStyle !== 'along-line') throw new TypeError("measurements.lineStyle must be 'badge' or 'along-line'.");
  // Throws a RangeError for malformed language tags.
  new Intl.NumberFormat(next.locale);
  return { enabled: next.enabled, units: next.units, locale: next.locale, ...(next.lineStyle === undefined ? {} : { lineStyle: next.lineStyle }) };
}

/** A half-length anchor and local tangent for a readable label on a line. */
export function lineMeasurementAnchor(points: readonly Coordinate[]): { coordinate: Coordinate; direction: [Coordinate, Coordinate] } | null {
  let remaining = pathLength(points) / 2;
  if (remaining <= 0) return null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, length = distance(a, b);
    if (length >= remaining && length > 0) {
      const t = remaining / length;
      let delta = b[0] - a[0];
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      let lng = a[0] + delta * t;
      if (lng > 180) lng -= 360;
      if (lng < -180) lng += 360;
      return { coordinate: [lng, a[1] + (b[1] - a[1]) * t], direction: [[...a], [...b]] };
    }
    remaining -= length;
  }
  return null;
}
