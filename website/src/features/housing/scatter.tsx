import { pairedCorrelation } from "@/features/data/joins";
import {
  units,
  labels,
  metricValue,
  format,
  number,
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
  let xmin = Math.min(...xs),
    xmax = Math.max(...xs),
    ymin = Math.min(...ys),
    ymax = Math.max(...ys);
  if (xmin === xmax) {
    const padding = Math.max(Math.abs(xmin) * 0.05, 0.1);
    xmin -= padding;
    xmax += padding;
  }
  if (ymin === ymax) {
    const padding = Math.max(Math.abs(ymin) * 0.05, 1000);
    ymin = Math.max(0, ymin - padding);
    ymax += padding;
  }
  const x = (n: number) =>
    78 + (xmax === xmin ? 0.5 : (n - xmin) / (xmax - xmin)) * 440;
  const y = (n: number) =>
    245 - (ymax === ymin ? 0.5 : (n - ymin) / (ymax - ymin)) * 210;
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
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line
              x1="78"
              x2="518"
              y1={35 + 210 * t}
              y2={35 + 210 * t}
              stroke="#dce5df"
            />
            <text x="68" y={39 + 210 * t} textAnchor="end">
              {number((ymax - (ymax - ymin) * t) / 1000)}k
            </text>
          </g>
        ))}
        <line x1="78" x2="518" y1="245" y2="245" stroke="#82978e" />
        <text x="78" y="266">
          {number(xmin, 1)}
        </text>
        <text x="518" y="266" textAnchor="end">
          {number(xmax, 1)}
        </text>
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
