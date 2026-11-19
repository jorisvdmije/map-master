import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import "./charts.css";

type Observation = { period: string; value: number | null };
type Prediction = {
  id: string;
  label: string;
  value: number | null;
  color: string;
  low?: number | null;
  high?: number | null;
};
export type MarketForecastChartProps = {
  history: Observation[];
  future: Observation[];
  predictions: Prediction[];
  basePeriod: string;
  targetPeriod: string;
  originPeriod: string;
  revealed: boolean;
};

type QuarterPoint = { quarter: number; period: string; value: number | null };
const isFiniteValue = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);
const indexNumber = (value: number | null | undefined) =>
  isFiniteValue(value)
    ? value.toLocaleString("nl-NL", { maximumFractionDigits: 1 })
    : "—";
const signed = (value: number) =>
  `${value > 0 ? "+" : ""}${indexNumber(value)}`;

/** Supports the canonical YYYY-Qn and the Dutch YYYYKn source notation. */
function quarterNumber(period: string) {
  const match = /^(\d{4})[-\s]?[QK]([1-4])$/i.exec(period);
  return match ? Number(match[1]) * 4 + Number(match[2]) - 1 : null;
}
function quarterLabel(quarter: number) {
  return `K${(quarter % 4) + 1} ${Math.floor(quarter / 4)}`;
}
function pointsFor(observations: Observation[]) {
  const seen = new Set<number>();
  return observations
    .flatMap((point) => {
      const quarter = quarterNumber(point.period);
      if (quarter === null || seen.has(quarter)) return [];
      seen.add(quarter);
      return [
        {
          quarter,
          period: point.period,
          value: isFiniteValue(point.value) ? point.value : null,
        },
      ];
    })
    .sort((a, b) => a.quarter - b.quarter);
}
function useChartWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setWidth(
        Math.max(250, Math.round(element.getBoundingClientRect().width)),
      );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
function scaleDomain(values: number[], includeZero = false) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
  let min = finite.reduce((result, value) => Math.min(result, value), Infinity);
  let max = finite.reduce(
    (result, value) => Math.max(result, value),
    -Infinity,
  );
  if (includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  const padding = Math.max((max - min) * 0.08, Math.abs(max) * 0.015, 0.1);
  min -= padding;
  max += padding;
  const rawStep = (max - min) / 4;
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const size = rawStep / power;
  const step =
    (size > 5 ? 10 : size > 2.5 ? 5 : size > 2 ? 2.5 : size > 1 ? 2 : 1) *
    power;
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  const ticks = Array.from(
    { length: Math.round((max - min) / step) + 1 },
    (_, i) => min + step * i,
  );
  return { min, max, ticks };
}
function selectTicks(start: number, end: number, count: number) {
  if (start === end) return [start];
  const step = Math.max(1, Math.ceil((end - start) / Math.max(1, count - 1)));
  const values = [start];
  for (let value = start + step; value < end; value += step) values.push(value);
  values.push(end);
  return values.filter(
    (value, i) =>
      i === values.length - 1 || values.at(-1)! - value > step * 0.5,
  );
}
function linePath(
  points: QuarterPoint[],
  x: (quarter: number) => number,
  y: (value: number) => number,
) {
  let previous: QuarterPoint | undefined;
  return points
    .map((point) => {
      if (point.value === null) {
        previous = undefined;
        return "";
      }
      const command =
        previous && previous.quarter === point.quarter - 1 ? "L" : "M";
      previous = point;
      return `${command}${x(point.quarter).toFixed(2)},${y(point.value).toFixed(2)}`;
    })
    .join(" ");
}
function EmptyMarketChart({ children }: { children: ReactNode }) {
  return (
    <div className="market-chart-empty">
      <span>↗</span>
      <p>{children}</p>
    </div>
  );
}

export function MarketForecastChart({
  history,
  future,
  predictions,
  basePeriod,
  targetPeriod,
  originPeriod,
  revealed,
}: MarketForecastChartProps) {
  const { ref, width } = useChartWidth();
  const uid = useId().replaceAll(":", "");
  const [hoverQuarter, setHoverQuarter] = useState<number | null>(null);
  const base = quarterNumber(basePeriod),
    target = quarterNumber(targetPeriod),
    origin = quarterNumber(originPeriod);
  const known = useMemo(
    () =>
      pointsFor(history).filter(
        (point) => base !== null && point.quarter <= base,
      ),
    [history, base],
  );
  // Do not derive a scale, path, title, description or accessible row from unrevealed values.
  const actualFuture = useMemo(
    () =>
      revealed
        ? pointsFor(future).filter(
            (point) =>
              base !== null &&
              target !== null &&
              point.quarter > base &&
              point.quarter <= target,
          )
        : [],
    [revealed, future, base, target],
  );
  const baseValue =
    known.find((point) => point.quarter === base)?.value ?? null;
  const visibleValues = [
    ...known.map((point) => point.value),
    ...actualFuture.map((point) => point.value),
    ...predictions.flatMap((prediction) =>
      isFiniteValue(prediction.value)
        ? [
            prediction.value,
            ...(isFiniteValue(prediction.low) &&
            isFiniteValue(prediction.high) &&
            prediction.low <= prediction.high
              ? [prediction.low, prediction.high]
              : []),
          ]
        : [],
    ),
  ].filter(isFiniteValue);
  const valid =
    base !== null &&
    target !== null &&
    origin !== null &&
    target > base &&
    known.length &&
    visibleValues.length;
  const first = Math.min(known[0]?.quarter ?? base ?? 0, base ?? 0);
  const { min, max, ticks } = scaleDomain(visibleValues);
  const compact = width < 430;
  const left = compact ? 43 : 53,
    right = width - (compact ? 23 : 30),
    top = 39,
    bottom = 259;
  const x = (quarter: number) =>
    left +
    ((quarter - first) / Math.max(1, (target ?? first + 1) - first)) *
      (right - left);
  const y = (value: number) =>
    bottom - ((value - min) / (max - min)) * (bottom - top);
  const targetValue =
    actualFuture.find((point) => point.quarter === target)?.value ?? null;
  const lagEnd =
    origin !== null && base !== null
      ? Math.max(base, Math.min(origin, target ?? origin))
      : 0;
  const hasLag = base !== null && lagEnd > base;
  const hoverKnown =
    hoverQuarter === null
      ? undefined
      : known.find((point) => point.quarter === hoverQuarter);
  const hoverActual =
    hoverQuarter === null
      ? undefined
      : actualFuture.find((point) => point.quarter === hoverQuarter);
  const hover = hoverKnown ?? hoverActual;

  return (
    <div
      className="market-forecast-chart"
      ref={ref}
      data-market-forecast
      data-revealed={revealed}
    >
      {!valid ? (
        <EmptyMarketChart>
          Er zijn nog onvoldoende bekende indexcijfers voor deze voorspelling.
        </EmptyMarketChart>
      ) : (
        <>
          <div className="market-chart-unit">
            Prijsindex bestaande koopwoningen · 2020 = 100
          </div>
          <svg
            viewBox={`0 0 ${width} 302`}
            className="market-chart-svg"
            role="group"
            aria-label={`Woningprijsindex. Bekende waarden tot ${quarterLabel(base!)} en modelramingen voor ${quarterLabel(target!)}.${revealed ? " De vrijgegeven werkelijke waarden zijn toegevoegd." : ""}`}
          >
            <defs>
              <clipPath id={`${uid}-clip`}>
                <rect
                  x={left - 5}
                  y={top - 5}
                  width={right - left + 10}
                  height={bottom - top + 10}
                />
              </clipPath>
            </defs>
            {hasLag && (
              <g
                className="market-publication-lag"
                aria-label={`${quarterLabel(base!)} tot ${quarterLabel(lagEnd)}: nog niet gepubliceerd op het voorspelmoment`}
              >
                <rect
                  x={x(base!)}
                  y={top}
                  width={x(lagEnd) - x(base!)}
                  height={bottom - top}
                  fill="#f6f3e9"
                />
                {x(lagEnd) - x(base!) > 122 && (
                  <text
                    x={(x(base!) + x(lagEnd)) / 2}
                    y={top + 17}
                    textAnchor="middle"
                    className="market-lag-label"
                  >
                    Nog niet gepubliceerd
                  </text>
                )}
              </g>
            )}
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={left}
                  x2={right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className="market-chart-grid"
                />
                <text
                  x={left - 10}
                  y={y(tick) + 4}
                  textAnchor="end"
                  className="market-chart-tick"
                >
                  {indexNumber(tick)}
                </text>
              </g>
            ))}
            {selectTicks(first, target!, compact ? 3 : 6).map((quarter) => (
              <text
                key={quarter}
                x={x(quarter)}
                y={bottom + 23}
                textAnchor={
                  quarter === first
                    ? "start"
                    : quarter === target
                      ? "end"
                      : "middle"
                }
                className="market-chart-tick"
              >
                {quarterLabel(quarter)}
              </text>
            ))}
            <line
              x1={x(base!)}
              x2={x(base!)}
              y1={top}
              y2={bottom}
              className="market-base-divider"
            />
            <line
              x1={x(target!)}
              x2={x(target!)}
              y1={top}
              y2={bottom}
              className="market-target-divider"
            />
            <text
              x={x(base!)}
              y={top - 14}
              textAnchor="end"
              className="market-period-label"
            >
              Laatst bekend
            </text>
            <text
              x={x(target!)}
              y={bottom + 38}
              textAnchor="end"
              className="market-period-label"
            >
              Doelkwartaal
            </text>
            <g clipPath={`url(#${uid}-clip)`}>
              <path
                d={linePath(known, x, y)}
                fill="none"
                stroke="#323f64"
                strokeWidth="2.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                data-market-known-history
              />
              {known
                .filter((point) => isFiniteValue(point.value))
                .map((point) => (
                  <circle
                    key={point.quarter}
                    cx={x(point.quarter)}
                    cy={y(point.value!)}
                    r={point.quarter === base ? 4.2 : 2.1}
                    fill="#323f64"
                    stroke="white"
                    strokeWidth={point.quarter === base ? 1.8 : 0.8}
                  >
                    <title>{`${quarterLabel(point.quarter)}: index ${indexNumber(point.value)}`}</title>
                  </circle>
                ))}
              {predictions
                .filter((prediction) => isFiniteValue(prediction.value))
                .map((prediction) => {
                  const interval =
                    isFiniteValue(prediction.low) &&
                    isFiniteValue(prediction.high) &&
                    prediction.low! <= prediction.high!;
                  return (
                    <g
                      key={prediction.id}
                      data-market-prediction={prediction.id}
                    >
                      {baseValue !== null && (
                        <line
                          x1={x(base!)}
                          x2={x(target!)}
                          y1={y(baseValue)}
                          y2={y(prediction.value!)}
                          stroke={prediction.color}
                          strokeWidth="2"
                          strokeDasharray="6 5"
                          opacity=".8"
                        >
                          <title>{`${prediction.label}: modeluitkomst voor ${quarterLabel(target!)}. De stippellijn verbindt de basiswaarde met de doelraming.`}</title>
                        </line>
                      )}
                      {interval && (
                        <g
                          stroke={prediction.color}
                          strokeWidth="1.6"
                          opacity=".65"
                          data-market-interval={prediction.id}
                        >
                          <line
                            x1={x(target!)}
                            x2={x(target!)}
                            y1={y(prediction.low!)}
                            y2={y(prediction.high!)}
                          />
                          <line
                            x1={x(target!) - 5}
                            x2={x(target!) + 5}
                            y1={y(prediction.low!)}
                            y2={y(prediction.low!)}
                          />
                          <line
                            x1={x(target!) - 5}
                            x2={x(target!) + 5}
                            y1={y(prediction.high!)}
                            y2={y(prediction.high!)}
                          />
                          <title>{`${prediction.label}: gekalibreerd doelinterval ${indexNumber(prediction.low)} tot ${indexNumber(prediction.high)}`}</title>
                        </g>
                      )}
                      <circle
                        cx={x(target!)}
                        cy={y(prediction.value!)}
                        r="5"
                        fill={prediction.color}
                        stroke="white"
                        strokeWidth="1.8"
                      >
                        <title>{`${prediction.label}, ${quarterLabel(target!)}: index ${indexNumber(prediction.value)}`}</title>
                      </circle>
                    </g>
                  );
                })}
              {revealed && (
                <g
                  data-market-future-actual
                  aria-label="Vrijgegeven werkelijke prijsindex"
                >
                  <path
                    d={linePath(
                      [
                        {
                          quarter: base!,
                          period: basePeriod,
                          value: baseValue,
                        },
                        ...actualFuture,
                      ],
                      x,
                      y,
                    )}
                    fill="none"
                    stroke="#20998a"
                    strokeWidth="2.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {actualFuture
                    .filter((point) => isFiniteValue(point.value))
                    .map((point) => (
                      <circle
                        key={point.quarter}
                        data-market-actual-period={point.period}
                        cx={x(point.quarter)}
                        cy={y(point.value!)}
                        r={point.quarter === target ? 4.5 : 2.5}
                        fill="#20998a"
                        stroke="white"
                        strokeWidth="1.5"
                      >
                        <title>{`${quarterLabel(point.quarter)}: werkelijke index ${indexNumber(point.value)}`}</title>
                      </circle>
                    ))}
                </g>
              )}
            </g>
            {hoverQuarter !== null && (
              <line
                x1={x(hoverQuarter)}
                x2={x(hoverQuarter)}
                y1={top}
                y2={bottom}
                stroke="#a7acbf"
                strokeDasharray="3 5"
                pointerEvents="none"
              />
            )}
            {[...known, ...actualFuture].map((point) => (
              <rect
                key={point.quarter}
                x={Math.max(left, x(point.quarter - 0.5))}
                y={top}
                width={Math.max(
                  1,
                  Math.min(right, x(point.quarter + 0.5)) -
                    Math.max(left, x(point.quarter - 0.5)),
                )}
                height={bottom - top}
                fill="transparent"
                className="market-quarter-target"
                onMouseEnter={() => setHoverQuarter(point.quarter)}
                onMouseLeave={() => setHoverQuarter(null)}
              />
            ))}
          </svg>
          {hover && (
            <div className="market-chart-tooltip" role="status">
              <strong>{quarterLabel(hover.quarter)}</strong>
              <span>
                {hoverKnown ? "Bekende" : "Werkelijke"} index{" "}
                {indexNumber(hover.value)}
              </span>
            </div>
          )}
          <div className="market-forecast-legend">
            <span>
              <i style={{ background: "#323f64" }} />
              <span>Bekend t/m {quarterLabel(base!)}</span>
              <strong>{indexNumber(baseValue)}</strong>
            </span>
            {predictions.map((prediction) => (
              <span key={prediction.id}>
                <i style={{ background: prediction.color }} />
                <span>{prediction.label}</span>
                <strong>
                  {isFiniteValue(prediction.value)
                    ? indexNumber(prediction.value)
                    : "Geen raming"}
                </strong>
              </span>
            ))}
            {revealed && (
              <span data-market-revealed-value>
                <i style={{ background: "#20998a" }} />
                <span>Werkelijk · {quarterLabel(target!)}</span>
                <strong>{indexNumber(targetValue)}</strong>
              </span>
            )}
          </div>
          {hasLag && (
            <p className="market-lag-note">
              <i />
              Na {quarterLabel(base!)} t/m {quarterLabel(lagEnd)}: nog niet
              gepubliceerd op het voorspelmoment.
            </p>
          )}
          <p className="market-chart-explanation">
            Stippellijnen verbinden het laatst bekende cijfer met de
            modeluitkomsten voor het doelkwartaal.
            {predictions.some(
              (prediction) =>
                isFiniteValue(prediction.value) &&
                isFiniteValue(prediction.low) &&
                isFiniteValue(prediction.high) &&
                prediction.low <= prediction.high,
            )
              ? " Verticale streepjes tonen het meegegeven doelinterval."
              : ""}
          </p>
        </>
      )}
    </div>
  );
}

export function MarketErrorChart({
  rows,
}: {
  rows: { period: string; actual: number; predicted: number }[];
}) {
  const { ref, width } = useChartWidth();
  const [hovered, setHovered] = useState<number | null>(null);
  const points = rows
    .flatMap((row) => {
      const quarter = quarterNumber(row.period);
      return quarter !== null &&
        Number.isFinite(row.actual) &&
        Number.isFinite(row.predicted)
        ? [{ ...row, quarter, error: row.predicted - row.actual }]
        : [];
    })
    .sort((a, b) => a.quarter - b.quarter);
  const compact = width < 430;
  const first = points[0]?.quarter ?? 0,
    last = points.at(-1)?.quarter ?? first;
  const left = compact ? 40 : 51,
    right = width - (compact ? 18 : 25),
    top = 22,
    bottom = 190;
  const domain = scaleDomain(
    points.map((point) => point.error),
    true,
  );
  const slots = last - first + 1;
  const x = (quarter: number) =>
    left + ((quarter - first + 0.5) / slots) * (right - left);
  const y = (value: number) =>
    bottom -
    ((value - domain.min) / (domain.max - domain.min)) * (bottom - top);
  const barWidth = Math.min(23, ((right - left) / slots) * 0.58);
  const meanAbsoluteError = points.length
    ? points.reduce(
        (sum, point) => sum + Math.abs(point.error) / points.length,
        0,
      )
    : null;
  const point = hovered === null ? undefined : points[hovered];
  return (
    <div className="market-error-chart" ref={ref} data-market-errors>
      {!points.length ? (
        <EmptyMarketChart>
          Voor deze instellingen zijn geen complete terugtests beschikbaar.
        </EmptyMarketChart>
      ) : (
        <>
          <div className="market-error-summary">
            <span>Groeifout · procentpunt</span>
            <span>
              Gemiddeld absoluut{" "}
              <strong>{indexNumber(meanAbsoluteError)} pp</strong>
            </span>
          </div>
          <svg
            viewBox={`0 0 ${width} 232`}
            className="market-chart-svg"
            role="group"
            aria-label={`Voorspelfout in voortschrijdende terugtests, in procentpunten. Positief betekent dat de geraamde groei hoger was dan de werkelijke groei. ${points.length} testmomenten.`}
          >
            {domain.ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={left}
                  x2={right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className={
                    Math.abs(tick) < 1e-10
                      ? "market-error-zero"
                      : "market-chart-grid"
                  }
                />
                <text
                  x={left - 10}
                  y={y(tick) + 4}
                  textAnchor="end"
                  className="market-chart-tick"
                >
                  {signed(tick)}
                </text>
              </g>
            ))}
            {selectTicks(first, last, compact ? 3 : 6).map((quarter) => (
              <text
                key={quarter}
                x={x(quarter)}
                y={bottom + 24}
                textAnchor={
                  quarter === first
                    ? "start"
                    : quarter === last
                      ? "end"
                      : "middle"
                }
                className="market-chart-tick"
              >
                {quarterLabel(quarter)}
              </text>
            ))}
            {points.map((row, index) => (
              <g
                key={`${row.period}-${index}`}
                data-market-error-period={row.period}
              >
                <rect
                  x={x(row.quarter) - barWidth / 2}
                  y={Math.min(y(0), y(row.error))}
                  width={barWidth}
                  height={Math.max(1.5, Math.abs(y(row.error) - y(0)))}
                  fill={
                    Math.abs(row.error) < 1e-10
                      ? "#b6bfcd"
                      : row.error > 0
                        ? "#8979d5"
                        : "#65aaa0"
                  }
                  opacity={hovered === index ? 1 : 0.76}
                  rx="2"
                />
                <rect
                  x={x(row.quarter) - Math.max(barWidth, 16) / 2}
                  y={top}
                  width={Math.max(barWidth, 16)}
                  height={bottom - top}
                  fill="transparent"
                  tabIndex={0}
                  role="img"
                  aria-label={`${quarterLabel(row.quarter)}: werkelijke groei ${indexNumber(row.actual)}%, geraamde groei ${indexNumber(row.predicted)}%, fout ${signed(row.error)} procentpunt`}
                  className="market-error-target"
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(index)}
                  onBlur={() => setHovered(null)}
                >
                  <title>{`${quarterLabel(row.quarter)} · werkelijk ${indexNumber(row.actual)}% · raming ${indexNumber(row.predicted)}% · fout ${signed(row.error)} pp`}</title>
                </rect>
              </g>
            ))}
          </svg>
          {point && (
            <div className="market-chart-tooltip" role="status">
              <strong>
                {quarterLabel(point.quarter)} · {signed(point.error)} pp
              </strong>
              <span>
                Werkelijk {indexNumber(point.actual)}% · raming{" "}
                {indexNumber(point.predicted)}%
              </span>
            </div>
          )}
          <div className="market-error-legend">
            <span>
              <i style={{ background: "#8979d5" }} />
              Groei te hoog geraamd
            </span>
            <span>
              <i style={{ background: "#65aaa0" }} />
              Groei te laag geraamd
            </span>
          </div>
          <p className="market-chart-explanation">
            Fout = geraamde groei − werkelijke groei. Elke balk hoort bij één
            terugtest; het verschil is uitgedrukt in procentpunten.
          </p>
        </>
      )}
    </div>
  );
}
