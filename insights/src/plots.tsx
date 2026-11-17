import { useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import "./plots.css";

type Formatter = (value: number | null) => string;
type Geometry = FeatureCollection<
  Polygon | MultiPolygon,
  { code: string; name: string }
>;
type Series = {
  code: string;
  name: string;
  points: { year: number; value: number | null }[];
};
type ScatterPoint = { x: number; y: number; code: string; name: string };

const colors = [
  "#6366f1",
  "#1d9b93",
  "#eb9d47",
  "#e57999",
  "#5889c1",
  "#9b73bd",
];
const finite = (value: number | null): value is number =>
  value !== null && Number.isFinite(value);
function tickLabel(value: number, format: Formatter) {
  const original = format(value);
  const magnitude = Math.abs(value);
  const number = (
    magnitude >= 1e6 ? value / 1e6 : magnitude >= 1e3 ? value / 1e3 : value
  ).toLocaleString("nl-NL", { maximumFractionDigits: 1 });
  const suffix = magnitude >= 1e6 ? "m" : magnitude >= 1e3 ? "k" : "";
  return `${original.startsWith("€") ? "€ " : ""}${number}${suffix}${original.includes("%") ? "%" : ""}`;
}
const keyboardActivate = (event: KeyboardEvent, action: () => void) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
};

function extent(values: number[], zero = false) {
  let min = Math.min(...values),
    max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const margin = Math.abs(min) * 0.1 || 1;
    min -= margin;
    max += margin;
  } else {
    const margin = (max - min) * 0.1;
    min -= margin;
    max += margin;
  }
  if (zero && values.every((value) => value >= 0)) min = Math.max(0, min);
  return [min, max];
}

function EmptyPlot({ children }: { children: ReactNode }) {
  return (
    <div className="plot-empty">
      <span className="plot-empty-mark">↗</span>
      <p>{children}</p>
    </div>
  );
}

export function GeoMap({
  geometry,
  values,
  selected,
  onSelect,
  format,
  colorMode = "sequential",
  colorLimit,
}: {
  geometry: Geometry;
  values: Map<string, number | null>;
  selected: string[];
  onSelect: (code: string) => void;
  format: Formatter;
  colorMode?: "sequential" | "diverging";
  colorLimit?: number;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const pointer = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const panned = useRef(false);
  const [hovered, setHovered] = useState<{ code: string; name: string } | null>(
    null,
  );
  const map = useMemo(() => {
    const coordinates = geometry.features.flatMap((feature) =>
      feature.geometry.type === "Polygon"
        ? feature.geometry.coordinates.flat()
        : feature.geometry.coordinates.flat(2),
    );
    if (!coordinates.length) return null;
    // Amsterdam's compact geographic extent permits a local equirectangular projection.
    const cosLatitude = Math.cos((52.37 * Math.PI) / 180);
    const xs = coordinates.map(([longitude]) => longitude * cosLatitude);
    const ys = coordinates.map(([, latitude]) => latitude);
    const left = Math.min(...xs),
      right = Math.max(...xs),
      bottom = Math.min(...ys),
      top = Math.max(...ys);
    const scale = Math.min(552 / (right - left), 296 / (top - bottom));
    const offsetX = (600 - (right - left) * scale) / 2;
    const offsetY = (340 - (top - bottom) * scale) / 2;
    const project = ([longitude, latitude]: number[]) => [
      offsetX + (longitude * cosLatitude - left) * scale,
      offsetY + (top - latitude) * scale,
    ];
    const ring = (points: number[][]) =>
      points
        .map((point, i) => {
          const [x, y] = project(point);
          return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(" ") + "Z";
    return {
      project,
      paths: geometry.features.map((feature) => ({
        code: feature.properties.code,
        name: feature.properties.name,
        d: (feature.geometry.type === "Polygon"
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates
        )
          .map((polygon) => polygon.map(ring).join(" "))
          .join(" "),
      })),
    };
  }, [geometry]);
  const numbers = [...values.values()].filter(finite);
  const bound = numbers.length
    ? colorLimit && Number.isFinite(colorLimit) && colorLimit > 0
      ? colorLimit
      : Math.max(...numbers.map(Math.abs), 0.001)
    : null;
  const min = numbers.length
    ? colorMode === "diverging"
      ? -bound!
      : Math.min(...numbers)
    : null;
  const max = numbers.length
    ? colorMode === "diverging"
      ? bound
      : Math.max(...numbers)
    : null;
  const selectedSet = new Set(selected);
  const shade = (value: number | null) => {
    if (!finite(value) || min === null || max === null) return "#d5dddf";
    if (colorMode === "diverging") {
      const t = Math.min(1, Math.abs(value) / bound!);
      const endpoint = value < 0 ? [199, 117, 81] : [80, 98, 173];
      return `rgb(${endpoint.map((channel) => Math.round(247 + (channel - 247) * t)).join(", ")})`;
    }
    const t = max === min ? 0.5 : (value - min) / (max - min);
    return `rgb(${Math.round(218 - t * 173)}, ${Math.round(228 - t * 153)}, ${Math.round(247 - t * 97)})`;
  };
  if (!map) return <EmptyPlot>Geen buurtgrenzen beschikbaar.</EmptyPlot>;
  const [amsterdamX, amsterdamY] = map.project([4.8952, 52.3676]);
  const [ijX, ijY] = map.project([4.916, 52.391]);
  return (
    <div className="plot-map">
      <svg
        viewBox="0 0 600 340"
        className="plot-map-svg"
        role="group"
        aria-label="Kaart van Amsterdam. Selecteer een buurt om de inzichten te koppelen. Versleep een ingezoomde kaart om te bewegen."
        style={{
          touchAction: zoom > 1 ? "none" : "pan-y",
          cursor: zoom > 1 ? "grab" : undefined,
        }}
        onPointerDown={(event) => {
          if (zoom > 1 && event.button === 0) {
            pointer.current = {
              x: event.clientX,
              y: event.clientY,
              panX: pan.x,
              panY: pan.y,
            };
            panned.current = false;
          }
        }}
        onPointerMove={(event) => {
          if (!pointer.current) return;
          const dx = event.clientX - pointer.current.x,
            dy = event.clientY - pointer.current.y;
          if (!panned.current && Math.hypot(dx, dy) < 4) return;
          panned.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          const ratio = 600 / event.currentTarget.getBoundingClientRect().width;
          setPan({
            x: Math.max(
              -300 * (zoom - 1),
              Math.min(300 * (zoom - 1), pointer.current.panX + dx * ratio),
            ),
            y: Math.max(
              -170 * (zoom - 1),
              Math.min(170 * (zoom - 1), pointer.current.panY + dy * ratio),
            ),
          });
        }}
        onPointerUp={(event) => {
          pointer.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          setTimeout(() => {
            panned.current = false;
          }, 0);
        }}
        onPointerCancel={() => {
          pointer.current = null;
          panned.current = false;
        }}
      >
        <rect width="600" height="340" fill="#eef4f6" />
        <g
          transform={`translate(${300 + pan.x} ${170 + pan.y}) scale(${zoom}) translate(-300 -170)`}
        >
          {map.paths.map(({ code, name, d }) => (
            <path
              key={code}
              d={d}
              fill={shade(values.get(code) ?? null)}
              fillRule="evenodd"
              stroke={selectedSet.has(code) ? "#28254f" : "#fff"}
              strokeWidth={selectedSet.has(code) ? 1.6 / zoom : 0.55 / zoom}
              opacity={selected.length && !selectedSet.has(code) ? 0.38 : 1}
              role="button"
              tabIndex={0}
              aria-pressed={selectedSet.has(code)}
              aria-label={`${name}: ${format(values.get(code) ?? null)}`}
              className="plot-map-area"
              data-code={code}
              onClick={() => {
                if (!panned.current) onSelect(code);
              }}
              onKeyDown={(event) =>
                keyboardActivate(event, () => onSelect(code))
              }
              onMouseEnter={() => setHovered({ code, name })}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered({ code, name })}
              onBlur={() => setHovered(null)}
            >
              <title>
                {name} · {format(values.get(code) ?? null)}
              </title>
            </path>
          ))}
          <g className="plot-map-labels" pointerEvents="none">
            <text
              x={amsterdamX}
              y={amsterdamY}
              textAnchor="middle"
              fontSize={12 / Math.sqrt(zoom)}
              fontWeight="650"
            >
              Amsterdam
            </text>
            <text
              x={ijX}
              y={ijY}
              textAnchor="middle"
              fontSize={10 / Math.sqrt(zoom)}
              fontStyle="italic"
              fill="#7398a7"
            >
              IJ
            </text>
          </g>
        </g>
      </svg>
      <div className="plot-map-controls" aria-label="Kaart zoomen">
        <button
          type="button"
          aria-label="Inzoomen"
          disabled={zoom >= 3}
          onClick={() => setZoom((value) => Math.min(3, value + 0.5))}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Uitzoomen"
          disabled={zoom <= 1}
          onClick={() => {
            setZoom((value) => Math.max(1, value - 0.5));
            setPan({ x: 0, y: 0 });
          }}
        >
          −
        </button>
        {zoom > 1 && (
          <button
            type="button"
            aria-label="Volledige kaart"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            ↺
          </button>
        )}
      </div>
      {hovered && (
        <div className="plot-map-tooltip" role="status">
          <strong>{hovered.name}</strong>
          <span>{format(values.get(hovered.code) ?? null)}</span>
        </div>
      )}
      <div className="plot-map-legend">
        <span>
          {colorMode === "diverging" &&
          min !== null &&
          numbers.some((value) => value < min)
            ? "≤ "
            : ""}
          {format(min)}
        </span>
        <i
          style={
            colorMode === "diverging"
              ? { background: "linear-gradient(90deg,#c77551,#f7f7f7,#5062ad)" }
              : undefined
          }
        />
        <span>
          {colorMode === "diverging" &&
          max !== null &&
          numbers.some((value) => value > max)
            ? "≥ "
            : ""}
          {format(max)}
        </span>
        <span className="plot-missing-key">
          <b /> Geen data
        </span>
      </div>
      <div className="plot-map-source">
        Buurtgrenzen · Gemeente Amsterdam · 24-03-2022
      </div>
    </div>
  );
}

export function TimePlot({
  series,
  year,
  onYear,
  format,
}: {
  series: Series[];
  year: number;
  onYear: (year: number) => void;
  format: Formatter;
}) {
  const [hoverYear, setHoverYear] = useState<number | null>(null);
  const id = useId().replaceAll(":", "");
  const allPoints = series.flatMap((entry) => entry.points);
  const values = allPoints.map((point) => point.value).filter(finite);
  const years = [...new Set(allPoints.map((point) => point.year))].sort(
    (a, b) => a - b,
  );
  if (!values.length || !years.length)
    return (
      <EmptyPlot>
        Geen waarnemingen in deze periode. Kies een andere variabele of buurt.
      </EmptyPlot>
    );
  const [min, max] = extent(values, true);
  const left = 75,
    right = 574,
    top = 22,
    bottom = 229;
  const x = (value: number) =>
    years.length === 1
      ? (left + right) / 2
      : left +
        ((value - years[0]) / (years.at(-1)! - years[0])) * (right - left);
  const y = (value: number) =>
    bottom - ((value - min) / (max - min)) * (bottom - top);
  const ticks = Array.from(
    { length: 5 },
    (_, i) => min + ((max - min) * i) / 4,
  );
  const shownYears = [
    ...new Set(
      Array.from(
        { length: Math.min(5, years.length) },
        (_, i) =>
          years[
            Math.round(
              (i * (years.length - 1)) /
                Math.max(1, Math.min(4, years.length - 1)),
            )
          ],
      ),
    ),
  ];
  const activeYear = hoverYear ?? year;
  const path = (points: Series["points"]) => {
    let connected = false;
    return points
      .map((point) => {
        if (!finite(point.value)) {
          connected = false;
          return "";
        }
        const command = connected ? "L" : "M";
        connected = true;
        return `${command}${x(point.year).toFixed(2)},${y(point.value).toFixed(2)}`;
      })
      .join(" ");
  };
  return (
    <div className="plot-time">
      <svg
        viewBox="0 0 600 265"
        className="plot-chart-svg"
        role="group"
        aria-label="Tijdreeks. Kies een jaar om alle blokken bij te werken."
      >
        <defs>
          <clipPath id={`${id}-clip`}>
            <rect
              x={left - 4}
              y={top - 4}
              width={right - left + 8}
              height={bottom - top + 8}
            />
          </clipPath>
        </defs>
        {ticks.map((value, i) => (
          <g key={i}>
            <line
              x1={left}
              x2={right}
              y1={y(value)}
              y2={y(value)}
              className="plot-grid"
            />
            <text
              x={left - 12}
              y={y(value) + 4}
              textAnchor="end"
              className="plot-tick"
            >
              {tickLabel(value, format)}
            </text>
          </g>
        ))}
        {shownYears.map((value) => (
          <text
            key={value}
            x={x(value)}
            y={bottom + 24}
            textAnchor="middle"
            className="plot-tick"
          >
            {value}
          </text>
        ))}
        <g clipPath={`url(#${id}-clip)`}>
          {series.map((entry, index) => (
            <g key={entry.code}>
              <path
                d={path(entry.points)}
                fill="none"
                stroke={colors[index % colors.length]}
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {entry.points
                .filter((point) => finite(point.value))
                .map((point) => (
                  <circle
                    key={point.year}
                    cx={x(point.year)}
                    cy={y(point.value!)}
                    r={point.year === activeYear ? 4.5 : 2.2}
                    fill={colors[index % colors.length]}
                    stroke="white"
                    strokeWidth={point.year === activeYear ? 2 : 0.5}
                  >
                    <title>
                      {entry.name}, {point.year}: {format(point.value)}
                    </title>
                  </circle>
                ))}
            </g>
          ))}
          {years.includes(activeYear) && (
            <line
              x1={x(activeYear)}
              x2={x(activeYear)}
              y1={top}
              y2={bottom}
              stroke="#aaa8c9"
              strokeDasharray="4 5"
            />
          )}
        </g>
        {years.map((value, i) => {
          const start = i === 0 ? left : (x(years[i - 1]) + x(value)) / 2;
          const end =
            i === years.length - 1 ? right : (x(value) + x(years[i + 1])) / 2;
          return (
            <rect
              key={value}
              x={start}
              y={top}
              width={Math.max(1, end - start)}
              height={bottom - top}
              fill="transparent"
              className="plot-year-target"
              role="button"
              tabIndex={0}
              aria-label={`Toon bronjaar ${value}`}
              aria-pressed={year === value}
              onClick={() => onYear(value)}
              onKeyDown={(event) =>
                keyboardActivate(event, () => onYear(value))
              }
              onMouseEnter={() => setHoverYear(value)}
              onMouseLeave={() => setHoverYear(null)}
              onFocus={() => setHoverYear(value)}
              onBlur={() => setHoverYear(null)}
            />
          );
        })}
      </svg>
      <div className="plot-series-legend">
        {series.map((entry, index) => (
          <span key={entry.code}>
            <i style={{ backgroundColor: colors[index % colors.length] }} />
            <span title={entry.name}>{entry.name}</span>
            <b>
              {format(
                entry.points.find((point) => point.year === activeYear)
                  ?.value ?? null,
              )}
            </b>
          </span>
        ))}
      </div>
      {hoverYear !== null && (
        <span className="plot-year-caption">
          Bronjaar {hoverYear} · klik om te selecteren
        </span>
      )}
    </div>
  );
}

export function RegressionPlot({
  points,
  selected,
  onSelect,
  fit,
  formatX,
  formatY,
}: {
  points: ScatterPoint[];
  selected: string[];
  onSelect: (code: string) => void;
  fit: { slope: number; intercept: number; r2: number | null } | null;
  formatX: Formatter;
  formatY: Formatter;
}) {
  const id = useId().replaceAll(":", "");
  const [hovered, setHovered] = useState<ScatterPoint | null>(null);
  const valid = points.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );
  if (!valid.length)
    return (
      <EmptyPlot>
        Geen buurten met beide waarden in dit bronjaar. Kies andere variabelen
        of een ander jaar.
      </EmptyPlot>
    );
  const [minX, maxX] = extent(
    valid.map((point) => point.x),
    true,
  );
  const [minY, maxY] = extent(
    valid.map((point) => point.y),
    true,
  );
  const left = 75,
    right = 574,
    top = 22,
    bottom = 224;
  const x = (value: number) =>
    left + ((value - minX) / (maxX - minX)) * (right - left);
  const y = (value: number) =>
    bottom - ((value - minY) / (maxY - minY)) * (bottom - top);
  const selectedSet = new Set(selected);
  return (
    <div className="plot-regression">
      <svg
        viewBox="0 0 600 265"
        className="plot-chart-svg"
        role="group"
        aria-label={`Spreidingsdiagram met ${valid.length} buurten. Selecteer een punt om een buurt te koppelen.`}
      >
        <defs>
          <clipPath id={`${id}-clip`}>
            <rect
              x={left - 1}
              y={top - 1}
              width={right - left + 2}
              height={bottom - top + 2}
            />
          </clipPath>
        </defs>
        {Array.from({ length: 5 }, (_, i) => {
          const valueX = minX + ((maxX - minX) * i) / 4,
            valueY = minY + ((maxY - minY) * i) / 4;
          return (
            <g key={i}>
              <line
                x1={left}
                x2={right}
                y1={y(valueY)}
                y2={y(valueY)}
                className="plot-grid"
              />
              <text
                x={left - 12}
                y={y(valueY) + 4}
                textAnchor="end"
                className="plot-tick"
              >
                {tickLabel(valueY, formatY)}
              </text>
              <text
                x={x(valueX)}
                y={bottom + 24}
                textAnchor="middle"
                className="plot-tick"
              >
                {tickLabel(valueX, formatX)}
              </text>
            </g>
          );
        })}
        <g clipPath={`url(#${id}-clip)`}>
          {fit &&
            Number.isFinite(fit.slope) &&
            Number.isFinite(fit.intercept) && (
              <line
                x1={x(minX)}
                x2={x(maxX)}
                y1={y(fit.intercept + fit.slope * minX)}
                y2={y(fit.intercept + fit.slope * maxX)}
                stroke="#1d9b93"
                strokeWidth="2"
                strokeDasharray="6 5"
                className="plot-fit-line"
              >
                <title>
                  Lineaire regressie, R²{" "}
                  {fit.r2 === null ? "niet gedefinieerd" : fit.r2.toFixed(3)}
                </title>
              </line>
            )}
          {[...valid]
            .sort(
              (a, b) =>
                Number(selectedSet.has(a.code)) -
                Number(selectedSet.has(b.code)),
            )
            .map((point) => {
              const active = selectedSet.has(point.code);
              return (
                <circle
                  key={point.code}
                  cx={x(point.x)}
                  cy={y(point.y)}
                  r={active ? 5.1 : 3.5}
                  fill={active ? "#eb9d47" : "#7272d5"}
                  opacity={selected.length && !active ? 0.25 : 0.6}
                  stroke={active ? "#81551d" : "white"}
                  strokeWidth={active ? 1.2 : 0.6}
                  role="button"
                  tabIndex={0}
                  aria-pressed={active}
                  aria-label={`${point.name}: ${formatX(point.x)}, ${formatY(point.y)}`}
                  className="plot-scatter-point"
                  data-code={point.code}
                  onClick={() => onSelect(point.code)}
                  onKeyDown={(event) =>
                    keyboardActivate(event, () => onSelect(point.code))
                  }
                  onMouseEnter={() => setHovered(point)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(point)}
                  onBlur={() => setHovered(null)}
                >
                  <title>
                    {point.name} · x: {formatX(point.x)} · y: {formatY(point.y)}
                  </title>
                </circle>
              );
            })}
        </g>
      </svg>
      {hovered && (
        <div className="plot-scatter-tooltip" role="status">
          <strong>{hovered.name}</strong>
          <span>
            X {formatX(hovered.x)} · Y {formatY(hovered.y)}
          </span>
        </div>
      )}
      <div className="plot-scatter-legend">
        <span>
          <i /> Eén punt = één buurt
        </span>
        {fit && (
          <span>
            <b /> Lineaire regressie
          </span>
        )}
      </div>
    </div>
  );
}
