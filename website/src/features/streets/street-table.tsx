import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import {
  labels,
  metrics,
  scoreColor,
  units,
  formatValue,
  highIsMore,
  windowTotal,
  type Metric,
  type Street,
} from "./model";
import { number } from "./format";

const rankMetric = (a: Street, b: Street, metric: Metric) =>
  a[metric] === null
    ? b[metric] === null
      ? a.id.localeCompare(b.id)
      : 1
    : b[metric] === null
      ? -1
      : (highIsMore[metric]
          ? a[metric]! - b[metric]!
          : b[metric]! - a[metric]!) || a.name.localeCompare(b.name);

export function StreetTable({
  streets,
  metric,
  select,
  selected,
}: {
  streets: Street[];
  metric: Metric;
  select: (id: string) => void;
  selected: string | null;
}) {
  const [paging, setPaging] = useState({ streets, metric, page: 0 });
  const page =
    paging.streets === streets && paging.metric === metric
      ? Math.min(paging.page, Math.max(0, Math.ceil(streets.length / 30) - 1))
      : 0;
  const ranked = useMemo(
    () => [...streets].sort((a, b) => rankMetric(a, b, metric)),
    [streets, metric],
  );
  return (
    <section className="st-table-card" aria-label="Straten in de selectie">
      <div className="st-table-title">
        <div>
          <h2>Van inzicht naar inspectie</h2>
          <p>
            Eén rij per straat · {highIsMore[metric] ? "laagste" : "hoogste"}{" "}
            {labels[metric].toLocaleLowerCase("nl")} eerst · indicatieve klassen
          </p>
        </div>
        <span>{number(streets.length)} straten</span>
      </div>
      <div className="st-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Straat</th>
              {metrics.map((m) => (
                <th
                  key={m}
                  aria-sort={
                    m === metric
                      ? highIsMore[metric]
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  {labels[m]}
                  <small>{units[m]}</small>
                </th>
              ))}
              <th>Gekoppelde registraties</th>
            </tr>
          </thead>
          <tbody>
            {ranked.slice(page * 30, (page + 1) * 30).map((s) => (
              <tr
                key={s.id}
                className={selected === s.id ? "st-row-selected" : ""}
              >
                <td>
                  <button
                    aria-label={`Bekijk ${s.name}${s.named ? "" : ` ${s.id}`}`}
                    onClick={() => select(s.id)}
                  >
                    <strong>{s.name}</strong>
                    <small>
                      {s.count} wegvakken · {number(s.length)} m NWB
                    </small>
                  </button>
                </td>
                {metrics.map((m) => (
                  <td key={m}>
                    <span className="st-score-pill">
                      <i style={{ background: scoreColor(s[m], m) }} />
                      {formatValue(s[m], m)}
                    </span>
                  </td>
                ))}
                <td>
                  {s.raw.lights} lichtobjecten · {s.raw.trees} bomen
                  <small>
                    {windowTotal(s.raw.reports, s.months)} meldingen ·{" "}
                    {s.months} maanden
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!streets.length && (
          <div className="st-empty">
            <Search size={24} />
            <strong>Geen straten gevonden</strong>
            <span>Pas je zoekopdracht of filters aan.</span>
          </div>
        )}
      </div>
      <div className="st-table-pagination">
        <span>
          {streets.length
            ? `${page * 30 + 1}–${Math.min((page + 1) * 30, streets.length)}`
            : "0"}{" "}
          van {number(streets.length)} · echte registraties, afgeleide
          indicatoren
        </span>
        <div>
          <button
            aria-label="Vorige straten"
            disabled={!page}
            onClick={() => setPaging({ streets, metric, page: page - 1 })}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            aria-label="Volgende straten"
            disabled={(page + 1) * 30 >= streets.length}
            onClick={() => setPaging({ streets, metric, page: page + 1 })}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </section>
  );
}
