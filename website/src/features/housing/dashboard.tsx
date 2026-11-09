"use client";

import Image from "next/image";
import { SourceAge } from "@/components/workspaces/source-age";
import Link from "next/link";
import {
  ShareView,
  text,
  flag,
  bounded,
  oneOf,
} from "@/components/workspaces/view-state";
import { WorkspaceNavigation } from "@/components/workspaces/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Building2,
  Database,
  Focus,
  House,
  Info,
  MapPinned,
  X,
} from "lucide-react";
import { assetPath } from "@/lib/paths";
import { pairedCorrelation } from "@/features/data/joins";
import { download } from "@/features/playground/project";
import { Modal } from "@/features/analysis/modal";
import type { PropertyMode } from "@/features/examples/property-position";
import { loadBuildingYears, loadHomes, type BagProgress } from "./data";
import {
  metrics,
  rangeError,
  areasCsv,
  extent,
  filtered,
  format,
  labels,
  matchingHomes,
  medianValue,
  metricValue,
  number,
  sortNeighborhoods,
  themeLabels,
  themeMetrics,
  themes,
  units,
  type Home,
  type Metric,
  type RangeFilter,
  type Snapshot,
} from "./model";
import type { HousingRuntime } from "./runtime";
import { sourceMessage } from "./errors";
import { Scatter } from "./scatter";
import { NeighborhoodComparison } from "./comparison";
import { HomeEnvironment } from "./home-environment";
import { HousingFilters, MetricOptions, NeighborhoodProfile } from "./explorer";
import { HousingTaxes } from "./taxes-panel";
import { AddressContext } from "./address-context-panel";
import "@/features/analysis/analysis.css";
import "./housing.css";

export function HousingDashboard() {
  const client = useQueryClient(),
    container = useRef<HTMLDivElement>(null),
    inspector = useRef<HTMLElement>(null);
  const [runtime, setRuntime] = useState<HousingRuntime | null>(null),
    [mapError, setMapError] = useState("");
  const [attempt, setAttempt] = useState(0),
    [selected, setSelected] = useState(""),
    [home, setHome] = useState<Home | null>(null);
  const [query, setQuery] = useState(""),
    [minimum, setMinimum] = useState(100),
    [metric, setMetric] = useState<Metric>("woz"),
    [axis, setAxis] = useState<Metric>("owner");
  const [ranges, setRanges] = useState<RangeFilter[]>([]),
    [knownOnly, setKnownOnly] = useState(false),
    [ascending, setAscending] = useState(false);
  const [mode, setMode] = useState<PropertyMode>("follow"),
    [help, setHelp] = useState(false),
    [loaded, setLoaded] = useState(""),
    [limit, setLimit] = useState(30);
  const [bagProgress, setBagProgress] = useState<
    (BagProgress & { code: string }) | null
  >(null);
  const [homeQuery, setHomeQuery] = useState("");
  const callbacks = useRef({
    choose: (code: string) => {
      setSelected(code);
      setHome(null);
      setHomeQuery("");
    },
    pick: (row: Home) => {
      setHome(row);
      setHomeQuery("");
    },
  });
  const snapshot = useQuery({
    queryKey: ["housing-snapshot"],
    queryFn: async ({ signal }): Promise<Snapshot> => {
      const response = await fetch(assetPath("/data/amsterdam-housing.json"), {
        signal,
      });
      if (!response.ok)
        throw new Error("De CBS-buurtgegevens konden niet worden geladen.");
      const data: Snapshot = await response.json();
      if (
        data.data?.type !== "FeatureCollection" ||
        !Array.isArray(data.data.features) ||
        data.meta?.statisticsYear !== 2025
      )
        throw new Error("Onverwacht formaat van de buurtgegevens.");
      return data;
    },
    staleTime: Infinity,
    retry: false,
  });
  const all = useMemo(
    () => snapshot.data?.data.features ?? [],
    [snapshot.data],
  );
  const rows = useMemo(
    () =>
      sortNeighborhoods(
        filtered(all, query, minimum, ranges, knownOnly ? metric : undefined),
        metric,
        ascending,
      ),
    [all, query, minimum, ranges, knownOnly, metric, ascending],
  );
  const area = all.find((f) => f.properties.code === selected);
  const bag = useQuery({
    queryKey: ["housing-bag", selected],
    enabled: !!area && loaded === selected,
    queryFn: ({ signal }) =>
      loadHomes(area!, signal, fetch, (progress) => {
        if (!signal.aborted) setBagProgress({ ...progress, code: selected });
      }),
    staleTime: 15 * 60_000,
    retry: false,
  });
  const homes = useMemo(
    () => (loaded === selected ? (bag.data?.data.features ?? []) : []),
    [bag.data, loaded, selected],
  );
  const homeResults = useMemo(
    () => matchingHomes(homes, homeQuery),
    [homes, homeQuery],
  );
  const years = useQuery({
    queryKey: ["housing-years", home?.properties.id],
    enabled: !!home,
    queryFn: ({ signal }) => loadBuildingYears(home!, signal),
    staleTime: 15 * 60_000,
    retry: false,
  });
  const correlation = useMemo(
    () =>
      pairedCorrelation(
        rows,
        (f) => metricValue(f, axis),
        (f) => metricValue(f, "woz"),
      ),
    [rows, axis],
  );

  useEffect(() => {
    const lifetime = new AbortController();
    void import("./runtime")
      .then(({ mountHousing }) =>
        mountHousing(
          container.current!,
          lifetime.signal,
          client,
          (code) => callbacks.current.choose(code),
          (row) => callbacks.current.pick(row),
        ),
      )
      .then((map) => {
        if (map && !lifetime.signal.aborted) setRuntime(map);
      })
      .catch((error) => {
        if (!lifetime.signal.aborted) {
          setMapError(
            error instanceof Error
              ? error.message
              : "WebGL is niet beschikbaar.",
          );
          lifetime.abort();
        }
      });
    return () => lifetime.abort();
  }, [client, attempt]);
  useEffect(() => {
    runtime?.setData(
      all,
      rows,
      metric,
      selected,
      homes,
      mode,
      snapshot.data?.meta.indicators,
    );
  }, [runtime, all, rows, metric, selected, homes, mode, snapshot.data]);

  const choose = (code: string) => {
    callbacks.current.choose(code);
    if (code)
      requestAnimationFrame(() => {
        if (inspector.current) inspector.current.scrollTop = 0;
        document
          .getElementById("housing-selected-title")
          ?.focus({ preventScroll: true });
        inspector.current?.scrollIntoView({
          block: "start",
          behavior: "instant",
        });
      });
  };
  useEffect(() => {
    if (inspector.current) inspector.current.scrollTop = 0;
  }, [selected]);
  const theme = themes.find((t) => themeMetrics[t].includes(metric))!;
  const reset = () => {
    setQuery("");
    setMinimum(100);
    setRanges([]);
    setKnownOnly(false);
  };
  const filtersActive = !!(
    query ||
    minimum !== 100 ||
    ranges.length ||
    knownOnly
  );
  const indicator = snapshot.data?.meta.indicators?.[metric];
  const knownMetric = rows.filter(
    (f) => metricValue(f, metric) !== null,
  ).length;
  const cancelBag = () => {
    void client.cancelQueries({
      queryKey: ["housing-bag", selected],
      exact: true,
    });
    setLoaded("");
    setHome(null);
    setHomeQuery("");
    setBagProgress(null);
  };
  const exportMetadata = () =>
    download(
      JSON.stringify(
        {
          version: 1,
          file: "amsterdam-wonen-buurten.csv",
          exportedAt: new Date().toISOString(),
          sources: snapshot.data!.meta,
          filters: {
            query,
            minimumHomes: minimum,
            ranges,
            knownOnly,
            metric,
            ascending,
          },
          neighborhoodCodes: rows.map((row) => row.properties.code),
          csv: {
            encoding: "UTF-8 with BOM",
            delimiter: ";",
            decimal: ".",
            missing: "empty cell",
            units,
            labels,
          },
          scope:
            "CBS-buurtgemiddelden; geen individuele woningwaarden of verkoopprijzen",
        },
        null,
        2,
      ),
      "amsterdam-wonen-buurten.metadata.json",
    );
  const exportAreas = () =>
    download(
      JSON.stringify({
        type: "FeatureCollection",
        features: rows,
        provenance: {
          ...snapshot.data!.meta,
          scope:
            "CBS-buurtgemiddelden; geen individuele woningwaarden of verkoopprijzen",
          filters: {
            query,
            minimumHomes: minimum,
            ranges,
            knownOnly,
            metric,
            ascending,
          },
        },
      }),
      "amsterdam-wonen-buurten.geojson",
      "application/geo+json",
    );
  return (
    <main
      lang="nl"
      className="hs-root"
      aria-busy={snapshot.isPending}
      data-housing
      data-ready={runtime && snapshot.data ? "true" : undefined}
      data-selected={selected}
    >
      <a className="skip-link" href="#housing-map">
        Naar de kaart
      </a>
      <header className="an-header">
        <Link className="an-brand" href="/" prefetch={false}>
          <Image
            src={assetPath("/logo.svg")}
            alt=""
            width={31}
            height={31}
            priority
          />
          <span>
            Map Master<small>WONEN IN CONTEXT</small>
          </span>
        </Link>
        <WorkspaceNavigation current="/analysis/housing/" />
        <button className="an-button" onClick={() => setHelp(true)}>
          <Info size={15} />
          Bronnen & methode
        </button>
      </header>
      <ShareView
        app="housing"
        data={{
          selected,
          query,
          minimum,
          metric,
          axis,
          ranges,
          knownOnly,
          ascending,
          mode,
        }}
        defaults={{
          selected: "",
          query: "",
          minimum: 100,
          metric: "woz",
          axis: "owner",
          ranges: [],
          knownOnly: false,
          ascending: false,
          mode: "follow",
        }}
        rules={{
          selected: text,
          query: text,
          minimum: bounded(0, 1000000),
          metric: oneOf(metrics),
          axis: oneOf(metrics),
          ranges: (value) =>
            Array.isArray(value) &&
            value.length <= 25 &&
            value.every(
              (row) =>
                row &&
                oneOf(metrics)(row.metric) &&
                text(row.min) &&
                text(row.max) &&
                !rangeError(row),
            ),
          knownOnly: flag,
          ascending: flag,
          mode: oneOf(["follow", "fixed", "click", "off"]),
        }}
        apply={(v) => {
          setSelected(v.selected as string);
          setQuery(v.query as string);
          setMinimum(v.minimum as number);
          setMetric(v.metric as Metric);
          setAxis(v.axis as Metric);
          setRanges(v.ranges as RangeFilter[]);
          setKnownOnly(v.knownOnly as boolean);
          setAscending(v.ascending as boolean);
          setMode(v.mode as PropertyMode);
          setHome(null);
          setLoaded("");
        }}
      />
      <section className="hs-intro">
        <div>
          <span className="hs-eyebrow">AMSTERDAM · OPEN DATA</span>
          <h1>Een woning staat nooit op zichzelf.</h1>
          <p>
            Van WOZ-ontwikkeling en nieuwbouw tot opleiding, energie en
            voorzieningen. Combineer filters en ontdek het verhaal achter een
            buurt.
          </p>
        </div>
        <Link
          className="an-button"
          href="/guides/open-data-amsterdam/"
          prefetch={false}
        >
          <Database size={15} />
          Databronnen bekijken <ArrowUpRight size={14} />
        </Link>
      </section>
      {snapshot.data && (
        <SourceAge
          retrievedAt={snapshot.data.meta.retrievedAt}
          sourceYear={snapshot.data.meta.statisticsYear}
        />
      )}
      <section className="hs-stats" aria-label="Gefilterde buurten">
        <div>
          <span>Buurten in selectie</span>
          <strong data-stat="neighborhoods">{number(rows.length)}</strong>
          <small>van {number(all.length)} buurtvlakken</small>
        </div>
        <div>
          <span>Met bekende kaartwaarde</span>
          <strong>{number(knownMetric)}</strong>
          <small>{labels[metric]} · ontbrekend is geen nul</small>
        </div>
        <div>
          <span>Mediaan van de selectie</span>
          <strong>{format(medianValue(rows, metric), metric)}</strong>
          <small>elke buurt telt één keer</small>
        </div>
        <div>
          <span>
            {metric === "woz" ? "WOZ-waardepeildatum" : "CBS-tabeljaar"}
          </span>
          <strong>
            {metric === "woz" ? "1 jan. 2024" : (indicator?.year ?? 2025)}
          </strong>
          <small>
            {metric === "woz"
              ? "CBS-buurtcijfers 2025 · geen verkoopprijzen"
              : "Brondefinitie en dekking staan bij de kaart"}
          </small>
        </div>
      </section>
      {snapshot.isPending && (
        <p className="hs-loading" role="status">
          Buurtcijfers en kaart worden geladen…
        </p>
      )}
      {(snapshot.error || mapError) && (
        <div className="hs-error" role="alert">
          <strong>
            {mapError || (snapshot.error ? sourceMessage(snapshot.error) : "")}
          </strong>
          <button
            className="an-button"
            onClick={() => {
              if (mapError) {
                setMapError("");
                setAttempt((v) => v + 1);
              } else void snapshot.refetch();
            }}
          >
            Opnieuw proberen
          </button>
        </div>
      )}
      <nav className="hs-step-nav" aria-label="Onderdelen woningonderzoek">
        <a href="#housing-filters">1. Filters</a>
        <a href="#housing-map">2. Kaart</a>
        <a href="#housing-results">3. Resultaten</a>
        <span role="status">
          {rows.length} buurten ·{" "}
          {area?.properties.name ?? "geen buurt gekozen"}
        </span>
      </nav>
      <div id="housing-filters">
        <HousingFilters
          all={all}
          query={query}
          setQuery={setQuery}
          minimum={minimum}
          setMinimum={setMinimum}
          ranges={ranges}
          setRanges={setRanges}
          knownOnly={knownOnly}
          setKnownOnly={setKnownOnly}
          metric={metric}
          reset={reset}
          count={rows.length}
          rows={rows}
          choose={choose}
        />
      </div>
      <nav className="hs-themes" aria-label="Datathema’s">
        {themes.map((t) => (
          <button
            key={t}
            aria-pressed={theme === t}
            onClick={() => setMetric(themeMetrics[t][0])}
          >
            {themeLabels[t]}
          </button>
        ))}
      </nav>
      <div className="hs-workspace">
        <section className="hs-map-panel" aria-label="Buurtenkaart">
          <div className="hs-map-controls">
            <label>
              Kaartlaag
              <select
                aria-label="Kaartlaag wonen"
                value={metric}
                onChange={(e) => setMetric(e.target.value as Metric)}
              >
                <MetricOptions />
              </select>
            </label>
            <label>
              Eigenschappen
              <select
                aria-label="Informatie bij aanwijzen"
                value={mode}
                onChange={(e) => setMode(e.target.value as PropertyMode)}
              >
                <option value="follow">Info volgt muis</option>
                <option value="fixed">Info in het midden</option>
                <option value="click">Bij klik in het midden</option>
                <option value="off">Info uit</option>
              </select>
            </label>
            <button
              className="an-icon"
              aria-label="Toon heel Amsterdam"
              onClick={() => runtime?.fit()}
              disabled={!runtime}
            >
              <Focus size={17} />
            </button>
          </div>
          <div
            id="housing-map"
            className="hs-map"
            ref={container}
            role="region"
            aria-label="Woningkaart Amsterdam"
            tabIndex={-1}
          />
          <div className="hs-layer-context">
            <strong>
              {labels[metric]} <span>CBS {indicator?.year ?? 2025}</span>
            </strong>
            <p>
              {indicator?.description ??
                "Officiële CBS-buurtcijfers. Ontbrekende en onderdrukte waarden blijven onbekend."}
            </p>
            <small>
              {knownMetric} van {rows.length} geselecteerde buurten met een
              bekende waarde
              {indicator && (
                <>
                  {" "}
                  ·{" "}
                  <a href={indicator.source} target="_blank" rel="noreferrer">
                    CBS-bron
                  </a>
                </>
              )}
            </small>
          </div>
          <div
            className="hs-legend"
            data-diverging={metric === "wozChange" || undefined}
          >
            <strong>{labels[metric]}</strong>
            <span>
              <i />
              {format(extent(all, metric)[0], metric)} –{" "}
              {format(extent(all, metric)[1], metric)}
            </span>
            <small>
              Vaste stadsschaal · grijs: onbekend · hoger is niet automatisch
              beter
            </small>
          </div>
        </section>
        <aside
          ref={inspector}
          className="hs-inspector"
          aria-label="Buurt en woningen"
        >
          {area ? (
            <>
              <div className="hs-section-head">
                <span className="hs-eyebrow">GESELECTEERDE BUURT</span>
                <button
                  className="an-icon"
                  aria-label="Buurtselectie wissen"
                  onClick={() => {
                    choose("");
                    setLoaded("");
                  }}
                >
                  <X size={16} />
                </button>
              </div>
              <h2 id="housing-selected-title" tabIndex={-1}>
                {area.properties.name}
              </h2>
              <small>{area.properties.code}</small>
              {!rows.some((f) => f.properties.code === selected) && (
                <p className="hs-note">
                  Deze buurt valt buiten je huidige filters.
                </p>
              )}
              <div className="hs-neighborhood-counts">
                <span>
                  <b>{number(area.properties.homes)}</b> woningen
                </span>
                <span>
                  <b>{number(area.properties.residents)}</b> inwoners
                </span>
              </div>
              <NeighborhoodProfile
                area={area}
                all={all}
                meta={snapshot.data?.meta}
                metric={metric}
              />
              <button
                className="an-button"
                onClick={() => runtime?.fit(area)}
                disabled={!runtime}
              >
                <Focus size={14} />
                Zoom naar buurt
              </button>
              <hr />
              <span className="hs-eyebrow">VAN BUURT NAAR WONING</span>
              <h3>Echte BAG-adressen</h3>
              <p>
                Laad alle in gebruik zijnde woonverblijfsobjecten binnen deze
                buurt. Eén punt per BAG-woning, ook bij meerdere adressen.
              </p>
              <button
                className="an-button an-primary"
                disabled={bag.isFetching}
                onClick={() => {
                  setHome(null);
                  if (loaded === selected) void bag.refetch();
                  else setLoaded(selected);
                }}
              >
                <House size={15} />
                {bag.isFetching
                  ? "Woningen ophalen…"
                  : homes.length
                    ? "BAG vernieuwen"
                    : "Laad BAG-woningen"}
              </button>
              {loaded === selected && bag.error && (
                <p className="hs-error" role="alert">
                  {sourceMessage(bag.error)}
                </p>
              )}
              {loaded === selected && bag.isFetching && (
                <div className="hs-bag-progress">
                  <p role="status">
                    {bagProgress?.code === selected && bagProgress.pages > 0
                      ? `${number(bagProgress.fetched)} bronrecords gelezen · ${bagProgress.pages} bronpagina’s compleet.`
                      : "Eerste bronpagina ophalen…"}{" "}
                    Alle bronpagina’s worden gecontroleerd voordat woningen
                    verschijnen. De BAG kan per pagina tot 30 seconden nodig
                    hebben.
                  </p>
                  <button className="an-button" onClick={cancelBag}>
                    Ophalen annuleren
                  </button>
                </div>
              )}
              {loaded === selected && bag.data && !bag.isFetching && (
                <>
                  <p className="hs-note" data-homes-count={homes.length}>
                    <b>{number(homes.length)} BAG-woningen</b> ·{" "}
                    {number(bag.data.audit.fetched)} bronrecords onderzocht.
                    Actueel opgevraagd op{" "}
                    {new Date(bag.data.audit.retrievedAt).toLocaleDateString(
                      "nl-NL",
                    )}
                    ; de buurtgrens is uit 2025. Het verschil met CBS is geen
                    leegstandscijfer.
                  </p>
                  <button
                    className="an-button"
                    onClick={() =>
                      download(
                        JSON.stringify({
                          ...bag.data!.data,
                          provenance: {
                            source: "Kadaster / PDOK BAG",
                            neighborhood: selected,
                            audit: bag.data!.audit,
                            scope:
                              "Actuele woonverblijfsobjecten binnen CBS-buurtgrens 2025; geen individuele woningwaarden",
                          },
                        }),
                        "amsterdam-bag-woningen.geojson",
                        "application/geo+json",
                      )
                    }
                  >
                    <ArrowDownToLine size={14} />
                    Exporteer woningen
                  </button>
                  <label className="hs-address-search">
                    Zoek binnen deze BAG-woningen
                    <input
                      aria-label="Zoek BAG-adres"
                      placeholder="Straat, huisnummer, postcode of BAG-ID…"
                      value={homeQuery}
                      onChange={(e) => {
                        setHomeQuery(e.target.value);
                        setHome(null);
                      }}
                    />
                  </label>
                  <p className="hs-note" role="status">
                    {number(homeResults.length)} van {number(homes.length)}{" "}
                    adressen
                    {homeQuery && !homeResults.length
                      ? " · geen adres gevonden binnen deze buurt"
                      : ""}
                  </p>
                  <label className="hs-address-picker">
                    Bekijk een woning
                    <select
                      aria-label="BAG-woning kiezen"
                      value={home?.properties.id ?? ""}
                      onChange={(e) =>
                        setHome(
                          homes.find(
                            (f) => f.properties.id === e.target.value,
                          ) ?? null,
                        )
                      }
                    >
                      <option value="">
                        Kies een adres op de kaart of hier
                      </option>
                      {homeResults.map((f) => (
                        <option key={f.properties.id} value={f.properties.id}>
                          {f.properties.address}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {home && (
                <section className="hs-home" aria-label="Geselecteerde woning">
                  <Building2 size={18} />
                  <h3>{home.properties.address}</h3>
                  <dl className="hs-details">
                    <div>
                      <dt>Gebruiksoppervlakte</dt>
                      <dd>
                        {home.properties.area === null
                          ? "Onbekend"
                          : `${number(home.properties.area)} m²`}
                      </dd>
                    </div>
                    <div>
                      <dt>Bouwjaar gekoppelde panden</dt>
                      <dd>
                        {years.isFetching
                          ? "Laden…"
                          : years.error
                            ? "Tijdelijk niet beschikbaar"
                            : years.data?.length
                              ? years.data.join(", ")
                              : "Niet bekend"}
                      </dd>
                    </div>
                    <div>
                      <dt>BAG-identificatie</dt>
                      <dd>{home.properties.id}</dd>
                    </div>
                  </dl>
                  <p>
                    Voor dit adres tonen we geen individuele woningwaarde. De
                    WOZ hierboven beschrijft de hele buurt.
                  </p>
                  <HomeEnvironment
                    key={home.properties.id}
                    home={home}
                    runtime={runtime}
                  />
                  <AddressContext
                    key={`context-${home.properties.id}`}
                    home={home}
                  />
                </section>
              )}
            </>
          ) : (
            <div className="hs-empty">
              <MapPinned size={32} />
              <h2>Begin bij een buurt</h2>
              <p>
                Klik op de kaart, een stip in de vergelijking of een buurt in de
                lijst. De kaart blijft op haar plek; inzoomen doe je met de
                zoomknop.
              </p>
              <span>
                Daarna kun je de BAG-woningen laden en per adres de officiële
                kenmerken bekijken.
              </span>
            </div>
          )}
        </aside>
      </div>
      <NeighborhoodComparison
        all={all}
        selected={selected}
        indicators={snapshot.data?.meta.indicators}
      />
      <section
        id="housing-results"
        className="hs-analysis"
        aria-label="Woninganalyse"
      >
        <div className="hs-comparison">
          <div className="hs-section-head">
            <div>
              <span className="hs-eyebrow">VERBANDEN VERKENNEN</span>
              <h2>Wat hangt samen met woningwaarde?</h2>
            </div>
            <label>
              Vergelijk met
              <select
                aria-label="Vergelijk woningwaarde met"
                value={axis}
                onChange={(e) => setAxis(e.target.value as Metric)}
              >
                <MetricOptions exclude="woz" />
              </select>
            </label>
          </div>
          <div className="hs-correlation">
            <strong>
              Pearson r:{" "}
              {correlation.r === null ? "—" : number(correlation.r, 2)}
            </strong>
            <span>{correlation.n} complete buurtparen · ongewogen</span>
          </div>
          {filtersActive && (
            <button className="an-button hs-reset" onClick={reset}>
              Hele stad vergelijken
            </button>
          )}
          {correlation.r === null && (
            <p className="hs-note">
              Een correlatie vraagt minimaal vijf complete buurtparen en
              variatie op beide assen.
            </p>
          )}
          <Scatter
            rows={rows}
            axis={axis}
            selected={selected}
            choose={choose}
          />
          <p className="hs-note">
            Elke stip is één buurt. Dit is een verkennend verband, zonder
            correctie voor woninggrootte, bouwjaar of ligging. Naburige buurten
            zijn niet onafhankelijk. Hieruit volgen geen oorzaken of
            waardeschattingen voor een woning.
          </p>
        </div>
        <div className="hs-neighborhoods">
          <span className="hs-eyebrow">ALLE BUURTEN VERGELIJKEN</span>
          <h2>Kies je onderzoeksgebied</h2>
          <div className="hs-list-controls">
            <label>
              Sorteer {labels[metric].toLocaleLowerCase("nl")}
              <select
                aria-label="Sorteervolgorde buurten"
                value={ascending ? "asc" : "desc"}
                onChange={(e) => setAscending(e.target.value === "asc")}
              >
                <option value="desc">Hoog naar laag</option>
                <option value="asc">Laag naar hoog</option>
              </select>
            </label>
            <span>Filters gelden ook voor kaart, grafiek en export.</span>
          </div>
          <div className="hs-table">
            <table>
              <thead>
                <tr>
                  <th>Buurt</th>
                  <th>{labels[metric]}</th>
                  <th>Woningen</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((f) => (
                  <tr
                    key={f.properties.code}
                    data-selected={f.properties.code === selected || undefined}
                  >
                    <td>
                      <button onClick={() => choose(f.properties.code)}>
                        {f.properties.name}
                      </button>
                    </td>
                    <td>
                      {metricValue(f, metric) === null
                        ? "—"
                        : format(metricValue(f, metric), metric)}
                    </td>
                    <td>{number(f.properties.homes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <div className="hs-empty-results">
                <p>Geen buurten gevonden. Verruim of wis je filters.</p>
                <button className="an-button" onClick={reset}>
                  Filters wissen
                </button>
              </div>
            )}
          </div>
          <div className="hs-table-actions">
            <span>
              {Math.min(rows.length, limit)} van {rows.length} buurten
            </span>
            {limit < rows.length && (
              <button
                className="an-button"
                onClick={() => setLimit((n) => n + 30)}
              >
                Meer buurten
              </button>
            )}
            <button
              className="an-button"
              disabled={!snapshot.data || !rows.length}
              onClick={exportAreas}
            >
              <ArrowDownToLine size={14} />
              GeoJSON
            </button>
            <button
              className="an-button"
              disabled={!snapshot.data || !rows.length}
              onClick={() =>
                download(
                  areasCsv(rows, snapshot.data?.meta.indicators),
                  "amsterdam-buurten.csv",
                  "text/csv;charset=utf-8",
                )
              }
            >
              CSV
            </button>
            <button
              className="an-button"
              disabled={!snapshot.data}
              onClick={exportMetadata}
            >
              CSV-metadata
            </button>
          </div>
        </div>
      </section>
      <div className="hs-extra-context">
        <HousingTaxes />
        <section className="hs-source-note">
          <span className="hs-eyebrow">OOK PER WONING TE BEKIJKEN</span>
          <h2>Van buurt naar adres</h2>
          <p>
            Kies een buurt en laad de BAG-woningen. Per adres vind je bouwjaar,
            oppervlakte, energielabel, bomen en geluid, plus erfpacht- en
            B&B-context uit openbare registraties.
          </p>
          <p>
            Persoonlijke erfpachtvoorwaarden en individuele vakantieverhuur zijn
            alleen zichtbaar als daar een passende openbare bron voor is.
            Ontbrekende gegevens worden nergens als nul of “nee” ingevuld.
          </p>
        </section>
      </div>
      <footer className="hs-footer">
        <span>CBS / PDOK · BAG / Kadaster · OpenFreeMap</span>
        <Link href="/guides/open-data-amsterdam/" prefetch={false}>
          Meer openbare Amsterdamse data <ArrowUpRight size={13} />
        </Link>
      </footer>
      {help && (
        <Modal title="Wonen · bronnen & methode" close={() => setHelp(false)}>
          <div className="hs-method">
            <h3>Wat is echt?</h3>
            <p>
              Alle buurten en cijfers komen uit officiële openbare bronnen. De
              vaste momentopname bevat{" "}
              {snapshot.data?.meta.geometryCount ?? "519"} CBS-buurtvlakken,
              inclusief watergebieden;{" "}
              {snapshot.data?.meta.statisticsCount ?? "517"} daarvan hebben een
              rij in CBS-tabel 86165NED. Ontbrekende en onderdrukte waarden
              blijven onbekend.
            </p>
            <h3>WOZ is een buurtcijfer</h3>
            <p>
              Gemiddelde WOZ in euro, CBS-jaar 2025, waardepeildatum 1 januari
              2024. Dit is geen actuele verkoopprijs en geen waarde per
              vierkante meter. Het CBS publiceert alleen bij voldoende woningen
              en dekking. De mediaan hierboven neemt elke buurt even zwaar mee
              en is geen gemiddelde waarde van alle Amsterdamse woningen.
            </p>
            <h3>Meer thema’s, eigen definities en jaren</h3>
            <p>
              De kaartlaag toont altijd het bronjaar en de definitie. Opleiding
              en inkomen kunnen uit een ouder CBS-jaar komen; alleen koppelbare,
              ongewijzigde buurten worden meegenomen. Een woning zonder
              BRP-inschrijving is niet per definitie leegstaand, corporatiebezit
              is niet hetzelfde als sociale huur. Nieuwbouw is het aantal
              toegevoegde nieuwbouwwoningen; recente bouw toont het aandeel
              woningen met bouwjaar in de afgelopen tien jaar.
            </p>
            <h3>WOZ-ontwikkeling</h3>
            <p>
              De reeks vergelijkt buurtgemiddelden uit CBS-jaren 2023, 2024 en
              2025, met waardepeildatum telkens een jaar eerder. De procentuele
              ontwikkeling loopt van CBS-jaar 2024 naar 2025. Ontbrekende
              waarden en wijzigingen in de buurtindeling onderbreken de
              vergelijking. Ook bij gelijke grenzen kan de woningmix veranderen.
            </p>
            <h3>Filters en exports</h3>
            <p>
              Alle voorwaarden gelden tegelijk. Een ontbrekende waarde voldoet
              niet aan een ingevulde grens. GeoJSON bewaart alle bronmetadata en
              actieve filters; CSV bevat de cijfers met hun eenheden. De vaste
              kaartkleuren blijven gebaseerd op heel Amsterdam, zodat filteren
              de schaal niet verandert.
            </p>
            <h3>BAG wordt per buurt geladen</h3>
            <p>
              De browser vraagt alle bronpagina’s binnen de rechthoek om de
              buurt op en selecteert daarna punten binnen de echte buurtgrens,
              inclusief eilanden en gaten. Alleen woonfunctie en in
              gebruik/verbouwing tellen mee, eenmaal per verblijfsobject-ID. De
              BAG is actueel; de CBS-buurtgrens is uit 2025. Randpunten kunnen
              bij beide aangrenzende buurten horen. Fouten of een te grote
              opvraag leveren geen gedeeltelijke telling op.
            </p>
            <p>
              Bouwjaren horen bij de gekoppelde panden, oppervlakte bij het
              verblijfsobject. Het aantal actuele BAG-woningen is niet
              rechtstreeks vergelijkbaar met de CBS-voorraad uit 2025.
            </p>
            <h3>Herkomst en gebruik</h3>
            <p>
              Buurtcijfers worden met de exacte CBS-buurtcode gekoppeld aan
              geometrie van hetzelfde jaar. De BAG-identificaties blijven tekst,
              inclusief voorloopnullen. Adresopvragen gaan rechtstreeks naar
              PDOK; er worden geen bewonersgegevens geladen.
            </p>
            <ul>
              <li>
                <a
                  href="https://opendata.cbs.nl/CBS/nl/dataset/86165NED/table"
                  target="_blank"
                  rel="noreferrer"
                >
                  CBS Kerncijfers wijken en buurten 2025
                </a>
              </li>
              <li>
                <a
                  href="https://api.pdok.nl/cbs/wijken-en-buurten-2025/ogc/v1"
                  target="_blank"
                  rel="noreferrer"
                >
                  PDOK CBS-buurtgeometrie 2025
                </a>
              </li>
              <li>
                <a
                  href="https://www.kadaster.nl/zakelijk/producten/adressen-en-gebouwen/bag-ogc-api-s"
                  target="_blank"
                  rel="noreferrer"
                >
                  BAG OGC API · publiek domein
                </a>
              </li>
            </ul>
            <p>
              CBS-bronvermelding: CBS, Den Haag/Heerlen. Snapshot opgehaald:{" "}
              {snapshot.data
                ? new Date(snapshot.data.meta.retrievedAt).toLocaleDateString(
                    "nl-NL",
                  )
                : "4 november 2026"}
              . Vernieuwbare bronquery’s en SHA-256-controles staan bij de
              bronbestanden.
            </p>
            <Link href="/guides/open-data-amsterdam/" prefetch={false}>
              Bekijk de lijst openbare databronnen →
            </Link>
          </div>
        </Modal>
      )}
    </main>
  );
}
