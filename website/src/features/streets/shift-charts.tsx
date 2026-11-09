"use client";
import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { download } from "@/features/playground/project";
import { observationMeta } from "./model";
import {
  rankShifts,
  shiftLabels,
  shiftReasons,
  shiftsCSV,
  type ShiftRow,
  type ShiftSettings,
  type shiftAnalysis,
} from "./shifts";

type Result = ReturnType<typeof shiftAnalysis>;
const n = (value: number | null, digits = 0) =>
  value === null
    ? "—"
    : value.toLocaleString("nl-NL", { maximumFractionDigits: digits });
const signed = (value: number | null, digits = 0) =>
  value === null ? "—" : `${value > 0 ? "+" : ""}${n(value, digits)}`;
const period = (start: number, end: number) =>
  `${observationMeta.months[start]} t/m ${observationMeta.months[end]}`;

export function ShiftPanel({
  result,
  settings,
  setSettings,
  selected,
  select,
}: {
  result: Result;
  settings: ShiftSettings;
  setSettings: (settings: ShiftSettings) => void;
  selected: string | null;
  select: (id: string) => void;
}) {
  const ranking = useMemo(
    () => rankShifts(result.rows, settings),
    [result.rows, settings],
  );
  return (
    <>
      <div className="st-card-heading">
        <span className="st-kicker">DE VERSCHUIVINGSRADAR</span>
        <h2>Wat verandert er lokaal?</h2>
        <p>
          Ontdek straten die afwijken van hun eerdere meldingspatroon, met de
          ontwikkeling in de rest van Amsterdam als referentie.
        </p>
      </div>
      <label className="st-field">
        Onderwerp
        <select
          aria-label="Onderwerp verschuivingsradar"
          value={settings.kind}
          onChange={(e) =>
            setSettings({
              ...settings,
              kind: e.target.value as ShiftSettings["kind"],
            })
          }
        >
          {Object.entries(shiftLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="st-fields st-shift-fields">
        <label>
          Richting
          <select
            aria-label="Richting verschuiving"
            value={settings.direction}
            onChange={(e) =>
              setSettings({
                ...settings,
                direction: e.target.value as ShiftSettings["direction"],
              })
            }
          >
            <option value="up">Meer dan referentie</option>
            <option value="down">Minder dan referentie</option>
            <option value="all">Beide richtingen</option>
          </select>
        </label>
        <label>
          Min. jaartotaal
          <select
            aria-label="Minimaal jaartotaal verschuiving"
            value={settings.minimum}
            onChange={(e) =>
              setSettings({ ...settings, minimum: +e.target.value })
            }
          >
            {[10, 30, 100].map((v) => (
              <option key={v} value={v}>
                {v} meldingen
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="st-field">
        Rangschik op
        <select
          aria-label="Rangschik verschuivingen"
          value={settings.sort}
          onChange={(e) =>
            setSettings({
              ...settings,
              sort: e.target.value as ShiftSettings["sort"],
            })
          }
        >
          <option value="count">Verschil in aantallen</option>
          <option value="relative">Relatief verschil (%)</option>
        </select>
      </label>
      <p className="st-side-explanation">
        Vaste vergelijking: laatste 3 volledige maanden ({period(9, 11)})
        tegenover de eerdere 9 ({period(0, 8)}). Het periodefilter links
        verandert deze vensters niet. Straatfilters bepalen welke benoemde
        straten je onderzoekt; bij een wijkfilter alleen het toegewezen
        straatdeel.
      </p>
      <button
        className="an-button st-wide"
        onClick={() =>
          document
            .getElementById("street-shifts")
            ?.scrollIntoView({ block: "start", behavior: "auto" })
        }
      >
        Bekijk de maandgrafiek <ArrowUpRight size={13} />
      </button>
      <div className="st-shift-coverage">
        <strong>{n(result.eligible.length)} rangschikbare straten</strong>
        <span>
          {n(result.excluded)} met beperkte basis · {n(ranking.length)} in deze
          richting
        </span>
      </div>
      <div className="st-shift-ranking" aria-label="Opvallende verschuivingen">
        {ranking.slice(0, 10).map((r, i) => (
          <button
            key={r.id}
            aria-pressed={selected === r.id}
            onClick={() => select(r.id)}
          >
            <span>
              <small>{i + 1}</small>
              <strong>{r.name}</strong>
              <b className={r.excess! > 0 ? "st-shift-up" : "st-shift-down"}>
                {settings.sort === "relative"
                  ? `${signed(r.relative, 0)}%`
                  : signed(r.excess, 1)}
              </b>
            </span>
            <em>
              {r.recent} recent · referentie {n(r.expected, 1)} ·{" "}
              {signed(r.relative, 0)}%
            </em>
          </button>
        ))}
      </div>
      {!ranking.length && (
        <p className="st-muted">
          Geen straten voldoen aan deze richting en ondergrens. Kies beide
          richtingen, een lagere ondergrens of ruimere straatfilters.
        </p>
      )}
      <details className="st-shift-method">
        <summary>Rekenregel & beperkte basis</summary>
        <p>
          Referentie = eerdere meldingen van de straat × (recente meldingen in
          de rest van de stad / eerdere meldingen in de rest van de stad). De
          straat zelf telt niet mee in de stadsreferentie. Die blijft gelijk bij
          filteren.
        </p>
        <p>
          Voor de ranglijst: minimaal 100 m NWB, 5 eerdere meldingen, 5
          referentiemeldingen en het gekozen jaartotaal. Elke uitgesloten straat
          krijgt hieronder één reden, in deze volgorde:
        </p>
        <ul>
          {result.exclusions.map((item) => (
            <li key={item.reason}>
              {item.label}: <b>{n(item.count)}</b>
            </li>
          ))}
        </ul>
        <p>
          Alle straten, inclusief beperkte basis, blijven beschikbaar in de
          tabel bij de grafiek en in de CSV.
        </p>
      </details>
      <div className="st-caution">
        <b>Een onderzoekssignaal, geen bewezen probleem.</b> Eén jaar data is
        onvoldoende om lokale seizoenen te schatten. Drukte, meldingsbereidheid,
        werkzaamheden en herhaalmeldingen kunnen het beeld veranderen. De
        stadsreferentie corrigeert alleen een gemeenschappelijke ontwikkeling.
        Dit is geen voorspelling of significantietoets.
      </div>
    </>
  );
}

export function ShiftExplorer({
  result,
  settings,
  selected,
  select,
}: {
  result: Result;
  settings: ShiftSettings;
  selected: string | null;
  select: (id: string) => void;
}) {
  const ranked = useMemo(
    () => rankShifts(result.rows, settings),
    [result.rows, settings],
  );
  const row =
    result.rows.find((r) => r.id === selected) ?? ranked[0] ?? result.rows[0];
  const tableRows = useMemo(() => {
    const ids = new Set(ranked.map((r) => r.id));
    return [
      ...ranked,
      ...result.rows
        .filter((r) => !ids.has(r.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ];
  }, [ranked, result.rows]);
  const [paging, setPaging] = useState({ rows: tableRows, page: 0 });
  const page =
    paging.rows === tableRows
      ? Math.min(paging.page, Math.max(0, Math.ceil(tableRows.length / 20) - 1))
      : 0;
  return (
    <section
      className="st-shift-explorer"
      id="street-shifts"
      aria-label="Verschuivingsradar"
    >
      <div className="st-shift-title">
        <div>
          <span className="st-kicker">NIEUW / VERSCHUIVINGSRADAR</span>
          <h2>Een drukke straat, of een nieuwe ontwikkeling?</h2>
          <p>
            Laatste kwartaal naast een referentie uit het eerdere patroon. Kies
            een straat in de ranglijst of de tabel.
          </p>
        </div>
        <button
          className="an-button"
          disabled={!result.rows.length}
          onClick={() =>
            download(
              shiftsCSV(result.rows, settings.kind, settings.minimum),
              "amsterdam-verschuivingsradar.csv",
              "text/csv;charset=utf-8",
            )
          }
        >
          <ArrowDownToLine size={14} />
          CSV
        </button>
      </div>
      <button
        className="st-text-button st-shift-settings-link"
        onClick={() =>
          document
            .getElementById("st-panel-shifts")
            ?.scrollIntoView({ block: "start", behavior: "auto" })
        }
      >
        Onderwerp, richting en ondergrens instellen <ArrowUpRight size={12} />
      </button>
      {row ? (
        <>
          <div className="st-shift-selected">
            <h3>{row.name}</h3>
            <button className="st-text-button" onClick={() => select(row.id)}>
              Selecteer op de kaart <ArrowUpRight size={12} />
            </button>
          </div>
          <div className="st-shift-stats">
            <div>
              <span>Recent · 3 maanden</span>
              <strong>{n(row.recent)}</strong>
              <small>
                {shiftLabels[settings.kind].toLocaleLowerCase("nl")}
              </small>
            </div>
            <div>
              <span>Referentie · zelfde 3 maanden</span>
              <strong>{n(row.expected, 1)}</strong>
              <small>Op basis van eerdere 9 maanden</small>
            </div>
            <div>
              <span>Verschil met referentie</span>
              <strong
                className={
                  row.excess !== null && row.excess > 0
                    ? "st-shift-up"
                    : "st-shift-down"
                }
              >
                {signed(row.excess, 1)}
              </strong>
              <small>
                {row.relative === null
                  ? "Geen relatieve vergelijking mogelijk"
                  : `${signed(row.relative, 0)}% · ${row.aboveMonths}/3 maanden erboven`}
              </small>
            </div>
          </div>
          {row.reason && (
            <p className="st-shift-warning">
              Beperkte basis: {shiftReasons[row.reason].toLocaleLowerCase("nl")}
              . Deze straat staat niet in de ranglijst. De ruwe aantallen
              blijven zichtbaar; het relatieve verschil kan instabiel zijn.
            </p>
          )}
          <MonthlyComparison row={row} />
          <p className="st-shift-note">
            De balken tonen gekoppelde MORA-registraties; de stippellijn toont
            de stadsreferentie, geschaald naar het eerdere aandeel van deze
            straat. Het gekleurde vlak markeert de recente 3 maanden. Geen
            correctie voor lokale seizoenen of dubbeltellingen in de bron.
          </p>
        </>
      ) : (
        <p className="st-muted">
          Geen straten in deze selectie. Wis een straatfilter om veranderingen
          te onderzoeken.
        </p>
      )}
      <details className="st-shift-data">
        <summary>
          Alle {n(tableRows.length)} straten als tabel · inclusief beperkte
          basis
        </summary>
        <p>
          De ranglijst staat eerst. De overige straten staan alfabetisch; de
          gekozen richting verbergt hier geen straten. CSV bevat alle
          maandcijfers, de referentie en uitsluitredenen.
        </p>
        <div className="st-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Straat</th>
                <th>Eerder · 9 mnd</th>
                <th>Recent · 3 mnd</th>
                <th>Referentie</th>
                <th>Verschil</th>
                <th>Basis</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.slice(page * 20, (page + 1) * 20).map((r) => (
                <tr
                  key={r.id}
                  className={selected === r.id ? "st-row-selected" : ""}
                >
                  <td>
                    <button onClick={() => select(r.id)}>{r.name}</button>
                  </td>
                  <td>{r.before}</td>
                  <td>{r.recent}</td>
                  <td>{n(r.expected, 1)}</td>
                  <td>{signed(r.excess, 1)}</td>
                  <td>{r.reason ? shiftReasons[r.reason] : "Rangschikbaar"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="st-table-pagination">
          <span>
            {tableRows.length
              ? `${page * 20 + 1}–${Math.min((page + 1) * 20, tableRows.length)}`
              : 0}{" "}
            van {n(tableRows.length)}
          </span>
          <div>
            <button
              aria-label="Vorige verschuivingen"
              disabled={!page}
              onClick={() => setPaging({ rows: tableRows, page: page - 1 })}
            >
              <ChevronLeft size={15} />
            </button>
            <button
              aria-label="Volgende verschuivingen"
              disabled={(page + 1) * 20 >= tableRows.length}
              onClick={() => setPaging({ rows: tableRows, page: page + 1 })}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </details>
    </section>
  );
}

function MonthlyComparison({ row }: { row: ShiftRow }) {
  const max =
    Math.max(1, ...row.series, ...row.expectedSeries.map((v) => v ?? 0)) * 1.12;
  const plot = (compact: boolean) => {
    const step = compact ? 26 : 47,
      left = compact ? 36 : 44,
      right = left + 12 * step,
      bar = compact ? 14 : 24;
    const px = (i: number) => left + i * step + step / 2,
      py = (v: number) => 202 - (v / max) * 160;
    return (
      <svg
        className={compact ? "st-shift-plot-compact" : "st-shift-plot-wide"}
        viewBox={`0 0 ${compact ? 360 : 640} 244`}
        role="img"
        aria-label={`Maandcijfers ${row.name}. Recent ${row.recent}, referentie ${n(row.expected, 1)}. Alle cijfers staan in de uitklapbare maandtabel.`}
      >
        <rect
          x={left + 9 * step}
          y="28"
          width={3 * step}
          height="174"
          rx="4"
          fill="#f2e6d5"
        />
        <text x={left + 10.5 * step} y="18" textAnchor="middle">
          {compact ? "RECENT" : "RECENT KWARTAAL"}
        </text>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line
              x1={left}
              x2={right}
              y1={py(t * max)}
              y2={py(t * max)}
              stroke="#e1e7de"
            />
            <text x={left - 8} y={py(t * max) + 4} textAnchor="end">
              {n(t * max)}
            </text>
          </g>
        ))}
        {row.series.map((v, i) => (
          <g key={i}>
            <rect
              x={px(i) - bar / 2}
              y={py(v)}
              width={bar}
              height={202 - py(v)}
              rx="2"
              fill={i >= 9 ? "#ad765d" : "#7f9d8f"}
            >
              <title>
                {observationMeta.months[i]}: {v} meldingen
              </title>
            </rect>
            <text x={px(i)} y="221" textAnchor="middle">
              {observationMeta.months[i]!.slice(5)}
            </text>
            {[0, 2].includes(i) && (
              <text x={px(i)} y="238" textAnchor="middle">
                {observationMeta.months[i]!.slice(0, 4)}
              </text>
            )}
          </g>
        ))}
        {row.expected !== null && (
          <polyline
            points={row.expectedSeries
              .map((v, i) => `${px(i)},${py(v!)}`)
              .join(" ")}
            fill="none"
            stroke="#325d68"
            strokeWidth="2"
            strokeDasharray="5 4"
          />
        )}
      </svg>
    );
  };
  return (
    <div className="st-shift-chart">
      <div className="st-shift-chart-key">
        <span>
          <i />
          Werkelijk aantal
        </span>
        <span>
          <em />
          Referentie
        </span>
      </div>
      {plot(false)}
      {plot(true)}
      <details>
        <summary>Maandcijfers en referentie</summary>
        <div className="st-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Maand</th>
                <th>Werkelijk</th>
                <th>Referentie</th>
                <th>Venster</th>
              </tr>
            </thead>
            <tbody>
              {row.series.map((v, i) => (
                <tr key={i}>
                  <td>{observationMeta.months[i]}</td>
                  <td>{v}</td>
                  <td>{n(row.expectedSeries[i]!, 2)}</td>
                  <td>{i < 9 ? "Eerder" : "Recent"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
