import type { GeometryFeature, PointFeature, FeatureProperties } from './types.js';

/** Persisted label appearance. Colors are literal hex values; sizes are CSS pixels. */
export type TextMarkerStyle = {
  color: string;
  backgroundColor: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  textAlign: 'left' | 'center' | 'right';
};
/** Stored in `properties.mapMasterText`. Text is plain text, up to 2,000 UTF-16 units. */
export type TextMarkerOptions = { text: string; style?: Partial<TextMarkerStyle> };
export type TextMarkerFeature = PointFeature & {
  properties: Exclude<FeatureProperties, null> & { mapMasterText: TextMarkerOptions };
};

export const defaultTextMarkerStyle: Readonly<TextMarkerStyle> = Object.freeze({
  color: '#172b3a', backgroundColor: '#ffffff', fontSize: 16, fontWeight: 'normal', textAlign: 'center',
});

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Validate before touching draft state. Empty text is allowed only in an uncommitted draft. */
export function textMarkerOptions(value: unknown, allowEmpty = false): TextMarkerOptions {
  if (!record(value) || Object.keys(value).some(key => key !== 'text' && key !== 'style')) throw new TypeError('Expected text and optional style.');
  if (typeof value.text !== 'string' || value.text.length > 2000 || !allowEmpty && !value.text.trim()) {
    throw new TypeError('Text must contain 1–2,000 characters, including at least one non-whitespace character.');
  }
  const result: TextMarkerOptions = { text: value.text };
  if (Object.hasOwn(value, 'style')) {
    if (!record(value.style)) throw new TypeError('Text style must be a plain object.');
    const style: Partial<TextMarkerStyle> = {};
    for (const [key, field] of Object.entries(value.style)) {
      if (key === 'color' || key === 'backgroundColor') {
        if (typeof field !== 'string' || !/^#(?:[a-f\d]{3}|[a-f\d]{6})$/iu.test(field)) throw new TypeError(`Text style ${key} must be a #RGB or #RRGGBB hex color.`);
        style[key] = field;
      } else if (key === 'fontSize') {
        if (typeof field !== 'number' || !Number.isFinite(field) || field < 8 || field > 96) throw new TypeError('Text fontSize must be between 8 and 96 CSS pixels.');
        style.fontSize = field;
      } else if (key === 'fontWeight') {
        if (field !== 'normal' && field !== 'bold') throw new TypeError('Text fontWeight must be normal or bold.');
        style.fontWeight = field;
      } else if (key === 'textAlign') {
        if (field !== 'left' && field !== 'center' && field !== 'right') throw new TypeError('Text textAlign must be left, center or right.');
        style.textAlign = field;
      } else throw new TypeError(`Unknown text style: ${key}.`);
    }
    result.style = style;
  }
  return result;
}

/** Identify a Point with valid label metadata. Other geometries retain metadata without displaying it. */
export function isTextMarker(feature: GeometryFeature): feature is TextMarkerFeature {
  if (feature.geometry.type !== 'Point' || feature.properties === null || !Object.hasOwn(feature.properties, 'mapMasterText')) return false;
  try { textMarkerOptions(feature.properties.mapMasterText); return true; }
  catch { return false; }
}
