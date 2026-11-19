import { dataSwatch } from "@/components/workspaces/data-swatch";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Focus, Route, X } from "lucide-react";
import { niceAxis } from "@/lib/scales";
import {
  metricDetail,
  labels,
  metrics,
  scoreColor,
  observationMeta,
  units,
  formatValue,
  highIsMore,
  windowTotal,
  attentionCount,
  wardNames,
  type Metric,
  type Street,
} from "./model";
import { number } from "./format";

export function StreetDetail({
  street,
  metric,
  cluster,
  clear,
  zoom,
  showSegments,
  toggleSegments,
  segment,
  selectSegment,
  scoped,
}: {
  street: Street;
  metric: Metric;
  cluster?: number;
  clear: () => void;
  zoom: () => void;
  showSegments: boolean;
  toggleSegments: () => void;
  segment: string | null;
  selectSegment: (id: string) => void;
  scoped: boolean;
}) {
  const [page, setPage] = useState(0);
  const detail = metricDetail(street.roads, metric),
    selectedRoad = street.roads.find((r) => r.id === segment);
  const ranked = useMemo(
    () =>
      [...street.roads].sort((a, b) =>
        a[metric] === null
          ? 1
          : b[metric] === null
            ? -1
            : highIsMore[metric]
              ? a[metric]! - b[metric]!
              : b[metric]! - a[metric]!,
      ),
    [street, metric],
  );
  const total = windowTotal(street.raw.reports, street.months),
    nuisance = windowTotal(street.raw.nuisance, street.months);
  const notes = {
    outages: `${street.raw.faults} storingen / ${street.raw.known} bekende statussen`,
    lightDensity: `${street.raw.lights} gekoppelde lichtobjecten`,
    treeDensity: `${street.raw.trees} gekoppelde bomen`,
    reports: `${total} meldingen in ${street.months} maanden`,
    nuisance: `${nuisance} overlastmeldingen in ${street.months} maanden`,
  };
  return (
    <section className="st-detail" aria-label="Geselecteerde straat">
      <div className="st-detail-heading">
        <div>
          <span className="st-kicker">
            ECHTE REGISTRATIES · AFGELEIDE STRAATINDICATOREN
          </span>
          <h2>{street.name}</h2>
          <p>
            {street.wards.map((w) => wardNames.get(w)).join(" / ")} ·{" "}
            {street.count} wegvakken · {number(street.length)} m NWB
            {cluster !== undefined
              ? ` · Profiel ${cluster + 1}`
              : " · Geen profiel (o.a. straten <100 m)"}
          </p>
        </div>
        <button
          className="an-icon"
          aria-label="Deselecteer straat"
          onClick={clear}
        >
          <X size={16} />
        </button>
      </div>
      <div className="st-detail-scores">
        {metrics.map((m) => (
          <div key={m}>
            <span>{labels[m]}</span>
            <b data-swatch style={dataSwatch(scoreColor(street[m], m))}>
              {formatValue(street[m], m)}
            </b>
            <small>{units[m]}</small>
            <p>{notes[m]}</p>
          </div>
        ))}
      </div>
      <div className="st-spread" aria-label={`Spreiding ${labels[metric]}`}>
        <div>
          <span>Lokale min–max</span>
          <strong>
            {formatValue(detail.min, metric)} –{" "}
            {formatValue(detail.max, metric)}
          </strong>
          <small>
            {units[metric]} · {detail.count}/{street.count} berekenbare
            wegvakken
          </small>
        </div>
        <div>
          <span>Onderhoudsmeldingen</span>
          <strong>{windowTotal(street.raw.maintenance, street.months)}</strong>
          <small>
            wegen, verkeer en straatmeubilair · onderdeel van totaal
          </small>
        </div>
        <div>
          <span>Bekende objectstatus</span>
          <strong>
            {street.raw.known} / {street.raw.lights}
          </strong>
          <small>storingspercentage pas vanaf 5 bekende statussen</small>
        </div>
      </div>
      <p className="st-muted">
        {scoped
          ? "Dit zijn de gekoppelde registraties bij het straatdeel in je gekozen wijk."
          : "Dit omvat de hele straatnaam, ook over wijkgrenzen."}{" "}
        Aantallen zijn eerst opgeteld, daarna gedeeld door de noemer. Bronlengte
        telt parallelle rijbanen apart. Nul gekoppelde registraties bewijst geen
        afwezigheid; de koppeling gebruikt maximaal 30 m afstand en laat
        twijfelgevallen weg.
      </p>
      {attentionCount(street) >= 2 && (
        <p className="st-detail-warning">
          Deze straat overschrijdt {attentionCount(street)} indicatieve
          aandachtgrenzen. Bekijk de bronaantallen en lokale verschillen voordat
          je een inspectie plant.
        </p>
      )}
      <MonthlyChart street={street} />
      <div className="st-detail-actions">
        <button
          className="an-button"
          aria-expanded={showSegments}
          onClick={toggleSegments}
        >
          <Route size={14} />
          {showSegments
            ? "Verberg wegvakken"
            : `Bekijk ${street.count} wegvakken`}
        </button>
        <button className="st-text-button" onClick={zoom}>
          <Focus size={14} />
          Zoom naar straat
        </button>
      </div>
      {showSegments && (
        <div className="st-segment-detail">
          <p className="st-muted">
            Oorspronkelijke NWB-lijnen met nabij gekoppelde registraties. Zeer
            korte wegvakken kunnen extreme dichtheden hebben. Je kaartpositie
            blijft staan.
          </p>
          <div className="st-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Wegvak</th>
                  <th>Type</th>
                  <th>
                    {labels[metric]} ({units[metric]})
                  </th>
                  <th>Lengte</th>
                </tr>
              </thead>
              <tbody>
                {ranked.slice(page * 20, (page + 1) * 20).map((r) => (
                  <tr
                    key={r.id}
                    className={segment === r.id ? "st-row-selected" : ""}
                  >
                    <td>
                      <button
                        aria-pressed={segment === r.id}
                        onClick={() => selectSegment(r.id)}
                      >
                        NWB {r.id}
                      </button>
                    </td>
                    <td>{r.kind}</td>
                    <td
                      data-swatch
                      style={dataSwatch(scoreColor(r[metric], metric))}
                    >
                      {formatValue(r[metric], metric)}
                    </td>
                    <td>{r.length} m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="st-table-pagination">
            <span>
              {page * 20 + 1}–{Math.min((page + 1) * 20, street.count)} van{" "}
              {street.count} wegvakken
            </span>
            <div>
              <button
                aria-label="Vorige straatwegvakken"
                disabled={!page}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                aria-label="Volgende straatwegvakken"
                disabled={(page + 1) * 20 >= street.count}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
          {selectedRoad && (
            <div className="st-segment-scores" aria-label="Geselecteerd wegvak">
              <strong>
                NWB {selectedRoad.id} · {selectedRoad.kind} ·{" "}
                {selectedRoad.length} m
              </strong>
              <p>
                {selectedRoad.raw.lights} lichtobjecten ·{" "}
                {selectedRoad.raw.faults} storingen · {selectedRoad.raw.trees}{" "}
                bomen · {windowTotal(selectedRoad.raw.reports, street.months)}{" "}
                meldingen
              </p>
              <div>
                {metrics.map((m) => (
                  <span key={m}>
                    {labels[m]}{" "}
                    <b
                      data-swatch
                      style={dataSwatch(scoreColor(selectedRoad[m], m))}
                    >
                      {formatValue(selectedRoad[m], m)} {units[m]}
                    </b>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
function MonthlyChart({ street }: { street: Street }) {
  const axis = niceAxis(0, Math.max(1, ...street.raw.reports), {
    zero: true,
    integer: true,
    count: 3,
  });
  const maximum = axis.max;
  return (
    <div className="st-monthly">
      <h3>Meldingen per maand</h3>
      <p className="st-muted">
        Totaal (groen), waarvan overlast (oranje). Gedimde maanden vallen buiten
        de gekozen periode. Verschillen kunnen ook komen door meldingsbereidheid
        of wijzigingen in registratie.
      </p>
      <svg
        viewBox="0 0 600 150"
        role="img"
        aria-label={`Meldingen per maand voor ${street.name}; ${windowTotal(street.raw.reports, street.months)} in de geselecteerde periode. De maandcijfers staan ook in de uitklapbare tabel.`}
      >
        {axis.ticks.map((value) => (
          <g key={value}>
            <line
              x1="28"
              x2="600"
              y1={120 - (value / maximum) * 100}
              y2={120 - (value / maximum) * 100}
              stroke={value === 0 ? "#d7e1d0" : "#edf1e9"}
            />
            <text x="22" y={124 - (value / maximum) * 100} textAnchor="end">
              {value}
            </text>
          </g>
        ))}
        {observationMeta.months.map((month, i) => (
          <g key={month} opacity={i < 12 - street.months ? 0.3 : 1}>
            <rect
              x={34 + i * 47}
              y={120 - (street.raw.reports[i]! / maximum) * 100}
              width="26"
              height={(street.raw.reports[i]! / maximum) * 100}
              rx="2"
              fill="#6c9d7d"
            />
            <rect
              x={34 + i * 47}
              y={120 - (street.raw.nuisance[i]! / maximum) * 100}
              width="26"
              height={(street.raw.nuisance[i]! / maximum) * 100}
              rx="2"
              fill="#d59c56"
            />
            <text x={47 + i * 47} y="140" textAnchor="middle">
              {month.slice(5)}/{month.slice(2, 4)}
            </text>
          </g>
        ))}
      </svg>
      <details>
        <summary>Bekijk de maandcijfers</summary>
        <div className="st-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Maand</th>
                <th>Alle meldingen</th>
                <th>Waarvan overlast</th>
                <th>Waarvan wegonderhoud</th>
              </tr>
            </thead>
            <tbody>
              {observationMeta.months.map((month, i) => (
                <tr key={month}>
                  <td>{month}</td>
                  <td>{street.raw.reports[i]}</td>
                  <td>{street.raw.nuisance[i]}</td>
                  <td>{street.raw.maintenance[i]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
