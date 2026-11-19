import { useId, useMemo } from "react";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import {
  euro,
  number,
  percent,
  timeline,
  type AreaSeries,
  type Comparison,
  type Period,
} from "./model";
import "./charts.css";

type Point = { year: number; value: number | null; raw: number | null };

/** Each missing year starts a fresh subpath; the chart never interpolates a gap. */
function linePath(
  points: Point[],
  x: (year: number) => number,
  y: (value: number) => number,
  breakYears: number[] = [],
) {
  let connected = false;
  return points
    .map((point) => {
      if (point.value === null) {
        connected = false;
        return "";
      }
      if (breakYears.includes(point.year)) connected = false;
      const command = connected ? "L" : "M";
      connected = true;
      return `${command}${x(point.year).toFixed(2)},${y(point.value).toFixed(2)}`;
    })
    .join(" ");
}

export function DevelopmentTimeline({
  area,
  city,
  period,
  indexed,
}: {
  area?: AreaSeries;
  city: AreaSeries;
  period: Period;
  indexed: boolean;
}) {
  const id = useId();
  const cityPoints = timeline(city, period, indexed);
  const areaPoints = area ? timeline(area, period, indexed) : [];
  const values = [...cityPoints, ...areaPoints].flatMap((point) =>
    point.value === null ? [] : [point.value],
  );
  const min = Math.min(...values, indexed ? 100 : Infinity);
  const max = Math.max(...values, indexed ? 100 : -Infinity);
  const padding = Math.max((max - min) * 0.12, indexed ? 5 : 10000);
  const lower = Math.max(0, min - padding);
  const upper = max + padding;
  const x = (year: number) =>
    74 + ((year - period.start) / (period.end - period.start)) * 504;
  const y = (value: number) => 236 - ((value - lower) / (upper - lower)) * 202;
  const years = cityPoints.map((point) => point.year);
  const ticks = years.filter(
    (_, index) =>
      index === 0 ||
      index === years.length - 1 ||
      index % Math.max(1, Math.ceil((years.length - 1) / 4)) === 0,
  );
  const series = [
    {
      key: "city",
      name: city.name,
      points: cityPoints,
      breakYears: city.breakYears,
    },
    ...(area
      ? [
          {
            key: "area",
            name: area.name,
            points: areaPoints,
            breakYears: area.breakYears,
          },
        ]
      : []),
  ];
  const breaks = series.flatMap((entry) =>
    (entry.breakYears ?? [])
      .filter((year) => year > period.start && year <= period.end)
      .map((year) => `${entry.name} (${year})`),
  );
  return (
    <figure className="bd-timeline">
      {values.length ? (
        <svg
          viewBox="0 0 610 294"
          role="img"
          aria-labelledby={`${id}-title ${id}-description`}
        >
          <title id={`${id}-title`}>
            {`WOZ-ontwikkeling ${area ? `${area.name} en ` : ""}${city.name}, ${period.start}–${period.end}`}
          </title>
          <desc id={`${id}-description`}>
            {indexed
              ? `Iedere reeks begint op 100 in ${period.start}.`
              : "Gemiddelde WOZ per woning, in euro."}{" "}
            Ontbrekende jaren onderbreken de lijn. De tabel onder de grafiek
            bevat alle waarden en waardepeildata.
          </desc>
          <text x="74" y="18" className="bd-chart-unit">
            {indexed ? `Index · ${period.start} = 100` : "Gemiddelde WOZ (€)"}
          </text>
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const value = lower + fraction * (upper - lower);
            return (
              <g key={fraction}>
                <line x1="74" x2="578" y1={y(value)} y2={y(value)} />
                <text x="63" y={y(value) + 4} textAnchor="end">
                  {indexed ? number(value) : `${number(value / 1000)}k`}
                </text>
              </g>
            );
          })}
          {indexed && (
            <line
              className="bd-index-line"
              x1="74"
              x2="578"
              y1={y(100)}
              y2={y(100)}
            />
          )}
          {ticks.map((year) => (
            <text
              key={year}
              x={x(year)}
              y="258"
              textAnchor={
                year === period.start
                  ? "start"
                  : year === period.end
                    ? "end"
                    : "middle"
              }
            >
              {year}
            </text>
          ))}
          <text x="326" y="282" textAnchor="middle">
            Bronjaar · waardepeildatum 1 januari van het voorgaande jaar
          </text>
          {series.map((entry) => (
            <g key={entry.key} className={`bd-series-${entry.key}`}>
              <path
                d={linePath(entry.points, x, y, entry.breakYears)}
                fill="none"
              />
              {entry.points.flatMap((point) =>
                point.value === null
                  ? []
                  : [
                      <circle
                        key={point.year}
                        cx={x(point.year)}
                        cy={y(point.value)}
                        r="3.8"
                      >
                        <title>
                          {`${entry.name} · ${point.year}: ${euro(point.raw)}${indexed ? ` · index ${number(point.value, 1)}` : ""}`}
                        </title>
                      </circle>,
                    ],
              )}
            </g>
          ))}
        </svg>
      ) : (
        <p className="bd-chart-empty">
          Geen meetwaarden voor deze periode en weergave.
        </p>
      )}
      <figcaption>
        <span className="bd-chart-legend bd-legend-city">{city.name}</span>
        {area && (
          <span className="bd-chart-legend bd-legend-area">{area.name}</span>
        )}
        <p>
          {indexed
            ? "De index vergelijkt de verandering vanaf hetzelfde beginjaar."
            : "De lijnen tonen het gemiddelde WOZ-niveau per woning."}{" "}
          Ontbrekende waarden blijven open in de lijn.
        </p>
        {breaks.length > 0 && (
          <p className="bd-chart-break">
            Gewijzigde gebiedsindeling: {breaks.join(", ")}.
            {indexed
              ? " De index stopt vóór de grenswijziging; kies een beginjaar na die wijziging voor een nieuwe vergelijking."
              : " De lijn wordt bij de grenswijziging onderbroken."}
          </p>
        )}
      </figcaption>
      <details className="bd-chart-data">
        <summary>Bekijk de cijfers achter de tijdlijn</summary>
        <div
          className="bd-chart-table"
          tabIndex={0}
          role="region"
          aria-label="WOZ-tijdlijntabel"
        >
          <table>
            <caption>
              WOZ per woning{indexed ? ` en index (${period.start} = 100)` : ""}
            </caption>
            <thead>
              <tr>
                <th scope="col">Bronjaar</th>
                <th scope="col">Waardepeildatum</th>
                {series.map((entry) => (
                  <th key={entry.key} scope="col">
                    {entry.name} (€)
                  </th>
                ))}
                {indexed &&
                  series.map((entry) => (
                    <th key={entry.key} scope="col">
                      {entry.name} (index)
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {cityPoints.map((point, index) => (
                <tr key={point.year}>
                  <th scope="row">{point.year}</th>
                  <td>1 januari {point.year - 1}</td>
                  {series.map((entry) => (
                    <td key={entry.key}>
                      {number(entry.points[index]?.raw ?? null)}
                    </td>
                  ))}
                  {indexed &&
                    series.map((entry) => (
                      <td key={entry.key}>
                        {number(entry.points[index]?.value ?? null, 1)}
                      </td>
                    ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          — = onbekend
          {indexed
            ? " of buiten de vergelijkbare gebiedsindeling. Iedere reeks gebruikt haar eigen waarde in het beginjaar als indexbasis."
            : "."}
        </p>
      </details>
    </figure>
  );
}

type AreaGeometry = FeatureCollection<
  Polygon | MultiPolygon,
  { code: string; name?: string }
>;

function projected(coordinate: number[]) {
  const latitude = (Math.max(-85, Math.min(85, coordinate[1])) * Math.PI) / 180;
  return [
    (coordinate[0] * Math.PI) / 180,
    -Math.log(Math.tan(Math.PI / 4 + latitude / 2)),
  ];
}

function shapes(geometry: AreaGeometry) {
  const rings = geometry.features.map((feature) => ({
    code: feature.properties.code,
    name: feature.properties.name ?? feature.properties.code,
    rings: (feature.geometry.type === "Polygon"
      ? feature.geometry.coordinates
      : feature.geometry.coordinates.flat()
    ).map((ring) => ring.map(projected)),
  }));
  let west = Infinity,
    east = -Infinity,
    north = Infinity,
    south = -Infinity;
  for (const feature of rings)
    for (const ring of feature.rings)
      for (const [x, y] of ring) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        west = Math.min(west, x);
        east = Math.max(east, x);
        north = Math.min(north, y);
        south = Math.max(south, y);
      }
  const scale = Math.min(
    600 / Math.max(east - west, 1e-9),
    380 / Math.max(south - north, 1e-9),
  );
  const left = 20 + (600 - (east - west) * scale) / 2;
  const top = 20 + (380 - (south - north) * scale) / 2;
  return rings.map((feature) => ({
    code: feature.code,
    name: feature.name,
    path: feature.rings
      .map(
        (ring) =>
          ring
            .filter((p) => p.every(Number.isFinite))
            .map(
              ([x, y], index) =>
                `${index ? "L" : "M"}${(left + (x - west) * scale).toFixed(2)},${(top + (y - north) * scale).toFixed(2)}`,
            )
            .join(" ") + " Z",
      )
      .join(" "),
  }));
}

function shade(value: number, min: number, max: number) {
  const t =
    max === min ? 0.5 : Math.max(0, Math.min(1, (value - min) / (max - min)));
  return `rgb(${[219, 233, 231].map((channel, i) => Math.round(channel + ([27, 108, 112][i] - channel) * t)).join(",")})`;
}

export function DevelopmentMap({
  geometry,
  rows,
  selected,
  choose,
}: {
  geometry: AreaGeometry;
  rows: Comparison[];
  selected: string;
  choose: (code: string) => void;
}) {
  const id = useId();
  const paths = useMemo(() => shapes(geometry), [geometry]);
  const lookup = new Map(rows.map((row) => [row.area.code, row]));
  const mapped = rows.filter((row) =>
    paths.some((shape) => shape.code === row.area.code),
  );
  const min = mapped.length ? Math.min(...mapped.map((row) => row.growth)) : 0;
  const max = mapped.length ? Math.max(...mapped.map((row) => row.growth)) : 0;
  const selectedPath = paths.find((path) => path.code === selected);
  return (
    <figure className="bd-map">
      <svg
        viewBox="0 0 640 420"
        role="img"
        aria-labelledby={`${id}-title ${id}-description`}
      >
        <title id={`${id}-title`}>WOZ-verandering per Amsterdamse buurt</title>
        <desc id={`${id}-description`}>
          Donkerder betekent een grotere procentuele verandering. Grijs betekent
          buiten de selectie of geen vergelijkbaar cijfer. Kies een buurt via de
          kaart of de buurtenlijst. {mapped.length} buurten met een cijfer op de
          kaart.
        </desc>
        {paths.map((shape) => {
          const row = lookup.get(shape.code);
          return (
            <path
              key={shape.code}
              d={shape.path}
              fill={row ? shade(row.growth, min, max) : "#e3e6dd"}
              fillRule="evenodd"
              className={row ? "bd-map-area" : "bd-map-muted"}
              data-code={shape.code}
              data-selected={shape.code === selected}
              onClick={row ? () => choose(shape.code) : undefined}
            >
              <title>
                {row
                  ? `${row.area.name}: ${percent(row.growth)}`
                  : `${shape.name}: buiten selectie of onbekend`}
              </title>
            </path>
          );
        })}
        {selectedPath && (
          <path
            className="bd-map-selected"
            d={selectedPath.path}
            fill="none"
            fillRule="evenodd"
            pointerEvents="none"
          />
        )}
        <g
          className="bd-map-north"
          transform="translate(606 28)"
          aria-hidden="true"
        >
          <text textAnchor="middle" y="0">
            N
          </text>
          <path d="M 0 10 L -4 23 L 0 20 L 4 23 Z" />
        </g>
      </svg>
      <figcaption>
        <div className="bd-map-scale">
          {mapped.length ? (
            <>
              <span>{percent(min)}</span>
              <i aria-hidden="true" />
              <span>{percent(max)}</span>
              <span>WOZ-verandering</span>
            </>
          ) : (
            <span>Geen buurten binnen deze selectie op de kaart.</span>
          )}
        </div>
        <div className="bd-map-key">
          <i aria-hidden="true" /> Buiten selectie / onbekend
        </div>
        <p>Selecteer een buurt op de kaart of gebruik de buurtenlijst.</p>
      </figcaption>
    </figure>
  );
}
