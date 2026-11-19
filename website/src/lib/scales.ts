/**
 * Shared scales for the workspace charts and choropleth maps.
 *
 * Axes extend to round steps (1, 2, 2.5 or 5 × 10ⁿ) so a reader sees
 * 100 / 125 / 150 instead of 92 / 113 / 133. Maps use quantile classes
 * with rounded breaks, so a skewed distribution such as WOZ values does not
 * collapse into one pale tint.
 */

const STEPS = [1, 2, 2.5, 5, 10];
const INTEGER_STEPS = [1, 2, 5, 10];

function decimals(step: number) {
  if (!Number.isFinite(step) || step <= 0) return 0;
  let places = 0;
  while (
    places < 10 &&
    Math.abs(Math.round(step * 10 ** places) - step * 10 ** places) > 1e-9
  )
    places++;
  return places;
}

function fixed(value: number, places: number) {
  const rounded = Number(value.toFixed(places));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** The smallest round step that splits `span` into at most `count` parts. */
export function niceStep(span: number, count = 4, integer = false): number {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const raw = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const units = integer && power < 10 ? INTEGER_STEPS : STEPS;
  const unit = units.find(
    (candidate) => candidate * power >= raw * (1 - 1e-9),
  )!;
  const step = unit * power;
  return integer ? Math.max(1, Math.round(step)) : step;
}

export type Axis = { min: number; max: number; step: number; ticks: number[] };

/**
 * A round domain around the data. `zero` keeps 0 on the axis (bars, counts);
 * `integer` avoids fractional steps for counts. Non-negative data never gets a
 * negative lower bound.
 */
export function niceAxis(
  low: number,
  high: number,
  { count = 4, zero = false, integer = false } = {},
): Axis {
  let min = Math.min(low, high),
    max = Math.max(low, high);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  const nonNegative = min >= 0;
  if (zero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (min === max) {
    const padding = Math.abs(min) * 0.1 || 1;
    min -= padding;
    max += padding;
  }
  if (nonNegative) min = Math.max(0, min);
  const step = niceStep(max - min, count, integer);
  const places = decimals(step);
  const start = fixed(Math.floor(min / step + 1e-9) * step, places);
  const end = fixed(Math.ceil(max / step - 1e-9) * step, places);
  const ticks: number[] = [];
  for (let index = 0; ; index++) {
    const value = fixed(start + index * step, places);
    if (value > end + step * 1e-6) break;
    ticks.push(value);
  }
  return { min: start, max: end, step, ticks };
}

const plain = (value: number, digits: number) =>
  value.toLocaleString("nl-NL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });

/**
 * Formats every tick of one axis in the same unit: `€ 500k`, `€ 1,5 mln`,
 * `25 %`. The unit is chosen from the largest tick so labels never mix
 * `k` and `mln` on the same axis.
 */
export function tickFormatter(
  ticks: number[],
  kind: "number" | "euro" | "percent" = "number",
) {
  const largest = Math.max(0, ...ticks.map(Math.abs));
  const step =
    ticks.length > 1 ? Math.abs(ticks[1]! - ticks[0]!) : largest || 1;
  const [divisor, suffix] =
    kind === "percent"
      ? [1, " %"]
      : largest >= 1e6
        ? [1e6, " mln"]
        : largest >= 1e4
          ? [1e3, "k"]
          : [1, ""];
  const digits = decimals(step / divisor);
  const prefix = kind === "euro" ? "€ " : "";
  return (value: number) => {
    if (value === 0 && divisor > 1) return `${prefix}0`;
    const sign = value < 0 ? "-" : "";
    return `${sign}${prefix}${plain(Math.abs(value) / divisor, digits)}${suffix}`;
  };
}

/**
 * One value in a short form for legends: `€ 390k`, `€ 2,3 mln`, `1.100`,
 * `0,4`. Unlike axis ticks, legend values stand alone, so each picks its own unit.
 */
export function compactNumber(value: number, { euro = false } = {}) {
  const absolute = Math.abs(value);
  const [divisor, suffix] =
    absolute >= 1e6 ? [1e6, " mln"] : absolute >= 1e4 ? [1e3, "k"] : [1, ""];
  const scaled = absolute / divisor;
  const digits = scaled >= 10 ? 0 : scaled >= 1 ? 1 : 2;
  return `${value < 0 ? "-" : ""}${euro ? "€ " : ""}${plain(scaled, digits)}${suffix}`;
}

/** Rounds to two significant digits: 412.337 → 410.000, 2,7778 → 2,8. */
export function roundSignificant(value: number, digits = 2): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  const power = 10 ** (Math.floor(Math.log10(Math.abs(value))) - digits + 1);
  return fixed(
    Math.round(value / power) * power,
    Math.max(0, -Math.log10(power)),
  );
}

function quantile(sorted: number[], fraction: number) {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const rest = position - lower;
  return (
    sorted[lower]! +
    (sorted[lower + 1] === undefined
      ? 0
      : rest * (sorted[lower + 1]! - sorted[lower]!))
  );
}

function quantileBreaks(sorted: number[], classes: number) {
  const breaks: number[] = [];
  for (let index = 1; index < classes; index++) {
    const value = roundSignificant(quantile(sorted, index / classes));
    if (
      value > sorted[0]! &&
      value <= sorted.at(-1)! &&
      value > (breaks.at(-1) ?? -Infinity)
    )
      breaks.push(value);
  }
  return breaks;
}

export type ClassScale = {
  /** Ascending lower bounds of every class after the first. */
  breaks: number[];
  colors: string[];
  min: number;
  max: number;
  diverging: boolean;
};

/** Five teal steps from light to dark, readable on the light basemap. */
export const SEQUENTIAL = [
  "#d5ece9",
  "#9ccfc9",
  "#5fadaa",
  "#2d8483",
  "#175b5f",
];
/** Two warm steps for decreases, three teal steps for increases. */
export const DIVERGING_NEGATIVE = ["#a4533b", "#dba58f"];
export const DIVERGING_POSITIVE = ["#b5dcd7", "#58a5a1", "#1d6f73"];
export const UNKNOWN = "#aeb8b7";

/**
 * Quantile classes for a choropleth. With `diverging`, decreases and increases
 * get their own classes around 0, so a fall is never shown as a pale rise.
 * Classes with identical breaks are merged: fewer classes, never empty ones.
 */
export function classScale(
  input: Iterable<number | null | undefined>,
  { classes = 5, diverging = false } = {},
): ClassScale {
  const sorted = [...input]
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    )
    .sort((a, b) => a - b);
  if (!sorted.length)
    return {
      breaks: [],
      colors: [SEQUENTIAL[2]!],
      min: 0,
      max: 0,
      diverging: false,
    };
  const min = sorted[0]!,
    max = sorted.at(-1)!;
  if (diverging && min < 0 && max > 0) {
    const negative = sorted.filter((value) => value < 0);
    const positive = sorted.filter((value) => value >= 0);
    const low = quantileBreaks(negative, DIVERGING_NEGATIVE.length).filter(
      (value) => value < 0,
    );
    const high = quantileBreaks(positive, DIVERGING_POSITIVE.length).filter(
      (value) => value > 0,
    );
    return {
      breaks: [...low, 0, ...high],
      colors: [
        ...DIVERGING_NEGATIVE.slice(DIVERGING_NEGATIVE.length - low.length - 1),
        ...DIVERGING_POSITIVE.slice(0, high.length + 1),
      ],
      min,
      max,
      diverging: true,
    };
  }
  // Only decreases: the warm ramp, darkest for the largest fall.
  const palette = diverging && max < 0 ? DIVERGING_NEGATIVE : SEQUENTIAL;
  const breaks = quantileBreaks(sorted, Math.min(classes, palette.length));
  const count = breaks.length + 1;
  // Spread fewer classes over the whole ramp instead of using only its light end.
  const colors =
    count >= palette.length
      ? palette
      : count === 1
        ? [palette[Math.floor(palette.length / 2)]!]
        : Array.from(
            { length: count },
            (_, index) =>
              palette[
                Math.round((index * (palette.length - 1)) / (count - 1))
              ]!,
          );
  return { breaks, colors, min, max, diverging: false };
}

/** Index of the class that holds `value`; a break belongs to the class above it. */
export function classIndex(value: number, breaks: number[]) {
  let index = 0;
  while (index < breaks.length && value >= breaks[index]!) index++;
  return index;
}

export function classColor(
  value: number | null | undefined,
  scale: ClassScale,
) {
  return typeof value === "number" && Number.isFinite(value)
    ? scale.colors[classIndex(value, scale.breaks)]!
    : UNKNOWN;
}

/** Lower and upper bound of every class, for legends and screen readers. */
export function classRanges(scale: ClassScale) {
  return scale.colors.map((color, index) => ({
    color,
    from: index === 0 ? scale.min : scale.breaks[index - 1]!,
    to: index === scale.breaks.length ? scale.max : scale.breaks[index]!,
  }));
}
