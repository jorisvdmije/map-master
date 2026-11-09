import type { Dispatch, SetStateAction } from "react";
import {
  euro,
  percent,
  number,
  valueAt,
  type Comparison,
  type Filters,
} from "./model";

export function DevelopmentControls({
  years,
  filters,
  update,
  inputRef,
}: {
  years: number[];
  filters: Filters;
  update: (patch: Partial<Filters>) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <section
      className="bd-controls"
      aria-label="Periode en vergelijkingsfilters"
    >
      <div className="bd-period">
        <label>
          Van bronjaar
          <select
            aria-label="Van bronjaar"
            value={filters.start}
            onChange={(e) => update({ start: Number(e.target.value) })}
          >
            {years.map((year) => (
              <option key={year} disabled={year >= filters.end} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        <span aria-hidden="true">→</span>
        <label>
          Tot bronjaar
          <select
            aria-label="Tot bronjaar"
            value={filters.end}
            onChange={(e) => update({ end: Number(e.target.value) })}
          >
            {years.map((year) => (
              <option key={year} disabled={year <= filters.start} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        <div className="bd-presets" aria-label="Snelle periodekeuze">
          {[1, 5, 10].map((length) => (
            <button
              key={length}
              aria-pressed={
                filters.end === years.at(-1) &&
                filters.start === years.at(-1)! - length
              }
              disabled={!years.includes(years.at(-1)! - length)}
              onClick={() =>
                update({ start: years.at(-1)! - length, end: years.at(-1)! })
              }
            >
              {length} jaar
            </button>
          ))}
          <button
            aria-pressed={
              filters.start === years[0] && filters.end === years.at(-1)
            }
            onClick={() => update({ start: years[0], end: years.at(-1)! })}
          >
            Hele reeks
          </button>
        </div>
      </div>
      <div className="bd-filter-grid">
        <label className="bd-search">
          Zoek je buurt
          <input
            ref={inputRef}
            type="search"
            aria-label="Zoek je buurt"
            placeholder="Buurtnaam of code…"
            value={filters.query}
            onChange={(e) => update({ query: e.target.value })}
          />
        </label>
        <label>
          Minimaal woningen
          <select
            aria-label="Minimaal woningen"
            value={filters.minimum}
            onChange={(e) => update({ minimum: Number(e.target.value) })}
          >
            {[0, 20, 100, 500].map((minimum) => (
              <option key={minimum} value={minimum}>
                {minimum === 0
                  ? "Alle aantallen"
                  : `${minimum} in begin- en eindjaar`}
              </option>
            ))}
          </select>
        </label>
        <div className="bd-stock-filter">
          <label className="bd-checkbox">
            <input
              type="checkbox"
              checked={filters.stockFilter}
              onChange={(e) => update({ stockFilter: e.target.checked })}
            />
            Beperk nieuwbouweffect
          </label>
          <label>
            Max. voorraadverandering
            <select
              aria-label="Maximale voorraadverandering"
              value={filters.maxStockChange}
              disabled={!filters.stockFilter}
              onChange={(e) =>
                update({ maxStockChange: Number(e.target.value) })
              }
            >
              {[10, 20, 50, 100].map((threshold) => (
                <option key={threshold} value={threshold}>
                  ±{threshold}% t.o.v. beginjaar
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <p className="bd-note">
        WOZ-bronjaren {filters.start}–{filters.end}: waardepeildata 1 januari{" "}
        {filters.start - 1} en {filters.end - 1}. Het voorraadfilter controleert
        elk tussenjaar; ook sloop en transformatie beïnvloeden het gemiddelde.
      </p>
    </section>
  );
}

export function DevelopmentRanking({
  rows,
  filters,
  selected,
  choose,
  ascending,
  setAscending,
  limit,
  setLimit,
}: {
  rows: Comparison[];
  filters: Filters;
  selected: string;
  choose: (code: string) => void;
  ascending: boolean;
  setAscending: Dispatch<SetStateAction<boolean>>;
  limit: number;
  setLimit: Dispatch<SetStateAction<number>>;
}) {
  return (
    <section
      className="bd-card bd-ranking"
      aria-labelledby="development-ranking"
    >
      <div className="bd-section-head">
        <div>
          <span className="bd-eyebrow">BUURTEN NAAST ELKAAR</span>
          <h2 id="development-ranking">Welke buurt veranderde het meest?</h2>
        </div>
        <button
          className="bd-button"
          onClick={() => setAscending((value) => !value)}
        >
          {ascending
            ? "Laagste verandering eerst"
            : "Hoogste verandering eerst"}{" "}
          ↕
        </button>
      </div>
      <p className="bd-note">
        Verandering van het gemiddelde per woning, {filters.start}–{filters.end}
        . Selecteer een buurt voor de volledige tijdlijn.
      </p>
      {rows.length ? (
        <>
          <div
            className="bd-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Groeiranglijst"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Buurt</th>
                  <th scope="col">WOZ {filters.start}</th>
                  <th scope="col">WOZ {filters.end}</th>
                  <th
                    scope="col"
                    aria-sort={ascending ? "ascending" : "descending"}
                  >
                    Verandering
                  </th>
                  <th scope="col">Voorraad {filters.end}</th>
                  <th scope="col">Voorraad Δ</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((row) => (
                  <tr
                    key={row.area.code}
                    data-selected={row.area.code === selected}
                    data-code={row.area.code}
                  >
                    <th scope="row">
                      <button
                        aria-pressed={selected === row.area.code}
                        onClick={() => choose(row.area.code)}
                      >
                        {row.area.name}
                      </button>
                      <small>{row.area.code}</small>
                    </th>
                    <td>{euro(row.startValue)}</td>
                    <td>{euro(row.endValue)}</td>
                    <td className="bd-growth">{percent(row.growth)}</td>
                    <td>{number(valueAt(row.area.homes, filters.end))}</td>
                    <td>{percent(row.stockChange)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bd-table-actions">
            <span>
              {Math.min(limit, rows.length)} van {rows.length} buurten
            </span>
            {limit < rows.length && (
              <button
                className="bd-button"
                onClick={() => setLimit((value) => value + 50)}
              >
                Meer buurten tonen
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="bd-empty">
          <h3>Geen buurten binnen deze selectie</h3>
          <p>Pas de zoekopdracht, periode of voorraadfilters aan.</p>
        </div>
      )}
    </section>
  );
}
