import { pairedCorrelation } from "@/features/data/joins";
import { niceAxis, tickFormatter } from "@/lib/scales";
import {
  units,
  labels,
  metricValue,
  format,
  type Neighborhood,
  type Metric,
} from "./model";

export function Scatter({
  rows,
  axis,
  selected,
  choose,
}: {
  rows: Neighborhood[];
  axis: Metric;
  selected: string;
  choose: (code: string) => void;
}) {
  const { pairs } = pairedCorrelation(
    rows,
    (f) => metricValue(f, axis),
    (f) => metricValue(f, "woz"),
  );
  if (!pairs.length)
    return (
      <p className="hs-empty-chart">Geen complete paren voor deze selectie.</p>
    );
  const xs = pairs.map((p) => p.x),
    ys = pairs.map((p) => p.y);
  const xAxis = niceAxis(Math.min(...xs), Math.max(...xs));
  const yAxis = niceAxis(Math.min(...ys), Math.max(...ys), { count: 5 });
  const xTick = tickFormatter(xAxis.ticks),
    yTick = tickFormatter(yAxis.ticks);
  const x = (n: number) =>
    78 + ((n - xAxis.min) / (xAxis.max - xAxis.min)) * 440;
  const y = (n: number) =>
    245 - ((n - yAxis.min) / (yAxis.max - yAxis.min)) * 210;
  return (
    <figure className="hs-scatter">
      <svg
        viewBox="0 0 550 305"
        role="img"
        aria-label={`Buurtgemiddelde WOZ tegenover ${labels[axis]}. Elke stip is één buurt; kies buurten ook via de lijst.`}
      >
        <text x="78" y="18">
          Gemiddelde WOZ (€)
        </text>
        {yAxis.ticks.map((value) => (
          <g key={value}>
            <line
              x1="78"
              x2="518"
              y1={y(value)}
              y2={y(value)}
              stroke="#dce5df"
            />
            <text x="68" y={y(value) + 4} textAnchor="end">
              {yTick(value)}
            </text>
          </g>
        ))}
        <line x1="78" x2="518" y1="245" y2="245" stroke="#82978e" />
        {xAxis.ticks.map((value, index) => (
          <g key={value}>
            <line
              x1={x(value)}
              x2={x(value)}
              y1="245"
              y2="250"
              stroke="#82978e"
            />
            <text
              x={x(value)}
              y="266"
              textAnchor={
                index === 0
                  ? "start"
                  : index === xAxis.ticks.length - 1
                    ? "end"
                    : "middle"
              }
            >
              {xTick(value)}
            </text>
          </g>
        ))}
        <text x="298" y="293" textAnchor="middle">
          {labels[axis]} ({units[axis]})
        </text>
        {[...pairs]
          .sort(
            (a, b) =>
              Number(a.row.properties.code === selected) -
              Number(b.row.properties.code === selected),
          )
          .map((p) => (
            <circle
              key={p.row.properties.code}
              cx={x(p.x)}
              cy={y(p.y)}
              r={p.row.properties.code === selected ? 6 : 3.7}
              fill={p.row.properties.code === selected ? "#b76540" : "#247f78"}
              opacity={p.row.properties.code === selected ? 1 : 0.48}
              stroke="#fffdf5"
              strokeWidth=".7"
              onClick={() => choose(p.row.properties.code)}
            >
              <title>
                {p.row.properties.name}: {format(p.x, axis)} ·{" "}
                {format(p.y, "woz")}
              </title>
            </circle>
          ))}
      </svg>
      <figcaption>
        Dezelfde complete buurtparen voor grafiek en correlatie. Selecteren kan
        ook via de buurtenlijst.
      </figcaption>
    </figure>
  );
}
