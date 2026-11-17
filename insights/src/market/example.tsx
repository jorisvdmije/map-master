import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Database,
  Download,
  Eye,
  EyeOff,
  FlaskConical,
  Info,
  MapPin,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  TrendingUp,
} from "lucide-react";
import type { Dataset } from "../data/model";
import { GeoMap } from "../plots";
import { csvCell, download } from "../workspace";
import { loadMarketData, type MarketData } from "./data";
import {
  analyzeMarket,
  forecastOrigins,
  quarterDate,
  type ModelId,
  type Horizon,
} from "./model";
import { MarketForecastChart, MarketErrorChart } from "./charts";
import { neighborhoodReport } from "./neighborhoods";
import "./market.css";

const modelMeta: Record<
  ModelId,
  { label: string; color: string; description: string }
> = {
  flat: {
    label: "Prijs blijft gelijk",
    color: "#98a1b4",
    description: "De laatst bekende prijsindex blijft gelijk.",
  },
  momentum: {
    label: "Trend doorzetten",
    color: "#d79b54",
    description: "De eerder bekende jaarlijkse groei doorzetten.",
  },
  trend: {
    label: "Markt zonder rente",
    color: "#289e99",
    description: "Eerdere prijsontwikkeling en transactievolume.",
  },
  rates: {
    label: "Rente & markt",
    color: "#7767de",
    description: "Marktkenmerken plus hypotheekrente en renteverandering.",
  },
};
const policies = [
  {
    date: "2022-04-01",
    title: "Opkoopbescherming Amsterdam",
    description:
      "Beleidswijziging voor verhuur na aankoop. De latere O&S-evaluatie benadrukt dat het bredere investeringsklimaat ook meespeelt.",
    url: "https://onderzoek.amsterdam.nl/publicatie/evaluatie-opkoopbescherming-2025",
  },
  {
    date: "2024-07-01",
    title: "Wet betaalbare huur",
    description:
      "Start van de wet, met overgangsregels en uitzonderingen. Hier uitsluitend een contextmarkering; geen schatting van het prijseffect.",
    url: "https://zoek.officielebekendmakingen.nl/stb-2024-197.html",
  },
];
const number = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString("nl-NL", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });
const pct = (v: number | null | undefined) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${number(v)}%`;
const pp = (v: number | null | undefined) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${number(v)} pp`;
const label = (period: string) => period.replace("-Q", " · Q");
const dateLabel = (value: string) =>
  new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
function initialSettings() {
  const p = new URLSearchParams(location.hash.split("?")[1]);
  return {
    origin: /^\d{4}-Q[1-4]$/.test(p.get("origin") ?? "")
      ? p.get("origin")!
      : "2021-Q4",
    horizon: (p.get("h") === "1" ? 1 : 4) as Horizon,
    model: (Object.hasOwn(modelMeta, p.get("model") ?? "")
      ? p.get("model")
      : "rates") as ModelId,
  };
}

export default function MarketExample({
  dataset,
  onBack,
}: {
  dataset: Dataset | null;
  onBack: () => void;
}) {
  const [data, setData] = useState<MarketData | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const [initial] = useState(initialSettings),
    [origin, setOrigin] = useState(initial.origin),
    [horizon, setHorizon] = useState<Horizon>(initial.horizon),
    [model, setModel] = useState<ModelId>(initial.model);
  const [areaSort, setAreaSort] = useState<"high" | "low">("high");
  const [revealed, setRevealed] = useState(false),
    [rateDelta, setRateDelta] = useState(0),
    [compare, setCompare] = useState(true),
    [selected, setSelected] = useState<string[]>([]),
    [areaQuery, setAreaQuery] = useState("");
  const [details, setDetails] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setError("");
    loadMarketData(c.signal)
      .then((value) => {
        const valid = forecastOrigins(value).filter((p) => p >= "2010-Q1");
        setData(value);
        if (!valid.includes(origin))
          setOrigin(valid.includes("2021-Q4") ? "2021-Q4" : valid.at(-1)!);
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setError(e.message || "De marktgegevens konden niet worden geladen.");
      });
    return () => c.abort();
  }, [attempt]);
  useEffect(() => {
    if (!data) return;
    const p = new URLSearchParams({ origin, h: String(horizon), model });
    history.replaceState(
      null,
      "",
      `${location.pathname}${location.search}#woningmarkt?${p}`,
    );
  }, [data, origin, horizon, model]);
  const analysis = useMemo(
    () => (data ? analyzeMarket(data, { origin, horizon, rateDelta }) : null),
    [data, origin, horizon, rateDelta],
  );
  const neighborhood = useMemo(
    () =>
      dataset && analysis
        ? neighborhoodReport(dataset, analysis.originDate)
        : null,
    [dataset, analysis?.originDate],
  );
  const origins = useMemo(
    () => (data ? forecastOrigins(data).filter((p) => p >= "2010-Q1") : []),
    [data],
  );
  const selectedForecast = analysis?.models.find((m) => m.id === model);
  const actual =
    data?.prices.find((p) => p.period === analysis?.targetPeriod)?.value ??
    null;
  const predictions =
    analysis?.models
      .filter((m) => compare || m.id === model)
      .map((m) => ({
        id: m.id,
        label: modelMeta[m.id].label,
        value: m.predictedIndex,
        color: modelMeta[m.id].color,
        ...(m.interval ? { low: m.interval.low, high: m.interval.high } : {}),
      })) ?? [];
  const known = analysis?.knownInputs;
  const historyPoints =
    data && known
      ? data.prices
          .filter(
            (p) =>
              p.availableAt <= analysis!.originDate &&
              p.period <= known.basePeriod,
          )
          .slice(-20)
          .map((p) => ({ period: p.period, value: p.value }))
      : [];
  const futurePoints =
    revealed && data && analysis && known
      ? data.prices
          .filter(
            (p) =>
              p.period > known.basePeriod && p.period <= analysis.targetPeriod,
          )
          .map((p) => ({ period: p.period, value: p.value }))
      : [];
  const errorRows =
    analysis?.backtest.slice(-24).map((r) => ({
      period: r.targetPeriod,
      actual: r.actualGrowth,
      predicted: r.growthPredictions[model],
    })) ?? [];
  const best = analysis
    ? [...analysis.scores]
        .filter((s) => s.n > 0)
        .sort(
          (a, b) => (a.maeGrowthPP ?? Infinity) - (b.maeGrowthPP ?? Infinity),
        )[0]
    : undefined;
  const selectedArea = neighborhood?.rows.find((r) => r.code === selected[0]);
  const colorValues = useMemo(
    () => new Map(neighborhood?.rows.map((r) => [r.code, r.residual]) ?? []),
    [neighborhood],
  );
  const colorLimit = useMemo(() => {
    const values =
      neighborhood?.rows
        .map((r) => Math.abs(r.residual))
        .sort((a, b) => a - b) ?? [];
    return values.length
      ? Math.max(1, values[Math.floor((values.length - 1) * 0.95)])
      : undefined;
  }, [neighborhood]);
  const activeScore = analysis?.scores.find((s) => s.id === model);
  const changeOrigin = (value: string) => {
    setOrigin(value);
    setRevealed(false);
    setRateDelta(0);
    setSelected([]);
    setMessage("");
  };
  const changeHorizon = (value: Horizon) => {
    setHorizon(value);
    setRevealed(false);
    setRateDelta(0);
    setMessage("");
  };
  const chooseArea = (code: string) =>
    setSelected((current) => (current[0] === code ? [] : [code]));
  const exportAnalysis = () => {
    if (!analysis || !data) return;
    download(
      `atlas-woningmarkt-${origin}-${horizon}kw.json`,
      JSON.stringify(
        {
          format: "atlas-market-analysis",
          version: 1,
          origin: analysis.origin,
          informationCutoff: analysis.originDate,
          horizon,
          targetPeriod: analysis.targetPeriod,
          model,
          rateDelta,
          knownInputs: analysis.knownInputs,
          forecasts: analysis.models,
          scores: analysis.scores,
          backtest: analysis.backtest,
          neighborhoods: neighborhood,
          ...(revealed
            ? {
                revealedOutcome: {
                  period: analysis.targetPeriod,
                  index: actual,
                },
              }
            : {}),
          method: {
            availability: data.meta.availability,
            neighborhood: neighborhood?.limitation,
            snapshotRetrievedAt: data.meta.retrievedAt,
            sources: data.meta.sources,
          },
        },
        null,
        2,
      ),
    );
    setMessage(
      "Analyse gedownload. Een verborgen toekomstige uitkomst staat niet in de export.",
    );
  };
  const exportBacktest = () => {
    if (!analysis || !data) return;
    const header = [
      "voorspeldatum",
      "informatiegrens",
      "doelkwartaal",
      "bekende_basis",
      "basisindex",
      "werkelijke_index",
      "werkelijke_groei_pct",
      "voorspelling_index",
      "voorspelde_groei_pct",
      "fout_pp",
      "model",
      "doel_beschikbaar_vanaf",
      "momentopname",
      "beschikbaarheid",
    ];
    const rows = analysis.backtest.map((r) => [
      r.origin,
      r.originDate,
      r.targetPeriod,
      r.basePeriod,
      r.baseIndex,
      r.actualIndex,
      r.actualGrowth,
      r.predictions[model],
      r.growthPredictions[model],
      r.growthPredictions[model] - r.actualGrowth,
      model,
      r.actualAvailableAt,
      data.meta.retrievedAt,
      "gereconstrueerd: periode-einde +60 dagen",
    ]);
    download(
      `atlas-terugtest-${origin}-${model}.csv`,
      "\uFEFF" +
        [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n"),
      "text/csv;charset=utf-8",
    );
  };
  return (
    <main
      className="market-page"
      data-market-example
      data-market-ready={!!analysis}
    >
      <div className="market-heading">
        <div>
          <button className="market-back" onClick={onBack}>
            <ArrowLeft size={13} />
            Terug naar je werkruimte
          </button>
          <div className="market-kicker">
            <span>
              <FlaskConical size={12} />
              VOORBEELDANALYSE
            </span>
            <i />
            AMSTERDAM
          </div>
          <h1>Had je de omslag zien aankomen?</h1>
          <p>
            Reis terug in de woningmarkt. Doe een voorspelling, onthul de
            uitkomst en onderzoek wat het model heeft geleerd.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={!analysis}
          onClick={exportAnalysis}
        >
          <Download size={14} />
          Bewaar analyse
        </button>
      </div>
      {!data || !analysis ? (
        <div className="loading-state">
          {error ? (
            <>
              <Database size={28} />
              <h2>De marktdata konden niet worden geopend</h2>
              <p role="alert">{error}</p>
              <button
                className="button primary"
                onClick={() => setAttempt((a) => a + 1)}
              >
                Marktdata opnieuw proberen
              </button>
            </>
          ) : (
            <>
              <div className="loading-spinner" />
              <h2>De tijdmachine wordt klaargezet</h2>
              <p>Gepubliceerde prijs- en rentereeksen worden geladen.</p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="market-reconstruction">
            <ShieldCheck size={15} />
            <p>
              <strong>Een eerlijke reconstructie.</strong> Huidige historische
              bronversies, met een aangenomen publicatievertraging van 60 dagen.
              Geen archief van alle toenmalige publicaties.
            </p>
            <button
              onClick={() => {
                setDetails(true);
                requestAnimationFrame(() =>
                  document
                    .getElementById("market-method")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                );
              }}
            >
              Zo werkt het <ArrowUpRight size={12} />
            </button>
          </div>
          <section
            className="market-controls"
            aria-label="Instellingen tijdmachine"
          >
            <div className="market-control">
              <label htmlFor="market-origin">
                <CalendarDays size={14} />
                Je staat aan het einde van
              </label>
              <div className="market-origin-row">
                <button
                  className="icon-button"
                  aria-label="Vorig voorspelskwartaal"
                  disabled={origins.indexOf(origin) <= 0}
                  onClick={() =>
                    changeOrigin(origins[origins.indexOf(origin) - 1])
                  }
                >
                  <ArrowLeft size={14} />
                </button>
                <select
                  id="market-origin"
                  aria-label="Voorspeldatum"
                  value={origin}
                  onChange={(e) => changeOrigin(e.target.value)}
                >
                  {origins.map((p) => (
                    <option key={p} value={p}>
                      {label(p)}
                    </option>
                  ))}
                </select>
                <button
                  className="icon-button"
                  aria-label="Volgend voorspelskwartaal"
                  disabled={origins.indexOf(origin) >= origins.length - 1}
                  onClick={() =>
                    changeOrigin(origins[origins.indexOf(origin) + 1])
                  }
                >
                  <ArrowRight size={14} />
                </button>
              </div>
              <small>Informatiegrens {dateLabel(analysis.originDate)}</small>
            </div>
            <div className="market-control">
              <label htmlFor="market-horizon">
                <Clock3 size={14} />
                Kijk vooruit
              </label>
              <select
                id="market-horizon"
                aria-label="Voorspelhorizon"
                value={horizon}
                onChange={(e) =>
                  changeHorizon(Number(e.target.value) as Horizon)
                }
              >
                <option value={1}>1 kwartaal</option>
                <option value={4}>4 kwartalen</option>
              </select>
              <small>Doelperiode {label(analysis.targetPeriod)}</small>
            </div>
            <div className="market-control model-control">
              <label htmlFor="market-model">
                <SlidersHorizontal size={14} />
                Actief model
              </label>
              <select
                id="market-model"
                aria-label="Voorspelmodel"
                value={model}
                onChange={(e) => {
                  setModel(e.target.value as ModelId);
                  setRateDelta(0);
                }}
              >
                {(Object.keys(modelMeta) as ModelId[]).map((id) => (
                  <option key={id} value={id}>
                    {modelMeta[id].label}
                  </option>
                ))}
              </select>
              <small>{modelMeta[model].description}</small>
            </div>
            <div className="market-reveal-control">
              <span className={`market-sealed ${revealed ? "is-open" : ""}`}>
                {revealed ? <Eye size={13} /> : <EyeOff size={13} />}{" "}
                {revealed ? "Uitkomst onthuld" : "De toekomst is afgeschermd"}
              </span>
              <button
                className={`button ${revealed ? "secondary" : "primary"}`}
                aria-label={
                  revealed
                    ? "Verberg werkelijke uitkomst"
                    : "Onthul werkelijke uitkomst"
                }
                disabled={actual === null}
                onClick={() => setRevealed((v) => !v)}
              >
                {revealed ? <EyeOff size={14} /> : <Eye size={14} />}{" "}
                {actual === null
                  ? "Uitkomst nog niet beschikbaar"
                  : revealed
                    ? "Verberg uitkomst"
                    : "Onthul de uitkomst"}
              </button>
            </div>
          </section>
          {message && (
            <p className="market-status" role="status">
              <CheckCircle2 size={14} />
              {message}
            </p>
          )}
          <div className="market-stat-grid">
            <div className="market-stat">
              <span>Laatst bekende prijsindex</span>
              <strong>{number(known?.baseIndex)}</strong>
              <small>
                {known ? label(known.basePeriod) : "—"} · index 2020 = 100
              </small>
            </div>
            <div className="market-stat prediction">
              <span>Voorspelling · {label(analysis.targetPeriod)}</span>
              <strong data-market-prediction-value>
                {number(selectedForecast?.predictedIndex)}
              </strong>
              <small>
                {pct(selectedForecast?.growthFromKnown)} vanaf de laatst bekende
                index
              </small>
            </div>
            <div className="market-stat">
              <span>Bekende hypotheekrente · Nederland</span>
              <strong>
                {number(known?.latestRate, 2)}
                <em>%</em>
              </strong>
              <small>
                {known?.latestRatePeriod ?? "Niet beschikbaar"} · nieuwe
                woningleningen
              </small>
            </div>
            <div className="market-stat outcome">
              <span>
                {revealed ? "Werkelijke prijsindex" : "Toets je verwachting"}
              </span>
              {revealed ? (
                <>
                  <strong data-market-outcome-value>{number(actual)}</strong>
                  <small>
                    {selectedForecast?.predictedIndex != null && actual != null
                      ? `${number(selectedForecast.predictedIndex - actual)} indexpunt voorspellingsfout`
                      : "Geen modeluitkomst beschikbaar"}
                  </small>
                </>
              ) : (
                <>
                  <strong className="market-hidden-value">
                    <EyeOff size={22} />
                    <span>Verborgen</span>
                  </strong>
                  <small>Onthul pas als je voorspelling vaststaat</small>
                </>
              )}
            </div>
          </div>
          {selectedForecast?.reason && (
            <p className="market-model-limitation" role="status">
              <Info size={14} />
              {selectedForecast.reason}
            </p>
          )}
          <div className="market-grid">
            <section className="market-card market-main-chart">
              <header>
                <div className="market-card-icon">
                  <TrendingUp size={17} />
                </div>
                <div>
                  <h2>Voorspellen vanuit het verleden</h2>
                  <p>
                    Amsterdamse prijsindex bestaande koopwoningen · 2020 = 100
                  </p>
                </div>
                <label className="market-check">
                  <input
                    type="checkbox"
                    checked={compare}
                    onChange={(e) => setCompare(e.target.checked)}
                  />
                  Vergelijk modellen
                </label>
              </header>
              <div className="market-chart-content">
                {known && (
                  <MarketForecastChart
                    history={historyPoints}
                    future={futurePoints}
                    predictions={predictions}
                    basePeriod={known.basePeriod}
                    targetPeriod={analysis.targetPeriod}
                    originPeriod={origin}
                    revealed={revealed}
                  />
                )}
              </div>
              <div className="market-card-foot">
                <span>
                  {selectedForecast?.interval
                    ? `Historische 80%-foutband · ${selectedForecast.interval.calibrationCount} eerdere fouten`
                    : rateDelta !== 0
                      ? "Scenario: geen foutband gekalibreerd"
                      : "Nog te weinig eerdere fouten voor een foutband"}
                </span>
                <span>
                  Groei gemeten vanaf {known ? label(known.basePeriod) : "—"}
                </span>
                {activeScore?.intervalCoverage != null && (
                  <span>
                    Terugtest: {number(activeScore.intervalCoverage * 100, 0)}%
                    binnen de band (n={activeScore.intervalN})
                  </span>
                )}
              </div>
            </section>
            <section className="market-card market-knowledge">
              <header>
                <div className="market-card-icon mint">
                  <ShieldCheck size={17} />
                </div>
                <div>
                  <h2>Wat mocht het model weten?</h2>
                  <p>Alle modelinvoer valt vóór de informatiegrens</p>
                </div>
              </header>
              <div className="market-knowledge-date">
                <Clock3 size={14} />
                {dateLabel(analysis.originDate)}
                <span>AFSLUITDATUM</span>
              </div>
              <dl>
                <div>
                  <dt>Prijsindex {known ? label(known.basePeriod) : ""}</dt>
                  <dd>
                    {number(known?.baseIndex)}
                    <small>
                      bruikbaar vanaf{" "}
                      {known ? dateLabel(known.baseAvailableAt) : "—"}
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>Hypotheekrente {known?.latestRatePeriod}</dt>
                  <dd>
                    {number(known?.latestRate, 2)}%
                    <small>
                      {known?.latestRateAvailableAt
                        ? `bruikbaar vanaf ${dateLabel(known.latestRateAvailableAt)}`
                        : "Nog geen bekende rente"}
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>Eerder bekende jaarlijkse prijsgroei</dt>
                  <dd>{pct(known?.priceGrowth4q)}</dd>
                </div>
                <div>
                  <dt>Bekende jaarlijkse transactieverandering</dt>
                  <dd>{pct(known?.transactionGrowth4q)}</dd>
                </div>
                <div>
                  <dt>Training actief model</dt>
                  <dd>
                    {selectedForecast?.trainingCount ?? 0}
                    <small>eerdere voorspelsmomenten</small>
                  </dd>
                </div>
              </dl>
              <details>
                <summary>
                  Controleer de gebruikte waarnemingen <ChevronDown size={13} />
                </summary>
                <div className="market-input-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Reeks</th>
                        <th>Periode</th>
                        <th>Waarde</th>
                        <th>Bruikbaar vanaf</th>
                      </tr>
                    </thead>
                    <tbody>
                      {known?.records.map((r, i) => (
                        <tr key={`${r.kind}-${r.period}-${i}`}>
                          <td>
                            {r.kind === "price"
                              ? "Prijsindex"
                              : r.kind === "rate"
                                ? "Rente"
                                : "Transacties"}
                          </td>
                          <td>{r.period}</td>
                          <td>{number(r.value)}</td>
                          <td>{r.availableAt}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
            <section className="market-card market-comparison">
              <header>
                <div className="market-card-icon amber">
                  <Target size={17} />
                </div>
                <div>
                  <h2>Voegt het model iets toe?</h2>
                  <p>
                    Steeds trainen op vroeger, toetsen op later · alleen
                    afgeronde tests
                  </p>
                </div>
              </header>
              <div className="market-score-table">
                <table>
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>
                        Gem. fout <small>procentpunt</small>
                      </th>
                      <th>
                        RMSE <small>indexpunten</small>
                      </th>
                      <th>Tests</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.scores.map((score) => (
                      <tr
                        key={score.id}
                        className={score.id === model ? "selected" : ""}
                        aria-selected={score.id === model}
                      >
                        <td>
                          <button
                            onClick={() => {
                              setModel(score.id);
                              setRateDelta(0);
                            }}
                          >
                            <i
                              style={{ background: modelMeta[score.id].color }}
                            />
                            {modelMeta[score.id].label}
                            {best?.id === score.id && (
                              <span className="market-best">LAAGSTE FOUT</span>
                            )}
                          </button>
                        </td>
                        <td>{number(score.maeGrowthPP, 2)}</td>
                        <td>{number(score.rmseIndex, 2)}</td>
                        <td>{score.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="market-comparison-note">
                <Info size={13} />
                <p>
                  Alle modellen krijgen dezelfde testperioden. Lager is beter.
                  Deze scores waren op de gekozen voorspeldatum al te berekenen;
                  de nog verborgen doeluitkomst telt niet mee. Een complexer
                  model hoeft niet te winnen.
                </p>
              </div>
            </section>
            <section className="market-card market-errors">
              <header>
                <div className="market-card-icon">
                  <Target size={17} />
                </div>
                <div>
                  <h2>Waar ging het model de mist in?</h2>
                  <p>
                    {modelMeta[model].label} · laatste {errorRows.length}{" "}
                    beschikbare terugtests
                  </p>
                </div>
                <button
                  className="icon-button"
                  aria-label="Download historische voorspelfouten"
                  onClick={exportBacktest}
                >
                  <Download size={15} />
                </button>
              </header>
              <MarketErrorChart rows={errorRows} />
              <div className="market-card-foot">
                <span>Positief = te hoog voorspeld · negatief = te laag</span>
                <span>Fouten in procentpunten</span>
              </div>
            </section>
            <section className="market-card market-scenario">
              <header>
                <div className="market-card-icon mint">
                  <SlidersHorizontal size={17} />
                </div>
                <div>
                  <h2>Verander de rente-aanname</h2>
                  <p>Onderzoek hoe gevoelig het rentemodel reageert</p>
                </div>
                <button
                  className="icon-button"
                  aria-label="Rentescenario herstellen"
                  onClick={() => setRateDelta(0)}
                >
                  <RotateCcw size={15} />
                </button>
              </header>
              <div className="market-scenario-body">
                <div className="market-scenario-value">
                  <span>Afwijking van de laatst bekende rente</span>
                  <strong>{pp(rateDelta)}</strong>
                </div>
                <input
                  aria-label="Rente-aanname aanpassen in procentpunten"
                  type="range"
                  min={-2}
                  max={2}
                  step={0.25}
                  value={rateDelta}
                  onChange={(e) => {
                    setModel("rates");
                    setRateDelta(Number(e.target.value));
                  }}
                />
                <div className="market-slider-labels">
                  <span>−2 pp</span>
                  <span>Ongewijzigd</span>
                  <span>+2 pp</span>
                </div>
                <div className="market-scenario-result">
                  <div>
                    <small>Bekende bronrente</small>
                    <strong>{number(known?.latestRate, 2)}%</strong>
                  </div>
                  <ArrowRight size={18} />
                  <div>
                    <small>Invoer in het scenario</small>
                    <strong>
                      {number(
                        analysis.models.find((m) => m.id === "rates")
                          ?.assumedRate,
                        2,
                      )}
                      %
                    </strong>
                  </div>
                </div>
                <p>
                  We verschuiven de laatst bekende rente en de
                  twaalfmaandsverandering in de modelinvoer. Dit is een
                  gevoeligheidstest, geen bewezen rente-effect of volledig
                  toekomstig rentepad. De historische modelscores veranderen
                  niet.
                </p>
              </div>
            </section>
            <section className="market-card market-policy">
              <header>
                <div className="market-card-icon amber">
                  <CalendarDays size={17} />
                </div>
                <div>
                  <h2>Regelgeving in context</h2>
                  <p>Beleidsmarkeringen, afzonderlijk van het voorspelmodel</p>
                </div>
              </header>
              <div className="market-policy-body">
                {policies
                  .filter(
                    (p) =>
                      p.date <=
                      (revealed
                        ? quarterDate(analysis.targetPeriod)
                        : analysis.originDate),
                  )
                  .map((p) => (
                    <article key={p.date}>
                      <span>{dateLabel(p.date)}</span>
                      <h3>{p.title}</h3>
                      <p>{p.description}</p>
                      <a href={p.url} target="_blank" rel="noreferrer">
                        Lees de officiële bron <ArrowUpRight size={11} />
                      </a>
                    </article>
                  ))}
                {!policies.some(
                  (p) =>
                    p.date <=
                    (revealed
                      ? quarterDate(analysis.targetPeriod)
                      : analysis.originDate),
                ) && (
                  <p className="market-policy-empty">
                    Op deze informatiegrens zijn er nog geen beleidsmarkeringen
                    uit dit voorbeeld zichtbaar.
                  </p>
                )}
                <div className="market-policy-warning">
                  <Info size={14} />
                  <p>
                    Deze gebeurtenissen zijn achteraf als context toegevoegd en
                    worden niet als modelkenmerk gebruikt. Een verandering na
                    een nieuwe regel bewijst geen oorzakelijk effect.
                  </p>
                </div>
              </div>
            </section>
          </div>
          <section className="market-neighborhood-section">
            <div className="market-section-heading">
              <div>
                <span className="market-kicker">TWEEDE KIJKRICHTING</span>
                <h2>Welke buurten weken af?</h2>
                <p>
                  Historische WOZ-ontwikkeling, gegeven het meetjaar. Een andere
                  maat en tijdschaal dan de verkoopprijsindex hierboven.
                </p>
              </div>
              <span className="market-year-pill">
                {neighborhood?.year
                  ? `WOZ-bronjaar ${neighborhood.year}`
                  : "Nog geen bruikbaar buurtjaar"}
              </span>
            </div>
            {neighborhood?.rows.length && dataset ? (
              <>
                <div className="market-local-notice">
                  <Info size={14} />
                  <p>
                    {neighborhood.limitation} Minimaal 100 woningen;
                    veranderingen in de voorraad groter dan 20% en bekende
                    grensbreuken zijn uitgesloten.
                  </p>
                </div>
                <div className="market-neighborhood-grid">
                  <section className="market-card market-neighborhood-map">
                    <header>
                      <div className="market-card-icon mint">
                        <MapPin size={17} />
                      </div>
                      <div>
                        <h2>Afwijking van het historische buurtpatroon</h2>
                        <p>
                          {neighborhood.rows.length} buurten ·{" "}
                          {neighborhood.excluded} uitgesloten · kleur in
                          procentpunten
                        </p>
                      </div>
                    </header>
                    <div className="market-geo">
                      <GeoMap
                        geometry={dataset.geometry}
                        values={colorValues}
                        selected={selected}
                        onSelect={chooseArea}
                        format={pp}
                        colorMode="diverging"
                        colorLimit={colorLimit}
                      />
                    </div>
                    <div className="market-card-foot">
                      <span>Oranje = lager · blauw = hoger dan verwacht</span>
                      <span>
                        Kleur begrensd op 95e percentiel · hover voor exacte
                        waarde
                      </span>
                    </div>
                  </section>
                  <section className="market-card market-neighborhood-list">
                    <header>
                      <div className="market-card-icon">
                        <MapPin size={17} />
                      </div>
                      <div>
                        <h2>Onderzoek een buurt</h2>
                        <p>
                          {neighborhood.fitted
                            ? `Patroon uit ${neighborhood.trainingYears.length} eerdere meetjaren`
                            : "Vergelijking met de buurtmediaan; nog onvoldoende trainingsjaren"}
                        </p>
                      </div>
                    </header>
                    <div className="market-area-search">
                      <input
                        aria-label="Zoek buurt in woningmarktanalyse"
                        value={areaQuery}
                        onChange={(e) => setAreaQuery(e.target.value)}
                        placeholder="Zoek een buurt…"
                      />
                      <div
                        className="market-area-sort"
                        aria-label="Sorteer buurtverschillen"
                      >
                        <button
                          aria-pressed={areaSort === "high"}
                          onClick={() => setAreaSort("high")}
                        >
                          Hoger dan verwacht
                        </button>
                        <button
                          aria-pressed={areaSort === "low"}
                          onClick={() => setAreaSort("low")}
                        >
                          Lager dan verwacht
                        </button>
                      </div>
                    </div>
                    {selectedArea ? (
                      <div className="market-area-detail">
                        <button
                          className="market-back"
                          onClick={() => setSelected([])}
                        >
                          <ArrowLeft size={12} />
                          Alle buurten
                        </button>
                        <h3>{selectedArea.name}</h3>
                        <span>{selectedArea.code}</span>
                        <dl>
                          <div>
                            <dt>Gerealiseerde WOZ-groei</dt>
                            <dd>{pct(selectedArea.actualGrowth)}</dd>
                          </div>
                          <div>
                            <dt>Verwacht, gegeven de buurtmediaan</dt>
                            <dd>{pct(selectedArea.expectedGrowth)}</dd>
                          </div>
                          <div>
                            <dt>Afwijking</dt>
                            <dd>{pp(selectedArea.residual)}</dd>
                          </div>
                          <div>
                            <dt>Woningvoorraad</dt>
                            <dd>{number(selectedArea.homes, 0)}</dd>
                          </div>
                          <div>
                            <dt>Voorraadverandering</dt>
                            <dd>{pct(selectedArea.stockGrowth)}</dd>
                          </div>
                        </dl>
                        <p>
                          Het model gebruikt alleen kenmerken uit eerdere jaren.
                          De mediaan van het meetjaar is een bekende
                          contextwaarde. Daarom is deze vergelijking een
                          historische analyse, geen voorspelling van toekomstige
                          verkoopprijzen.
                        </p>
                      </div>
                    ) : (
                      <div className="market-local-list">
                        {neighborhood.rows
                          .filter((r) =>
                            `${r.name} ${r.code}`
                              .toLowerCase()
                              .includes(areaQuery.toLowerCase()),
                          )
                          .sort((a, b) =>
                            areaSort === "low"
                              ? a.residual - b.residual
                              : b.residual - a.residual,
                          )
                          .slice(0, 30)
                          .map((r) => (
                            <button
                              key={r.code}
                              onClick={() => chooseArea(r.code)}
                            >
                              <span>
                                {r.name}
                                <small>{pct(r.actualGrowth)} WOZ-groei</small>
                              </span>
                              <strong>{pp(r.residual)}</strong>
                              <ArrowUpRight size={12} />
                            </button>
                          ))}
                      </div>
                    )}
                    <div className="market-card-foot">
                      <span>
                        {areaSort === "high"
                          ? "Grootste positieve"
                          : "Grootste negatieve"}{" "}
                        afwijkingen · maximaal 30 resultaten, zoek voor meer
                      </span>
                    </div>
                  </section>
                </div>
                <div className="market-local-method">
                  <strong>Wat betekent ‘verwacht’ hier?</strong>
                  <p>
                    Het patroon gebruikt{" "}
                    {neighborhood.features.join(", ").toLowerCase()}, getraind
                    op {neighborhood.trainingCount.toLocaleString("nl-NL")}{" "}
                    buurt-jaarrijen vóór {neighborhood.year}. De gerealiseerde
                    buurtmediaan in {neighborhood.year} is{" "}
                    {pct(neighborhood.benchmarkGrowth)}. Afwijkingen kunnen ook
                    door woningmix of registratie ontstaan. De WOZ-peildatum
                    ligt één jaar vóór het bronjaar.
                  </p>
                </div>
              </>
            ) : (
              <div className="market-empty-local">
                <MapPin size={26} />
                <p>
                  Voor deze informatiegrens zijn nog onvoldoende bruikbare
                  buurtcijfers beschikbaar. Kies een latere voorspeldatum om ook
                  de WOZ-analyse te bekijken.
                </p>
              </div>
            )}
          </section>
          <section id="market-method" className="market-method">
            <button
              onClick={() => setDetails((v) => !v)}
              aria-expanded={details}
            >
              <span>
                <CircleHelp size={18} />
                <strong>Bronnen, methode en grenzen</strong>
              </span>
              <ChevronDown size={17} />
            </button>
            {details && (
              <div className="market-method-content">
                <div>
                  <h3>Gepubliceerde reeksen</h3>
                  <p>
                    Prijsindex en transactievolume van CBS/Kadaster voor
                    Amsterdam. Nationale rente op nieuwe bancaire woningleningen
                    van ECB, alle rentevaste perioden samen. Dit is geen
                    persoonlijk hypotheekaanbod. Bronstatus E is geschat; de
                    geharmoniseerde rentemodellen gebruiken normale
                    bronwaarnemingen.
                  </p>
                  <a
                    href="https://www.cbs.nl/nl-nl/cijfers/detail/85792NED"
                    target="_blank"
                    rel="noreferrer"
                  >
                    CBS prijsindex <ArrowUpRight size={11} />
                  </a>
                  <a
                    href="https://data.ecb.europa.eu/data/datasets/MIR/MIR.M.NL.B.A2C.A.R.A.2250.EUR.N"
                    target="_blank"
                    rel="noreferrer"
                  >
                    ECB hypotheekrente <ArrowUpRight size={11} />
                  </a>
                </div>
                <div>
                  <h3>Een informatiegrens, geen perfecte historische kopie</h3>
                  <p>{data.meta.availability.limitation}</p>
                  <p>
                    Ook de buurtgeometrie en WOZ-historie komen uit huidige
                    bronversies. De kaart is geen bewijs van wat destijds exact
                    openbaar bekend was.
                  </p>
                </div>
                <div>
                  <h3>Eerst trainen, dan toetsen</h3>
                  <p>
                    Voor elke voorspeldatum zijn alleen afgeronde
                    trainingsuitkomsten vóór die informatiegrens gebruikt.
                    Schaling en modelparameters worden opnieuw op het
                    trainingsdeel bepaald. Eenvoudige verwachtingen staan naast
                    twee geregulariseerde lineaire modellen. Eerdere, inmiddels
                    bekende terugtestfouten bepalen de historische foutband.
                    Overlappende kwartaaluitkomsten zijn geen onafhankelijke
                    experimenten.
                  </p>
                </div>
                <div>
                  <h3>Interpretatie en export</h3>
                  <p>
                    De prijsindex is nominaal, niet voor inflatie gecorrigeerd.
                    Rentescenario’s meten modelsensitiviteit. Beleidsmarkeringen
                    schatten geen beleidseffect. De download bevat invoer,
                    voorspellingen, tests en bronherkomst; de verborgen
                    doeluitkomst wordt alleen toegevoegd nadat je hem hebt
                    onthuld.
                  </p>
                  <p>
                    Marktdata opgehaald: {dateLabel(data.meta.retrievedAt)}. Er
                    worden geen nieuwe marktgegevens opgehaald wanneer je de
                    voorspeldatum verandert.
                  </p>
                </div>
              </div>
            )}
          </section>
          <footer className="market-footer">
            <span>
              <ShieldCheck size={12} />
              Gereconstrueerde terugtest · uitkomsten zijn geen garanties
            </span>
            <span>CBS/Kadaster · ECB · O&S Amsterdam</span>
          </footer>
        </>
      )}
    </main>
  );
}
