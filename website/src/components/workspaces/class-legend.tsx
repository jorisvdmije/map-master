import type { CSSProperties } from "react";
import { classRanges, UNKNOWN, type ClassScale } from "@/lib/scales";

/**
 * A stepped legend for a classed map: one block per class with the class
 * boundaries underneath. Screen readers get the same classes as a list.
 */
export function ClassLegend({
  title,
  scale,
  format,
  unknown = "Onbekend",
  className,
}: {
  title?: string;
  scale: ClassScale;
  format: (value: number) => string;
  /** Label for the grey "no value" swatch; `false` hides it. */
  unknown?: string | false;
  className?: string;
}) {
  const ranges = classRanges(scale);
  const bounds = [scale.min, ...scale.breaks, scale.max];
  return (
    <div
      className={["mm-class-legend", className].filter(Boolean).join(" ")}
      data-diverging={scale.diverging || undefined}
      style={{ "--mm-classes": ranges.length } as CSSProperties}
    >
      {title && <strong>{title}</strong>}
      <div className="mm-class-legend-scale" aria-hidden="true">
        <span className="mm-class-legend-bar">
          {ranges.map((range) => (
            <i key={range.from} style={{ background: range.color }} />
          ))}
        </span>
        <span className="mm-class-legend-bounds">
          {bounds.map((value, index) => (
            <span
              key={`${index}-${value}`}
              style={{ left: `${(index / ranges.length) * 100}%` }}
            >
              {format(value)}
            </span>
          ))}
        </span>
      </div>
      <ul className="sr-only">
        {ranges.map((range, index) => (
          <li key={range.from}>
            {`${format(range.from)} ${index === ranges.length - 1 ? "tot en met" : "tot"} ${format(range.to)}`}
          </li>
        ))}
      </ul>
      {unknown && (
        <span className="mm-class-legend-unknown">
          <i style={{ background: UNKNOWN }} aria-hidden="true" />
          {unknown}
        </span>
      )}
    </div>
  );
}
