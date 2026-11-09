import { useState } from "react";
import { Filter, Search, X } from "lucide-react";
import {
  format,
  labels,
  medianValue,
  metricValue,
  rangeError,
  themes,
  themeLabels,
  themeMetrics,
  units,
  type Metric,
  type Neighborhood,
  type RangeFilter,
  type Snapshot,
} from "./model";

export function MetricOptions({ exclude }: { exclude?: Metric }) {
  return themes.map((theme) => (
    <optgroup key={theme} label={themeLabels[theme]}>
      {themeMetrics[theme]
        .filter((m) => m !== exclude)
        .map((m) => (
          <option key={m} value={m}>
            {labels[m]}
          </option>
        ))}
    </optgroup>
  ));
}
export function HousingFilters({
  all,
  query,
  setQuery,
  minimum,
  setMinimum,
  ranges,
  setRanges,
  knownOnly,
  setKnownOnly,
  metric,
  reset,
  count,
  rows,
  choose,
}: {
  all: Neighborhood[];
  query: string;
  setQuery: (value: string) => void;
  minimum: number;
  setMinimum: (value: number) => void;
  ranges: RangeFilter[];
  setRanges: (value: RangeFilter[]) => void;
  knownOnly: boolean;
  setKnownOnly: (value: boolean) => void;
  metric: Metric;
  reset: () => void;
  count: number;
  rows: Neighborhood[];
  choose: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = ranges.filter((f) => f.min.trim() || f.max.trim());
  const add = () => {
    const next = themeMetrics.value
      .concat(
        ...themes.filter((t) => t !== "value").map((t) => themeMetrics[t]),
      )
      .find((m) => !ranges.some((f) => f.metric === m));
    if (next) {
      setRanges([...ranges, { metric: next, min: "", max: "" }]);
      setOpen(true);
    }
  };
  const update = (index: number, patch: Partial<RangeFilter>) =>
    setRanges(
      ranges.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  const preset = (values: RangeFilter[]) => {
    setRanges(values);
    setOpen(true);
  };
  return (
    <section className="hs-discovery" aria-label="Buurtfilters">
      <div className="hs-discovery-top">
        <div>
          <span className="hs-eyebrow">VIND EEN BUURT DIE BIJ JE PAST</span>
          <h2>Verken op jouw voorwaarden</h2>
        </div>
        <span className="hs-result-count" role="status">
          {count} {count === 1 ? "buurt" : "buurten"} in beeld
        </span>
      </div>
      <div className="hs-search-row">
        <label className="hs-search">
          <Search size={16} />
          <input
            aria-label="Zoek buurt"
            placeholder="Zoek een buurt of buurtcode…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && rows.length === 1) {
                e.preventDefault();
                choose(rows[0].properties.code);
              }
            }}
          />
        </label>
        <label>
          Minimaal woningen
          <select
            aria-label="Minimaal woningen"
            value={minimum}
            onChange={(e) => setMinimum(Number(e.target.value))}
          >
            <option value={0}>Alle buurten</option>
            <option value={20}>20 woningen</option>
            <option value={100}>100 woningen</option>
            <option value={500}>500 woningen</option>
          </select>
        </label>
        <button
          className="an-button"
          aria-expanded={open}
          aria-controls="housing-ranges"
          onClick={() => setOpen(!open)}
        >
          <Filter size={15} />
          Filters{active.length ? ` (${active.length})` : " combineren"}
        </button>
      </div>
      {query.trim() && (
        <div className="hs-search-results" aria-label="Gevonden buurten">
          <p>
            {rows.length
              ? `${Math.min(rows.length, 5)} van ${rows.length} zoekresultaten${rows.length === 1 ? " · druk op Enter om te openen" : ""}`
              : "Geen buurten binnen deze filters. Pas je zoekopdracht of voorwaarden aan."}
          </p>
          {rows.slice(0, 5).map((row) => (
            <button
              key={row.properties.code}
              onClick={() => choose(row.properties.code)}
              aria-label={`Bekijk buurt ${row.properties.name}`}
            >
              <strong>{row.properties.name}</strong>
              <span>
                {format(row.properties.woz, "woz")} ·{" "}
                {row.properties.homes?.toLocaleString("nl-NL") ?? "—"} woningen
              </span>
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      )}
      <div className="hs-presets" aria-label="Snelle filters">
        <span>Begin bijvoorbeeld met</span>
        <button
          onClick={() =>
            preset([
              {
                metric: "woz",
                min: "",
                max: String(medianValue(all, "woz") ?? ""),
              },
            ])
          }
        >
          WOZ onder stadsmediaan
        </button>
        <button
          onClick={() => preset([{ metric: "newBuild", min: "50", max: "" }])}
        >
          Veel recente bouw
        </button>
        <button
          onClick={() =>
            preset([
              { metric: "supermarket", min: "", max: "0.5" },
              { metric: "school", min: "", max: "0.5" },
              { metric: "gp", min: "", max: "1" },
            ])
          }
        >
          Voorzieningen dichtbij
        </button>
        <button
          onClick={() => preset([{ metric: "gas", min: "", max: "500" }])}
        >
          Lager gasverbruik
        </button>
      </div>
      {open && (
        <div id="housing-ranges" className="hs-range-panel">
          <p>
            Combineer voorwaarden. Alle voorwaarden moeten gelden; buurten met
            een ontbrekende filterwaarde vallen af. Gebruik bijvoorbeeld 500.000
            voor vijfhonderdduizend en 0,5 voor een halve eenheid.
          </p>
          {ranges.map((filter, index) => (
            <div className="hs-range" key={index}>
              <label>
                Kenmerk
                <select
                  aria-label={`Filter ${index + 1} kenmerk`}
                  value={filter.metric}
                  onChange={(e) =>
                    update(index, { metric: e.target.value as Metric })
                  }
                >
                  <MetricOptions />
                </select>
              </label>
              <label>
                Van ({units[filter.metric]})
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={`Filter ${index + 1} minimum`}
                  value={filter.min}
                  placeholder="Geen minimum"
                  onChange={(e) => update(index, { min: e.target.value })}
                  aria-invalid={!!rangeError(filter)}
                />
              </label>
              <label>
                Tot ({units[filter.metric]})
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={`Filter ${index + 1} maximum`}
                  value={filter.max}
                  placeholder="Geen maximum"
                  onChange={(e) => update(index, { max: e.target.value })}
                  aria-invalid={!!rangeError(filter)}
                />
              </label>
              <button
                className="an-icon"
                aria-label={`Filter ${index + 1} verwijderen`}
                onClick={() => setRanges(ranges.filter((_, i) => i !== index))}
              >
                <X size={16} />
              </button>
              {rangeError(filter) && (
                <p className="hs-filter-error" role="alert">
                  {rangeError(filter)}
                </p>
              )}
            </div>
          ))}
          <div className="hs-range-actions">
            <button
              className="an-button"
              onClick={add}
              disabled={ranges.length >= 10}
            >
              + Voorwaarde toevoegen
            </button>
            <label className="hs-check">
              <input
                type="checkbox"
                checked={knownOnly}
                onChange={(e) => setKnownOnly(e.target.checked)}
              />
              Alleen buurten met bekende{" "}
              {labels[metric].toLocaleLowerCase("nl")}
            </label>
          </div>
        </div>
      )}
      {!!(active.length || query || minimum !== 100 || knownOnly) && (
        <div className="hs-active-filters" aria-label="Actieve filters">
          {active.map((f) => (
            <button
              key={ranges.indexOf(f)}
              onClick={() => setRanges(ranges.filter((row) => row !== f))}
            >
              {labels[f.metric]}: {f.min || "…"} – {f.max || "…"}{" "}
              {units[f.metric]} <X size={12} />
            </button>
          ))}
          {knownOnly && (
            <button onClick={() => setKnownOnly(false)}>
              Bekende kaartwaarde <X size={12} />
            </button>
          )}
          <button className="hs-clear" onClick={reset}>
            Alle filters wissen
          </button>
        </div>
      )}
    </section>
  );
}

export function NeighborhoodProfile({
  area,
  all,
  meta,
  metric,
}: {
  area: Neighborhood;
  all: Neighborhood[];
  meta?: Snapshot["meta"];
  metric: Metric;
}) {
  const value = metricValue(area, metric),
    city = medianValue(all, metric);
  return (
    <section className="hs-profile" aria-label="Buurtprofiel">
      <div className="hs-current-metric">
        <span>{labels[metric]}</span>
        <strong>{format(value, metric)}</strong>
        <small>
          Stadsmediaan: {format(city, metric)} · elke buurt even zwaar
        </small>
      </div>
      <WozHistory area={area} />
      {themes.map((theme) => (
        <details
          className="hs-profile-group"
          key={`${area.properties.code}-${theme}-${themeMetrics[theme].includes(metric)}`}
          open={themeMetrics[theme].includes(metric)}
        >
          <summary>
            {themeLabels[theme]}
            <span>
              {
                themeMetrics[theme].filter((m) => metricValue(area, m) !== null)
                  .length
              }
              /{themeMetrics[theme].length}
            </span>
          </summary>
          <dl className="hs-details">
            {themeMetrics[theme].map((m) => (
              <div key={m}>
                <dt>
                  {labels[m]}
                  {meta?.indicators?.[m] && (
                    <small>CBS {meta.indicators[m]!.year}</small>
                  )}
                </dt>
                <dd>{format(metricValue(area, m), m)}</dd>
              </div>
            ))}
          </dl>
          <details className="hs-definitions">
            <summary>Definities & aandachtspunten</summary>
            {themeMetrics[theme].map(
              (m) =>
                meta?.indicators?.[m] && (
                  <p key={m}>
                    <b>{labels[m]}.</b> {meta.indicators[m]!.description}
                  </p>
                ),
            )}
          </details>
        </details>
      ))}
      <p className="hs-note">
        Dit zijn buurtcijfers. Opleidingsniveau en inkomen beschrijven groepen
        bewoners en zeggen niets over een individueel adres.
      </p>
    </section>
  );
}

function WozHistory({ area }: { area: Neighborhood }) {
  const history = area.properties.wozHistory ?? [],
    valid = history.filter((p) => p.value !== null && p.comparable);
  if (!history.length) return null;
  const max = Math.max(1, ...valid.map((p) => p.value!));
  return (
    <figure className="hs-history" aria-label="WOZ-ontwikkeling per CBS-jaar">
      <figcaption>Gemiddelde WOZ door de jaren</figcaption>
      <div className="hs-history-bars">
        {history.map((p) => (
          <div key={p.year}>
            <span>{p.year}</span>
            <div className="hs-history-track">
              {p.comparable && p.value !== null && (
                <i style={{ width: `${(p.value / max) * 100}%` }} />
              )}
            </div>
            <strong>
              {p.comparable ? format(p.value, "woz") : "Niet vergelijkbaar"}
            </strong>
          </div>
        ))}
      </div>
      <p>
        Ontwikkeling 2024 → 2025:{" "}
        <b>{format(metricValue(area, "wozChange"), "wozChange")}</b>
      </p>
      <small>
        CBS-jaar; waardepeildatum telkens 1 januari van het vorige jaar.
        Gewijzigde grenzen of ontbrekende cijfers onderbreken de reeks. Geen
        prijsstijging van hetzelfde huis.
      </small>
    </figure>
  );
}
