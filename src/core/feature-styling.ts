import { resolveAppearance, type PointAppearance, type ShapeAppearance } from './appearance.js';
import type { FeatureId, GeometryFeature } from './types.js';

export interface FeatureStyle {
  shape?: Partial<ShapeAppearance>;
  marker?: Partial<PointAppearance>;
  /** Larger values draw above smaller values within each geometry layer. */
  sortKey?: number;
}
export type FeatureStyleResolver = (feature: GeometryFeature) => FeatureStyle | null | undefined;
export interface SelectionStyle {
  shape?: Partial<ShapeAppearance>;
  marker?: Partial<PointAppearance>;
}
export interface OverlapMember {
  feature: GeometryFeature;
  /** Resolved, unselected polygon color. */
  color: string;
}
export type OverlapPalette = readonly string[] | ((members: readonly OverlapMember[]) => readonly string[]);
export interface OverlapStyle {
  enabled?: boolean;
  /** Omit to alternate the member colors, in stable typed-ID order. */
  palette?: OverlapPalette;
  /** Perpendicular band width in CSS pixels at integer zoom, default 12. */
  stripeWidth?: number;
  opacity?: number;
  direction?: 'ascending' | 'descending';
}
export interface EditorStylingOptions {
  /** Called on data changes and refreshStyling; never on pointer movement or selection. */
  feature?: FeatureStyleResolver;
  /** Omit for the global selected theme; {} preserves all individual colors. */
  selected?: SelectionStyle;
  overlap?: OverlapStyle;
}
export interface StylingIssue {
  kind: 'feature' | 'overlap';
  featureId?: FeatureId;
  message: string;
}

function object(value: unknown, keys: readonly string[], name: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)
    || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError(`Invalid ${name}.`);
}
export function validateFeatureStyle(value: FeatureStyle): FeatureStyle {
  object(value, ['shape', 'marker', 'sortKey'], 'feature style');
  const result: FeatureStyle = {};
  if (Object.hasOwn(value, 'shape')) {
    const resolved = resolveAppearance({ feature: value.shape! });
    result.shape = Object.fromEntries(Object.keys(value.shape!).map(key => [key, resolved.feature[key as keyof ShapeAppearance]]));
  }
  if (Object.hasOwn(value, 'marker')) {
    const resolved = resolveAppearance({ marker: value.marker! });
    result.marker = Object.fromEntries(Object.keys(value.marker!).map(key => [key, resolved.marker[key as keyof PointAppearance]]));
  }
  if (Object.hasOwn(value, 'sortKey')) {
    if (typeof value.sortKey !== 'number' || !Number.isFinite(value.sortKey)) throw new RangeError('sortKey must be finite.');
    result.sortKey = value.sortKey;
  }
  return result;
}
export function validatePalette(value: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw new RangeError('An overlap palette needs 1–16 colors.');
  return Array.from(value, (color: unknown) => {
    if (typeof color !== 'string') throw new TypeError('Palette colors must be hex strings.');
    return resolveAppearance({ feature: { fillColor: color } }).feature.fillColor;
  });
}
/** Replacement configuration, isolated from the caller. Callbacks retain their identity. */
export function resolveStyling(value: EditorStylingOptions = {}): EditorStylingOptions {
  object(value, ['feature', 'selected', 'overlap'], 'styling');
  const result: EditorStylingOptions = {};
  if (Object.hasOwn(value, 'feature')) {
    if (typeof value.feature !== 'function') throw new TypeError('styling.feature must be a function.');
    result.feature = value.feature;
  }
  if (Object.hasOwn(value, 'selected')) {
    object(value.selected, ['shape', 'marker'], 'selection style');
    result.selected = validateFeatureStyle(value.selected!);
  }
  if (Object.hasOwn(value, 'overlap')) {
    const overlap = value.overlap!;
    object(overlap, ['enabled', 'palette', 'stripeWidth', 'opacity', 'direction'], 'overlap style');
    if (Object.hasOwn(overlap, 'enabled') && typeof overlap.enabled !== 'boolean') throw new TypeError('overlap.enabled must be boolean.');
    if (Object.hasOwn(overlap, 'direction') && overlap.direction !== 'ascending' && overlap.direction !== 'descending') throw new TypeError('Invalid stripe direction.');
    for (const [key, min, max] of [['stripeWidth', 2, 32], ['opacity', 0, 1]] as const) {
      if (Object.hasOwn(overlap, key) && (typeof overlap[key] !== 'number' || !Number.isFinite(overlap[key]) || overlap[key] < min || overlap[key] > max)) throw new RangeError(`overlap.${key} must be between ${min} and ${max}.`);
    }
    result.overlap = { enabled: false, stripeWidth: 12, opacity: 0.7, direction: 'ascending', ...overlap };
    if (Object.hasOwn(overlap, 'palette')) result.overlap.palette = typeof overlap.palette === 'function' ? overlap.palette : validatePalette(overlap.palette!);
  }
  return result;
}
