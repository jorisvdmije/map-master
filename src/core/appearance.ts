/** Colors are literal #RGB or #RRGGBB hex values; sizes use CSS pixels. */
export interface ShapeAppearance {
  lineColor: string;
  lineWidth: number;
  lineOpacity: number;
  fillColor: string;
  fillOpacity: number;
}

export interface DraftAppearance extends ShapeAppearance {
  /** Second polygon in split and shared-boundary previews. */
  secondaryFillColor: string;
}

export interface PointAppearance {
  color: string;
  radius: number;
  opacity: number;
  strokeColor: string;
  strokeWidth: number;
}

export interface VertexAppearance extends PointAppearance {
  activeColor: string;
  activeRadius: number;
  lockedColor: string;
}

export interface SnapAppearance extends PointAppearance {
  edgeRadius: number;
}

/** Presentation only: no geometry, properties, selection or history. */
export interface EditorAppearance {
  feature: ShapeAppearance;
  selected: ShapeAppearance;
  draft: DraftAppearance;
  vertex: VertexAppearance;
  midpoint: PointAppearance;
  snap: SnapAppearance;
  pivot: PointAppearance;
}

/** Patch individual fields; omitted groups and fields keep their previous values. */
export type EditorAppearanceOptions = { [Key in keyof EditorAppearance]?: Partial<EditorAppearance[Key]> };

const defaults: EditorAppearance = {
  feature: { lineColor: '#116b5b', lineWidth: 4, lineOpacity: 1, fillColor: '#116b5b', fillOpacity: 0.18 },
  selected: { lineColor: '#2563eb', lineWidth: 6, lineOpacity: 1, fillColor: '#2563eb', fillOpacity: 0.3 },
  draft: { lineColor: '#df772e', lineWidth: 3, lineOpacity: 1, fillColor: '#df772e', fillOpacity: 0.22, secondaryFillColor: '#7c3aed' },
  vertex: { color: '#fff', radius: 5, opacity: 1, strokeColor: '#df772e', strokeWidth: 2, activeColor: '#df772e', activeRadius: 7, lockedColor: '#64748b' },
  midpoint: { color: '#fff', radius: 4, opacity: 1, strokeColor: '#df772e', strokeWidth: 1 },
  snap: { color: '#7c3aed', radius: 8, edgeRadius: 6, opacity: 0.85, strokeColor: '#fff', strokeWidth: 3 },
  pivot: { color: '#fff', radius: 6, opacity: 1, strokeColor: '#1e293b', strokeWidth: 3 },
};

export function copyAppearance(value: EditorAppearance): EditorAppearance {
  return { feature: { ...value.feature }, selected: { ...value.selected }, draft: { ...value.draft },
    vertex: { ...value.vertex }, midpoint: { ...value.midpoint }, snap: { ...value.snap }, pivot: { ...value.pivot } };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Validate the entire patch before the renderer or any current settings change. */
export function resolveAppearance(patch: EditorAppearanceOptions = {}, current: EditorAppearance = defaults): EditorAppearance {
  if (!record(patch)) throw new TypeError('appearance must be a plain object.');
  const next = copyAppearance(current);
  for (const [group, fields] of Object.entries(patch)) {
    if (!Object.hasOwn(defaults, group) || !record(fields)) throw new TypeError(`Unknown or invalid appearance group: ${group}.`);
    const target = next[group as keyof EditorAppearance] as unknown as Record<string, string | number>;
    for (const [key, value] of Object.entries(fields)) {
      const path = `appearance.${group}.${key}`;
      if (!Object.hasOwn(target, key)) throw new TypeError(`Unknown appearance field: ${path}.`);
      if (typeof target[key] === 'string') {
        if (typeof value !== 'string' || !/^#(?:[a-f\d]{3}|[a-f\d]{6})$/iu.test(value)) {
          throw new TypeError(`${path} must be a #RGB or #RRGGBB hex color.`);
        }
        target[key] = value.toLowerCase();
      } else {
        const maximum = key.toLowerCase().endsWith('opacity') ? 1 : key === 'strokeWidth' ? 16 : 32;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
          throw new RangeError(`${path} must be a finite number between 0 and ${maximum}.`);
        }
        target[key] = value;
      }
    }
  }
  return next;
}
