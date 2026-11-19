"use client";
import { SourceAge } from "@/components/workspaces/source-age";
import { requestSignal } from "@/features/data/source-contract";
import {
  ShareView,
  text,
  flag,
  oneOf,
  recordOf,
  bounded,
} from "@/components/workspaces/view-state";
import { WorkspaceHeader } from "@/components/workspaces/header";
import { dataSwatch } from "@/components/workspaces/data-swatch";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Focus,
  Info,
  Lightbulb,
  MapPinned,
  Route,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { FeatureCollection, MultiLineString } from "geojson";
import { assetPath } from "@/lib/paths";
import { download } from "@/features/playground/project";
import type { HoverMode } from "@/features/bnb/model";
import { heatLabels, heatKinds, defaultHeat, type HeatSettings } from "./heat";
import { ShiftExplorer, ShiftPanel } from "./shift-charts";
import { defaultShift, shiftAnalysis, shiftMethod } from "./shifts";
import { CorrelationPanel } from "./charts";
import {
  aggregate,
  association,
  countAssociation,
  combineCounts,
  clusterStreets,
  createRoads,
  descriptions,
  filterStreets,
  streetScope,
  classify,
  labels,
  metrics,
  roadCSV,
  streetCSV,
  roadGeoJSON,
  scoreColor,
  snapshot,
  statusLabels,
  summary,
  observationMeta,
  units,
  formatValue,
  legendLabels,
  highIsMore,
  clusterMetrics,
  wardNames,
  wards,
  type Filters,
  type Metric,
  type ObservationData,
  type RoadProperties,
  type Status,
} from "./model";
import type { MapMode, StreetRuntime } from "./runtime";
import { number } from "./format";
import { HeatTable } from "./heat-table";
import { StreetDetail } from "./street-detail";
import { StreetTable } from "./street-table";
import { Help } from "./help";
import { HeatControls, HeatLegend, SelectedHeatCell } from "./heat-panels";
import { StreetLegend } from "./street-legend";
import { useHeatView } from "./use-heat-view";
import { AreasPanel, ProfilesPanel } from "./insight-panels";
import "@/features/analysis/analysis.css";
import "./dashboard.css";

const emptyFilters: Filters = {
  ward: null,
  query: "",
  status: "all",
  cluster: null,
  doubleDeficit: false,
};
type Panel = "correlations" | "profiles" | "areas" | "shifts";

export function StreetsDashboard() {
  const [dataset, setDataset] = useState<{
      geometry: FeatureCollection<MultiLineString, RoadProperties>;
      observed: ObservationData;
    } | null>(null),
    [runtime, setRuntime] = useState<StreetRuntime | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters),
    [metric, setMetric] = useState<Metric>("treeDensity");
  const [mapMode, setMapMode] = useState<MapMode>("streets"),
    [hoverMode, setHoverMode] = useState<HoverMode>("follow");
  const [panel, setPanel] = useState<Panel>("correlations"),
    [x, setX] = useState<Metric>("treeDensity"),
    [y, setY] = useState<Metric>("reports");
  const [method, setMethod] = useState<"pearson" | "spearman">("spearman"),
    [level, setLevel] = useState<"street" | "ward">("street"),
    [k, setK] = useState(4);
  const [selected, setSelected] = useState<string | null>(null),
    [help, setHelp] = useState(false),
    [drawer, setDrawer] = useState(false);
  const [showSegments, setShowSegments] = useState(false),
    [selectedSegment, setSelectedSegment] = useState<string | null>(null);
  const selectStreet = useCallback((id: string) => {
    setSelected(id);
    setSelectedSegment(null);
    setShowSegments(false);
  }, []);
  const [failure, setFailure] = useState(""),
    [attempt, setAttempt] = useState(0),
    [notice, setNotice] = useState("");
  const [heat, setHeat] = useState<HeatSettings>(defaultHeat),
    [selectedHeatId, setSelectedHeatId] = useState<string | null>(null),
    [heatExpanded, setHeatExpanded] = useState(false);
  const [months, setMonths] = useState(12),
    [minimumLength, setMinimumLength] = useState(100);
  const roads = useMemo(
    () =>
      dataset ? createRoads(dataset.geometry, dataset.observed, months) : null,
    [dataset, months],
  );
  const [shiftSettings, setShiftSettings] = useState(defaultShift);
  const [wardSearch, setWardSearch] = useState("");
  const container = useRef<HTMLDivElement>(null),
    sidebar = useRef<HTMLElement>(null),
    client = useQueryClient();
  useEffect(() => {
    if (!drawer) return;
    const previous = document.activeElement;
    const controls = () =>
      [
        ...sidebar.current!.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input, select",
        ),
      ].filter((el) => el.getClientRects().length);
    controls()[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawer(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = controls(),
        first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [drawer]);
  const chooseWard = useCallback((ward: string | null) => {
    setFilters((f) => ({ ...f, ward }));
    setSelected(null);
    setDrawer(false);
  }, []);
  useEffect(() => {
    const lifetime = new AbortController();
    void client
      .fetchQuery({
        queryKey: [
          "street-snapshot",
          observationMeta.geometrySha256,
          observationMeta.countsSha256,
          observationMeta.retrieved,
        ],
        staleTime: Infinity,
        gcTime: 30 * 60_000,
        retry: false,
        queryFn: async ({ signal }) => {
          const [geometry, observed] = await Promise.all(
            (
              [
                `/data/amsterdam-roads.${observationMeta.geometrySha256.slice(0, 16)}.geojson`,
                `/data/amsterdam-street-observations.${observationMeta.observationsSha256.slice(0, 16)}.json`,
              ] as const
            ).map(async (path) => {
              const response = await fetch(assetPath(path), {
                signal: requestSignal(signal, 60_000),
              });
              if (!response.ok)
                throw new Error(
                  `Bronbestand niet beschikbaar (${response.status})`,
                );
              return response.json();
            }),
          );
          if (
            geometry.type !== "FeatureCollection" ||
            geometry.features.length !== snapshot.count
          )
            throw new Error("Het straatbestand is onvolledig.");
          createRoads(geometry, observed, 12);
          return { geometry, observed };
        },
      })
      .then((data) => {
        if (!lifetime.signal.aborted) setDataset(data);
      })
      .catch((error) => {
        if (!lifetime.signal.aborted)
          setFailure(error instanceof Error ? error.message : "Laden mislukt");
      });
    void import("./runtime")
      .then(async ({ mountStreets }) => {
        const instance = await mountStreets(
          container.current!,
          lifetime.signal,
          client,
          {
            road: selectStreet,
            segment: setSelectedSegment,
            ward: chooseWard,
            notice: setNotice,
            cell: setSelectedHeatId,
          },
        );
        if (instance && !lifetime.signal.aborted) setRuntime(instance);
      })
      .catch((error) => {
        if (!lifetime.signal.aborted)
          setFailure(
            error instanceof Error ? error.message : "Kaart kon niet starten",
          );
      });
    return () => lifetime.abort();
  }, [attempt, client, chooseWard, selectStreet]);
  const globalStreets = useMemo(() => aggregate(roads ?? []), [roads]);
  const clustering = useMemo(
    () => clusterStreets(globalStreets, k),
    [globalStreets, k],
  );
  const scopedStreets = useMemo(
    () => streetScope(roads ?? [], filters.ward),
    [roads, filters.ward],
  );
  const visibleStreets = useMemo(
    () => filterStreets(scopedStreets, filters, metric, clustering.assignments),
    [scopedStreets, filters, metric, clustering.assignments],
  );
  const visible = useMemo(
    () => visibleStreets.flatMap((s) => s.roads),
    [visibleStreets],
  );
  const {
    view: heatView,
    scale: heatScale,
    selectedCell,
    failure: heatFailure,
    clearFailure: clearHeatFailure,
    retry: retryHeat,
  } = useHeatView({
    active: mapMode === "heat",
    roads: visible,
    heat,
    months,
    selectedId: selectedHeatId,
    client,
  });
  useEffect(() => {
    if (!selectedCell) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedHeatId(null);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [selectedCell]);
  const streets = useMemo(
      () => visibleStreets.filter((s) => s.named),
      [visibleStreets],
    ),
    areas = useMemo(() => aggregate(visible, "ward"), [visible]);
  const cityRaw = useMemo(
    () => combineCounts((roads ?? []).map((r) => r.raw)),
    [roads],
  );
  const shifts = useMemo(
    () =>
      shiftAnalysis(
        streets,
        cityRaw,
        shiftSettings.kind,
        shiftSettings.minimum,
      ),
    [streets, cityRaw, shiftSettings.kind, shiftSettings.minimum],
  );
  const stats = useMemo(() => {
    const base = summary(visible, metric),
      counts = { poor: 0, medium: 0, good: 0, missing: 0 };
    for (const s of visibleStreets) counts[classify(s[metric], metric)]++;
    return { ...base, counts };
  }, [visible, visibleStreets, metric]);
  const selectedStreet = useMemo(
    () => visibleStreets.find((s) => s.id === selected),
    [visibleStreets, selected],
  );
  const cityAreas = useMemo(() => aggregate(roads ?? [], "ward"), [roads]);
  const areaCounts = useMemo(
    () => new Map(cityAreas.map((a) => [a.id, a.count])),
    [cityAreas],
  );
  const rankedAreas = useMemo(
    () =>
      [...areas].sort((a, b) => {
        if (a[metric] === null)
          return b[metric] === null ? a.name.localeCompare(b.name) : 1;
        if (b[metric] === null) return -1;
        return highIsMore[metric]
          ? a[metric]! - b[metric]!
          : b[metric]! - a[metric]!;
      }),
    [areas, metric],
  );
  const allAnalysisRows = level === "street" ? streets : areas;
  const analysisRows = useMemo(
    () => allAnalysisRows.filter((s) => s.length >= minimumLength),
    [allAnalysisRows, minimumLength],
  );
  useEffect(() => {
    if (runtime && roads)
      runtime.setData(
        scopedStreets,
        clustering.assignments,
        clustering.clusters.map((c) => c.color),
      );
  }, [runtime, roads, scopedStreets, clustering]);
  useEffect(() => {
    runtime?.render(
      visibleStreets,
      metric,
      mapMode,
      filters.ward,
      areas,
      selectedStreet?.id ?? null,
      hoverMode,
      showSegments,
      selectedSegment,
    );
  }, [
    runtime,
    visibleStreets,
    metric,
    mapMode,
    filters.ward,
    areas,
    selectedStreet,
    hoverMode,
    showSegments,
    selectedSegment,
  ]);
  useEffect(() => {
    runtime?.renderHeat(
      heatView,
      heat,
      heatScale,
      selectedCell?.properties.id ?? null,
    );
  }, [runtime, heatView, heat, heatScale, selectedCell]);
  useEffect(() => {
    runtime?.fit(null);
  }, [runtime]);
  const reset = () => {
    setFilters(emptyFilters);
    setSelected(null);
  };
  const update = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setSelected(null);
  };
  const selectObservation = (id: string) => {
    if (level === "ward") {
      chooseWard(id);
      runtime?.fit(id);
    } else selectStreet(id);
  };
  const exportData = (
    kind: "streetcsv" | "csv" | "geojson" | "analysis" | "heat",
  ) => {
    if (kind === "heat" && heatView)
      download(
        JSON.stringify({
          ...(heatView.polygons ?? heatView.data),
          metadata: {
            shape: heat.shape,
            subject: heat.kind,
            total: heatView.total,
            cellMetres: heatView.hexWidth ?? 25,
            sourceCellMetres: 25,
            gridOrigin: [4.9, 52.37],
            metresPerDegree: [67900, 111200],
            coordinateMeaning:
              heat.shape === "hex"
                ? "Regular hexagon polygons aggregated from 25m source grid centres"
                : "25m source grid centres, not individual source points",
            radiusMetres: heat.shape === "smooth" ? heat.radius : null,
            hexWidthMetres: heat.shape === "hex" ? heat.radius : null,
            contrast: heat.contrast,
            reference: heatScale,
            normalization:
              "citywide 12-month p95 reference, fixed for filters and viewport",
            months,
            retrieved: observationMeta.retrieved,
            countsSha256: observationMeta.countsSha256,
            filters,
          },
        }),
        "amsterdam-concentraties.geojson",
        "application/geo+json",
      );
    else if (kind === "streetcsv")
      download(
        streetCSV(visibleStreets, clustering.assignments),
        "amsterdam-straatindicatoren.csv",
        "text/csv;charset=utf-8",
      );
    else if (kind === "csv")
      download(
        roadCSV(visible, clustering.assignments),
        "amsterdam-wegvakregistraties.csv",
        "text/csv;charset=utf-8",
      );
    else if (kind === "geojson")
      download(
        JSON.stringify(roadGeoJSON(visible, clustering.assignments)),
        "amsterdam-wegvakregistraties.geojson",
        "application/geo+json",
      );
    else {
      const r = association(analysisRows, x, y, method);
      download(
        JSON.stringify(
          {
            dataType: "observed_counts_derived_spatially",
            sources: observationMeta,
            geography: snapshot,
            map: {
              mode: mapMode,
              heat:
                mapMode === "heat"
                  ? {
                      ...heat,
                      reference: heatScale,
                      total: heatView?.total,
                      cellMetres: heatView?.hexWidth ?? 25,
                      sourceCellMetres: 25,
                    }
                  : null,
            },
            thresholds: "Illustrative map classes; not official standards",
            months,
            reportStart: observationMeta.months[12 - months],
            reportEndExclusive: observationMeta.reportEndExclusive,
            aggregation:
              "Sum raw counts, then divide by eligible lamp statuses or NWB source length; parallel carriageways count separately. Apply filters to whole streets AFTER aggregation. Zero matched records does not establish absence.",
            streets: visibleStreets.map(
              ({ geometry: ignoredGeometry, roads: ignoredRoads, ...s }) => {
                void ignoredGeometry;
                void ignoredRoads;
                return s;
              },
            ),
            filters,
            mappedMetric: metric,
            method,
            level,
            minimumLength,
            x,
            y,
            correlation: {
              r: r.r,
              n: r.n,
              rawCountSensitivity: countAssociation(analysisRows, x, y, method),
              excludedMissingPair: r.excluded,
              excludedShort: allAnalysisRows.length - analysisRows.length,
            },
            clusters: {
              k,
              variables: clusterMetrics,
              transform:
                "log(1+x), z-standardized; citywide streets >=100m; deterministic k-means",
              centroids: clustering.clusters,
              excluded: clustering.excluded,
              iterations: clustering.iterations,
              converged: clustering.converged,
              explainedVariance: clustering.explainedVariance,
            },
            areas: rankedAreas,
            shifts: {
              settings: shiftSettings,
              method: shiftMethod,
              citySeries: shifts.citySeries,
              eligible: shifts.eligible.length,
              exclusions: shifts.exclusions,
              rows: shifts.rows,
            },
            caveat:
              "Descriptive associations only. Snapshot assets vs historical reports; reporting bias; spatial dependence; no causal inference or street safety score.",
          },
          null,
          2,
        ),
        "amsterdam-straatmonitor-analyse.json",
        "application/json",
      );
    }
    setNotice(
      `${kind === "analysis" ? "Analyseverslag" : kind === "heat" ? "Concentratievakken" : kind === "streetcsv" ? `${number(visibleStreets.length)} straatindicatoren` : `${number(visible.length)} gefilterde wegvakken`} geëxporteerd met bronaantallen, perioden en koppelregels.`,
    );
  };
  const ready = !!roads && !!runtime;
  const activeFilters =
    !!filters.ward ||
    !!filters.query ||
    filters.status !== "all" ||
    filters.cluster !== null ||
    filters.doubleDeficit;
  return (
    <main
      lang="nl"
      className={`an-root st-root${mapMode === "heat" && heatExpanded ? " st-heat-expanded" : ""}`}
      data-streets
      data-ready={ready ? "true" : undefined}
      data-count={visible.length}
      data-street-count={visibleStreets.length}
      data-map-mode={mapMode}
      data-heat-ready={heatView ? "true" : undefined}
    >
      <a href="#street-map" className="skip-link">
        Direct naar de kaart
      </a>
      <WorkspaceHeader
        current="/analysis/streets/"
        tagline="Van straat naar inzicht"
        className="an-header st-header"
        brandClassName="an-brand"
      >
        <div className="workspace-header-actions">
          <ShareView
            app="streets"
            data={{
              metric,
              months,
              selected,
              filters,
              mapMode,
              x,
              y,
              method,
              level,
              k,
              heat,
              shiftSettings,
              panel,
              minimumLength,
            }}
            defaults={{
              metric: "treeDensity",
              months: 12,
              selected: null,
              filters: emptyFilters,
              mapMode: "streets",
              x: "treeDensity",
              y: "reports",
              method: "spearman",
              level: "street",
              k: 4,
              heat: defaultHeat,
              shiftSettings: defaultShift,
              panel: "correlations",
              minimumLength: 100,
            }}
            rules={{
              metric: oneOf(metrics),
              months: oneOf([1, 3, 6, 12]),
              selected: (v) => v === null || text(v),
              filters: (v) =>
                !!v &&
                typeof v === "object" &&
                "query" in v &&
                text(v.query) &&
                "ward" in v &&
                (v.ward === null ||
                  wards.some((w) => w.properties.code === v.ward)) &&
                "status" in v &&
                oneOf(["all", "poor", "medium", "good", "missing"])(v.status) &&
                "cluster" in v &&
                (v.cluster === null || oneOf([0, 1, 2, 3, 4, 5])(v.cluster)) &&
                "doubleDeficit" in v &&
                flag(v.doubleDeficit),
              mapMode: oneOf(["streets", "wards", "clusters", "heat"]),
              x: oneOf(metrics),
              y: oneOf(metrics),
              method: oneOf(["pearson", "spearman"]),
              level: oneOf(["street", "ward"]),
              k: oneOf([2, 3, 4, 5, 6]),
              heat: recordOf({
                kind: oneOf(heatKinds),
                radius: oneOf([100, 250, 500]),
                contrast: bounded(0.5, 1.8),
                shape: oneOf(["smooth", "hex"]),
              }),
              shiftSettings: recordOf({
                kind: oneOf(["reports", "nuisance", "maintenance"]),
                minimum: bounded(0, 10000),
                direction: oneOf(["up", "down", "all"]),
                sort: oneOf(["count", "relative"]),
              }),
              panel: oneOf(["correlations", "profiles", "areas", "shifts"]),
              minimumLength: bounded(0, 10000),
            }}
            apply={(v) => {
              setMetric(v.metric as Metric);
              setMonths(v.months as number);
              setSelected(v.selected as string | null);
              setFilters(v.filters as Filters);
              setMapMode(v.mapMode as MapMode);
              setX(v.x as Metric);
              setY(v.y as Metric);
              setMethod(v.method as "pearson" | "spearman");
              setLevel(v.level as "street" | "ward");
              setK(v.k as number);
              setHeat(v.heat as HeatSettings);
              setShiftSettings(v.shiftSettings as typeof defaultShift);
              setPanel(v.panel as Panel);
              setMinimumLength(v.minimumLength as number);
            }}
          />
          <button className="workspace-action" onClick={() => setHelp(true)}>
            <Info size={15} aria-hidden="true" />
            <span className="workspace-label">Bronnen & methode</span>
          </button>
        </div>
      </WorkspaceHeader>
      <SourceAge
        retrievedAt={observationMeta.retrieved}
        className="workspace-source-age"
      />
      <section className="st-hero">
        <div>
          <div className="st-kicker">
            AMSTERDAM / STRAATLAB{" "}
            <span>ECHTE OPEN DATA · {observationMeta.retrieved}</span>
          </div>
          <h1>
            Amsterdam door de ogen van data<span>.</span>
          </h1>
          <p>
            Verken gemeentelijke bomen, lichtobjecten en meldingen. Vergelijk
            straten en ontdek patronen in echte registraties.
          </p>
        </div>
        <details className="an-export">
          <summary className="an-button">
            <ArrowDownToLine size={14} />
            Exporteer selectie
          </summary>
          <div>
            {(
              [
                "streetcsv",
                "csv",
                "geojson",
                "analysis",
                ...(mapMode === "heat" ? ["heat" as const] : []),
              ] as const
            ).map((kind) => (
              <button
                disabled={
                  !ready ||
                  !visible.length ||
                  (kind === "heat" && !heatView?.total)
                }
                key={kind}
                onClick={(event) => {
                  exportData(kind);
                  event.currentTarget.closest("details")!.open = false;
                }}
              >
                {kind === "streetcsv"
                  ? "Straatindicatoren CSV"
                  : kind === "csv"
                    ? "Wegvakken CSV"
                    : kind === "geojson"
                      ? "Lijnen GeoJSON"
                      : kind === "heat"
                        ? "Concentraties GeoJSON"
                        : "Analyseverslag JSON"}
              </button>
            ))}
          </div>
        </details>
      </section>
      <div className="st-demo-strip">
        <span>
          <i />
          Echte gemeentelijke registraties · gekoppeld aan NWB-wegvakken
        </span>
        <span>
          Registraties zijn signalen, geen veiligheidsoordeel.{" "}
          <button onClick={() => setHelp(true)}>
            Hoe werkt dit? <ArrowUpRight size={11} />
          </button>
        </span>
      </div>
      <div className="st-layout">
        <aside
          ref={sidebar}
          role={drawer ? "dialog" : undefined}
          aria-modal={drawer || undefined}
          className={`st-sidebar${drawer ? " st-open" : ""}`}
          aria-label="Gebieden en filters"
        >
          <div className="st-side-title">
            <h2>
              <SlidersHorizontal size={15} />
              Je onderzoeksgebied
            </h2>
            <button
              className="st-mobile-close an-icon"
              aria-label="Sluit filters"
              onClick={() => setDrawer(false)}
            >
              <X size={16} />
            </button>
          </div>
          <label className="st-search">
            <Search size={14} />
            <input
              aria-label="Zoek straat of wegvak"
              placeholder="Straatnaam of NWB-ID…"
              value={filters.query}
              onChange={(e) => update({ query: e.target.value })}
            />
          </label>
          <label className="st-field">
            Periode meldingen
            <select
              aria-label="Periode meldingen"
              value={months}
              onChange={(e) => {
                setMonths(+e.target.value);
                setSelected(null);
              }}
            >
              <option value={12}>12 volledige maanden</option>
              <option value={3}>3 volledige maanden</option>
            </select>
          </label>
          <p className="st-side-explanation">
            {observationMeta.months[12 - months]} t/m{" "}
            {observationMeta.months.at(-1)} · lichtobjecten/bomen: download{" "}
            {observationMeta.retrieved}
          </p>
          <label className="st-field">
            {mapMode === "heat"
              ? "Straatfilters op indicator"
              : "Kaartindicator"}
            <select
              aria-label="Kaartindicator"
              value={metric}
              onChange={(e) => {
                setMetric(e.target.value as Metric);
                setSelected(null);
              }}
            >
              {metrics.map((m) => (
                <option value={m} key={m}>
                  {labels[m]}
                </option>
              ))}
            </select>
          </label>
          <p className="st-side-explanation">
            {descriptions[metric]}
            <br />
            Eenheid: {units[metric]}
          </p>
          <label className="st-field">
            Kleurfilter
            <select
              aria-label="Kleurfilter"
              value={filters.status}
              onChange={(e) => update({ status: e.target.value as Status })}
            >
              <option value="all">Alle klassen</option>
              {Object.entries(legendLabels(metric)).map(([key, name]) => (
                <option key={key} value={key}>
                  {key === "missing"
                    ? name
                    : `${statusLabels[key as keyof typeof statusLabels]} · ${name}`}
                </option>
              ))}
            </select>
          </label>
          <label className="st-check">
            <input
              type="checkbox"
              checked={filters.doubleDeficit}
              onChange={(e) => update({ doubleDeficit: e.target.checked })}
            />
            <span>
              Minstens 2 aandachtssignalen
              <small>Veel storingen, weinig bomen, hoge meldingsdruk</small>
            </span>
          </label>
          {filters.cluster !== null && (
            <button
              className="st-filter-chip"
              onClick={() => update({ cluster: null })}
            >
              Profiel {filters.cluster + 1} actief <X size={13} />
            </button>
          )}
          {activeFilters && (
            <button className="st-reset" onClick={reset}>
              Wis alle filters
            </button>
          )}
          <div className="st-area-title">
            <h3>
              <MapPinned size={14} />
              Gebieden
            </h3>
            <span>{wards.length} wijken</span>
          </div>
          <label className="st-search st-ward-search">
            <Search size={13} />
            <input
              aria-label="Zoek wijk"
              placeholder="Zoek wijk…"
              value={wardSearch}
              onChange={(e) => setWardSearch(e.target.value)}
            />
          </label>
          <div className="st-ward-list">
            <button
              className={!filters.ward ? "st-active" : ""}
              aria-pressed={!filters.ward}
              onClick={() => chooseWard(null)}
            >
              <span>Heel Amsterdam</span>
              <small>{number(roads?.length ?? snapshot.count)}</small>
            </button>
            {[
              ...wards.map((w) => ({
                id: w.properties.code,
                name: w.properties.name,
              })),
              { id: "outside", name: "Buiten wijkindeling" },
            ]
              .filter((w) =>
                w.name
                  .toLocaleLowerCase("nl")
                  .includes(wardSearch.trim().toLocaleLowerCase("nl")),
              )
              .map((w) => (
                <button
                  key={w.id}
                  aria-pressed={filters.ward === w.id}
                  className={filters.ward === w.id ? "st-active" : ""}
                  onClick={() => chooseWard(w.id)}
                >
                  <span>{w.name}</span>
                  <small>{number(areaCounts.get(w.id) ?? 0)}</small>
                </button>
              ))}
          </div>
          <p className="st-side-foot">
            Dezelfde 110 gebieden als in het B&B-voorbeeld. De aantallen naast
            de wijken zijn bronwegvakken. Een grensoverschrijdend wegvak hoort
            bij het gebied van zijn representatieve punt. Eerst tellen we de
            registraties binnen dit gebied op; daarna filteren we op
            straatindicatoren. Zo blijven alle wegvakken van een straat samen.
          </p>
        </aside>
        <div className="st-center">
          <div className="st-stats" aria-label="Statistieken van de selectie">
            <div>
              <span>Straten in selectie</span>
              <strong data-st-stat="count">
                {ready ? number(visibleStreets.length) : "…"}
              </strong>
              <small>
                {number(visible.length)} bronwegvakken · {number(stats.km)} km
                NWB
              </small>
            </div>
            {mapMode === "heat" ? (
              <>
                <div>
                  <span>{heatLabels[heat.kind]} in selectie</span>
                  <strong className="st-heat-number" data-st-stat="heat-total">
                    {heatView ? number(heatView.total) : "…"}
                  </strong>
                  <small>
                    {heatView ? number(heatView.cells) : "…"}{" "}
                    {heat.shape === "hex"
                      ? `hexagonen · ${heat.radius} m breed`
                      : "bronvakken · 25 × 25 m"}
                  </small>
                </div>
                <div>
                  <span>Kleurenschaal</span>
                  <strong className="st-heat-scale">Vast</strong>
                  <small>Per onderwerp en vakmaat · gelijk bij filteren</small>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span>{labels[metric]}</span>
                  <strong
                    data-swatch
                    style={dataSwatch(scoreColor(stats.average, metric))}
                    data-st-stat="average"
                  >
                    {formatValue(stats.average, metric)}
                  </strong>
                  <small>{units[metric]} · uit opgetelde bronaantallen</small>
                </div>
                <div>
                  <span>Rode klasse</span>
                  <strong className="st-red">
                    {number(stats.counts.poor)}
                  </strong>
                  <small>
                    {visibleStreets.length
                      ? number(
                          (stats.counts.poor / visibleStreets.length) * 100,
                          1,
                        )
                      : 0}
                    % van straten · {number(stats.counts.missing)} met
                    onvoldoende basis
                  </small>
                </div>
              </>
            )}
          </div>
          <div className="st-map-toolbar">
            <div className="st-segmented" aria-label="Kaartweergave">
              {(["streets", "heat", "wards", "clusters"] as const).map(
                (mode) => (
                  <button
                    aria-pressed={mapMode === mode}
                    key={mode}
                    onClick={() => {
                      if (mode === "heat" && mapMode !== "heat")
                        clearHeatFailure();
                      setMapMode(mode);
                    }}
                  >
                    {mode === "streets"
                      ? "Straten"
                      : mode === "heat"
                        ? "Concentraties"
                        : mode === "wards"
                          ? "Wijken"
                          : "Profielen"}
                  </button>
                ),
              )}
            </div>
            <button
              className="an-button st-mobile-filters"
              onClick={(event) => {
                event.currentTarget.focus();
                setDrawer(true);
              }}
            >
              <SlidersHorizontal size={13} />
              Filters
            </button>
            <button
              className="st-fit"
              aria-label="Zoom naar onderzoeksgebied"
              onClick={() =>
                mapMode === "heat"
                  ? runtime?.fitHeat()
                  : runtime?.fit(filters.ward)
              }
            >
              <Focus size={14} />
              <span>
                {mapMode === "heat"
                  ? "Zoom naar concentraties"
                  : "Zoom naar gebied"}
              </span>
            </button>
          </div>
          {mapMode === "heat" && (
            <HeatControls
              heat={heat}
              setHeat={setHeat}
              clearSelection={() => setSelectedHeatId(null)}
              expanded={heatExpanded}
              setExpanded={setHeatExpanded}
              months={months}
              runtime={runtime}
            />
          )}
          <section
            className={`st-map-frame${mapMode === "heat" ? " st-heat-frame" : ""}${mapMode === "heat" && heat.shape === "hex" ? " st-hex-frame" : ""}`}
            aria-label={
              mapMode === "heat"
                ? "Concentratiekaart Amsterdam"
                : "Kaart straatkwaliteit"
            }
          >
            <div
              ref={container}
              id="street-map"
              className="st-map"
              role="region"
              aria-label="Amsterdamse straatindicatoren en wijken"
              tabIndex={-1}
            />
            {!ready && (
              <div className="st-loading">
                <Route size={30} />
                <strong>
                  {failure
                    ? "Laden lukt nog niet"
                    : "Amsterdam wordt in kaart gebracht…"}
                </strong>
                <span>
                  {failure ||
                    `${number(snapshot.count)} echte wegvakken · lokale dataset`}
                </span>
                {failure && (
                  <button
                    className="an-button"
                    onClick={() => {
                      setFailure("");
                      setRuntime(null);
                      setDataset(null);
                      setAttempt((a) => a + 1);
                    }}
                  >
                    Opnieuw proberen
                  </button>
                )}
              </div>
            )}
            <div className="st-map-caption">
              <MapPinned size={13} />
              <span>
                {filters.ward ? wardNames.get(filters.ward) : "Heel Amsterdam"}
              </span>
              <select
                aria-label="Informatie bij aanwijzen"
                value={hoverMode}
                onChange={(e) => setHoverMode(e.target.value as HoverMode)}
              >
                <option value="follow">Info volgt muis</option>
                <option value="fixed">Info in het midden</option>
                <option value="click">Bij klik in het midden</option>
                <option value="off">Info uit</option>
              </select>
            </div>
            {mapMode === "heat" ? (
              <>
                {!heatView && (
                  <div className="st-heat-message" role="status">
                    <strong>
                      {heatFailure
                        ? "Concentraties laden lukt nog niet"
                        : "Bronlocaties worden voorbereid…"}
                    </strong>
                    <p>
                      {heatFailure ||
                        "De straatkaart en analyses blijven beschikbaar."}
                    </p>
                    {heatFailure && (
                      <button
                        className="an-button"
                        onClick={() => {
                          retryHeat();
                        }}
                      >
                        Probeer concentraties opnieuw
                      </button>
                    )}
                  </div>
                )}
                {heatView && !heatView.total && (
                  <div className="st-heat-message" role="status">
                    <strong>
                      Geen {heatLabels[heat.kind].toLocaleLowerCase("nl")} in
                      deze selectie
                    </strong>
                    <p>Kies een ander onderwerp of verruim de straatfilters.</p>
                    <button className="an-button" onClick={reset}>
                      Wis straatfilters
                    </button>
                  </div>
                )}
                <HeatLegend heat={heat} scale={heatScale} />
                {selectedCell && hoverMode !== "off" && (
                  <SelectedHeatCell
                    cell={selectedCell}
                    heat={heat}
                    close={() => setSelectedHeatId(null)}
                    selectStreet={selectStreet}
                  />
                )}
              </>
            ) : (
              <StreetLegend
                mapMode={mapMode}
                metric={metric}
                clusters={clustering.clusters}
                segments={showSegments && !!selectedStreet}
              />
            )}
          </section>
          {mapMode === "heat" && heatView && (
            <HeatTable
              view={heatView}
              selected={selectedHeatId}
              select={setSelectedHeatId}
            />
          )}
          <div className="st-story">
            <Lightbulb size={17} />
            <div>
              <strong>Begin met een onderzoeksvraag</strong>
              <p>Waar combineren weinig bomen en veel meldingen?</p>
            </div>
            <button
              onClick={() => {
                reset();
                setMetric("treeDensity");
                setX("treeDensity");
                setY("reports");
                setLevel("street");
                setMethod("spearman");
                setPanel("correlations");
                setMapMode("streets");
              }}
            >
              Bekijk het verband <ArrowUpRight size={13} />
            </button>
            <button
              onClick={() => {
                update({ doubleDeficit: !filters.doubleDeficit });
                setPanel("areas");
                setMapMode("wards");
              }}
            >
              Vind aandachtspunten <ArrowUpRight size={13} />
            </button>
            <button
              onClick={() => {
                setPanel("shifts");
                setMapMode("streets");
              }}
            >
              Wat verandert er? <ArrowUpRight size={13} />
            </button>
          </div>
          {panel === "shifts" && (
            <ShiftExplorer
              result={shifts}
              settings={shiftSettings}
              selected={selectedStreet?.id ?? null}
              select={selectStreet}
            />
          )}
          {selectedStreet && (
            <StreetDetail
              key={selectedStreet.id}
              street={selectedStreet}
              metric={metric}
              cluster={clustering.assignments.get(selectedStreet.id)}
              clear={() => {
                setSelected(null);
                setShowSegments(false);
              }}
              zoom={() => {
                runtime?.focus(selectedStreet);
                container.current
                  ?.closest(".st-map-frame")
                  ?.scrollIntoView({ block: "center", behavior: "auto" });
              }}
              showSegments={showSegments && mapMode !== "heat"}
              toggleSegments={() => {
                if (mapMode === "heat") {
                  setMapMode("streets");
                  setShowSegments(true);
                } else setShowSegments((v) => !v);
                setSelectedSegment(null);
              }}
              segment={selectedSegment}
              selectSegment={setSelectedSegment}
              scoped={!!filters.ward}
            />
          )}
          <StreetTable
            streets={visibleStreets}
            metric={metric}
            select={selectStreet}
            selected={selectedStreet?.id ?? null}
          />
        </div>
        <aside className="st-insights" aria-label="Analyses van de selectie">
          <div
            className="st-analysis-tabs"
            role="tablist"
            aria-label="Analysetype"
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              const tabs = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button",
                  ),
                ],
                index = tabs.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        tabs.length) %
                      tabs.length;
              event.preventDefault();
              tabs[next]?.focus();
              tabs[next]?.click();
            }}
          >
            {(["correlations", "profiles", "areas", "shifts"] as const).map(
              (p) => (
                <button
                  key={p}
                  id={`st-tab-${p}`}
                  role="tab"
                  tabIndex={panel === p ? 0 : -1}
                  aria-controls={`st-panel-${p}`}
                  aria-selected={panel === p}
                  onClick={() => setPanel(p)}
                >
                  {p === "correlations"
                    ? "Verbanden"
                    : p === "profiles"
                      ? "Clusters"
                      : p === "areas"
                        ? "Gebieden"
                        : "Verandering"}
                </button>
              ),
            )}
          </div>
          <div
            className="st-analysis-body"
            id={`st-panel-${panel}`}
            role="tabpanel"
            aria-labelledby={`st-tab-${panel}`}
          >
            {!roads ? (
              <p className="st-muted">
                De analyses verschijnen zodra de straatgegevens geladen zijn.
              </p>
            ) : panel === "shifts" ? (
              <ShiftPanel
                result={shifts}
                settings={shiftSettings}
                setSettings={setShiftSettings}
                selected={selectedStreet?.id ?? null}
                select={selectStreet}
              />
            ) : panel === "correlations" ? (
              <CorrelationPanel
                rows={analysisRows}
                minimumLength={minimumLength}
                setMinimumLength={setMinimumLength}
                excludedShort={allAnalysisRows.length - analysisRows.length}
                x={x}
                y={y}
                setX={setX}
                setY={setY}
                method={method}
                setMethod={setMethod}
                level={level}
                setLevel={setLevel}
                select={selectObservation}
              />
            ) : panel === "profiles" ? (
              <ProfilesPanel
                clustering={clustering}
                k={k}
                setK={(next) => {
                  setK(next);
                  update({ cluster: null });
                }}
                streets={streets}
                activeCluster={filters.cluster}
                setCluster={(cluster) => update({ cluster })}
                showOnMap={() => setMapMode("clusters")}
              />
            ) : (
              <AreasPanel
                areas={rankedAreas}
                metric={metric}
                months={months}
                choose={(ward) => {
                  chooseWard(ward);
                  runtime?.fit(ward);
                }}
                showOnMap={() => setMapMode("wards")}
              />
            )}
          </div>
        </aside>
      </div>
      <footer className="st-footer">
        <span>
          <i />
          Lokale snapshot · geen live monitor
        </span>
        <span>
          Gemeente Amsterdam + NWB / PDOK · download {observationMeta.retrieved}
        </span>
        <button onClick={() => setHelp(true)}>
          Bronnen, dekking & rekenregels <ArrowUpRight size={12} />
        </button>
      </footer>
      {notice && (
        <div className="an-notice" role="status">
          <span>{notice}</span>
          <button aria-label="Sluit melding" onClick={() => setNotice("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {help && <Help close={() => setHelp(false)} />}
    </main>
  );
}
