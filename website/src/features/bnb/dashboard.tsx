"use client";

import Link from "next/link";
import { ShareView, text, oneOf } from "@/components/workspaces/view-state";
import { WorkspaceNavigation } from "@/components/workspaces/navigation";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  BedDouble,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Focus,
  Info,
  Layers2,
  MapPin,
  MapPinned,
  MousePointer2,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { assetPath } from "@/lib/paths";
import { download } from "@/features/playground/project";
import { Modal } from "@/features/analysis/modal";
import {
  available,
  availabilityColor,
  availabilityLabel,
  boundarySource,
  cityStats,
  createBnbModel,
  wardCSV,
  wardStats,
  legend,
  permitCSV,
  permitGeoJSON,
  permitSource,
  queueThreshold,
  scenarioDate,
  statusColor,
  statusLabel,
  visiblePermits,
  type CapacityMode,
  type Permit,
  type PermitStatus,
  type HoverMode,
} from "./model";
import type { BnbRuntime } from "./runtime";
import "@/features/analysis/analysis.css";
import "./dashboard.css";

const number = (value: number | null, digits = 0) =>
  value === null
    ? "—"
    : value.toLocaleString("nl-NL", { maximumFractionDigits: digits });

export function BnbDashboard() {
  const [model] = useState(createBnbModel);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<"all" | PermitStatus>("all");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<CapacityMode>("current");
  const [hoverMode, setHoverMode] = useState<HoverMode>("follow");
  const [rankMode, setRankMode] = useState<"count" | "share">("count");
  const [wardSearch, setWardSearch] = useState("");
  const [focused, setFocused] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<"wards" | "insights" | null>(null);
  const [help, setHelp] = useState(false);
  const [runtime, setRuntime] = useState<BnbRuntime | null>(null);
  const [failure, setFailure] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const client = useQueryClient();
  const chooseWard = useCallback((code: string | null) => {
    setSelected(code);
    setFocused(null);
    setStatus("all");
    setQuery("");
    setDrawer(null);
  }, []);
  const wards = model.wards.features;
  const wardStatistics = useMemo(
    () =>
      new Map(
        wards.map((ward) => [
          ward.properties.code,
          wardStats(model, ward.properties.code),
        ]),
      ),
    [wards, model],
  );
  const matchingWards = wards.filter((ward) =>
    ward.properties.name
      .toLocaleLowerCase("nl")
      .includes(wardSearch.trim().toLocaleLowerCase("nl")),
  );
  const ranking = useMemo(
    () =>
      wards
        .map((ward) => ({
          ward,
          count: available(wardStatistics.get(ward.properties.code)!, mode),
          quota: wardStatistics.get(ward.properties.code)!.quota,
        }))
        .map((item) => ({
          ...item,
          value:
            rankMode === "share"
              ? item.quota
                ? (item.count / item.quota) * 100
                : 0
              : item.count,
        }))
        .sort(
          (a, b) =>
            b.value - a.value ||
            a.ward.properties.name.localeCompare(b.ward.properties.name),
        )
        .slice(0, 10),
    [wards, wardStatistics, mode, rankMode],
  );
  const ward = wards.find((d) => d.properties.code === selected);
  const stats = useMemo(
    () => (selected ? wardStatistics.get(selected)! : cityStats(model)),
    [model, selected, wardStatistics],
  );
  const totals = useMemo(() => cityStats(model), [model]);
  const locations = useMemo(
    () => visiblePermits(model, selected, status, query),
    [model, selected, status, query],
  );
  const focusedPermit = locations.find((p) => p.id === focused) ?? null;
  const name = ward?.properties.name ?? "Heel Amsterdam";
  const free = available(stats, mode);
  useEffect(() => {
    const lifetime = new AbortController();
    void import("./runtime")
      .then(async ({ mountBnb }) => {
        const instance = await mountBnb(
          container.current!,
          lifetime.signal,
          client,
          { ward: chooseWard, permit: setFocused, notice: setNotice },
        );
        if (instance && !lifetime.signal.aborted) setRuntime(instance);
      })
      .catch((error) => {
        if (!lifetime.signal.aborted) {
          setFailure(
            error instanceof Error
              ? error.message
              : "De kaart kon niet starten.",
          );
          lifetime.abort();
        }
      });
    return () => lifetime.abort();
  }, [attempt, client, chooseWard]);
  useEffect(() => {
    runtime?.render(model, selected, locations, mode, focused);
  }, [runtime, model, selected, locations, mode, focused]);
  // Frame the city once on mount. Area selection changes the data, not the camera.
  useEffect(() => {
    runtime?.fit(model, null);
  }, [runtime, model]);
  useEffect(() => {
    runtime?.focus(focusedPermit);
  }, [runtime, focusedPermit]);
  useEffect(() => {
    runtime?.setHoverMode(hoverMode);
  }, [runtime, hoverMode]);

  const exportData = (kind: "wards" | "csv" | "geojson") => {
    const stem = `bnb-demo-${selected ?? "amsterdam"}-${scenarioDate}`;
    if (kind === "wards")
      download(
        wardCSV(model),
        `bnb-demo-wijken-${scenarioDate}.csv`,
        "text/csv;charset=utf-8",
      );
    else if (kind === "csv")
      download(permitCSV(locations), `${stem}.csv`, "text/csv;charset=utf-8");
    else
      download(
        JSON.stringify(permitGeoJSON(locations)),
        `${stem}.geojson`,
        "application/geo+json",
      );
    setNotice(
      `${kind === "wards" ? "Wijkoverzicht" : `${locations.length} gefilterde voorbeeldlocaties`} geëxporteerd. Alle vergunningcijfers zijn fictief.`,
    );
  };

  return (
    <main
      lang="nl"
      className="an-root bb-root"
      data-bnb
      data-ready={runtime ? "true" : undefined}
      data-selected={selected ?? "all"}
      data-location-count={locations.length}
    >
      <a href="#bnb-map" className="skip-link">
        Direct naar de kaart
      </a>
      <header className="an-header bb-header">
        <Link className="an-brand" href="/" prefetch={false}>
          <Image
            src={assetPath("/logo.svg")}
            alt=""
            width={31}
            height={31}
            priority
          />
          <span>
            Map Master<small>VAN GEBIED NAAR INZICHT</small>
          </span>
        </Link>
        <WorkspaceNavigation current="/analysis/bnb/" />
        <Link className="an-docs" href="/playground/" prefetch={false}>
          Playground <ArrowUpRight size={14} />
        </Link>
      </header>

      <div className={`bb-workbench${drawer ? ` bb-show-${drawer}` : ""}`}>
        <div className="bb-titlebar">
          <div>
            <div className="an-eyebrow">
              VERGUNNINGENMONITOR <span>DEMO · 3 NOV 2026</span>
            </div>
            <div className="an-heading-row">
              <h1>Waar is nog ruimte voor een B&B?</h1>
              <button
                className="an-info-button"
                aria-label="Uitleg B&B-voorbeeld"
                aria-haspopup="dialog"
                title="Uitleg en databronnen"
                onClick={(event) => {
                  event.currentTarget.focus();
                  setHelp(true);
                }}
              >
                <Info size={16} />
              </button>
            </div>
            <p>Echte wijkgrenzen · fictieve quota, vergunningen en locaties.</p>
          </div>
          <div className="bb-title-actions">
            <ShareView
              app="bnb"
              data={{ selected, status, query, mode, rankMode }}
              defaults={{
                selected: null,
                status: "all",
                query: "",
                mode: "current",
                rankMode: "count",
              }}
              rules={{
                selected: (v) =>
                  v === null || wards.some((w) => w.properties.code === v),
                status: oneOf(["all", "granted", "pending"]),
                query: text,
                mode: oneOf(["current", "after-pending"]),
                rankMode: oneOf(["count", "share"]),
              }}
              apply={(v) => {
                setSelected(v.selected as string | null);
                setStatus(v.status as "all" | PermitStatus);
                setQuery(v.query as string);
                setMode(v.mode as CapacityMode);
                setRankMode(v.rankMode as "count" | "share");
                setFocused(null);
              }}
            />
            <details className="an-export bb-export">
              <summary
                className="an-button"
                aria-label="Exporteer B&B-voorbeeld"
              >
                <ArrowDownToLine size={14} />
                <span>Exporteer</span>
              </summary>
              <div>
                {(["wards", "csv", "geojson"] as const).map((kind) => (
                  <button
                    key={kind}
                    disabled={kind !== "wards" && selected === null}
                    onClick={(event) => {
                      exportData(kind);
                      event.currentTarget.closest("details")!.open = false;
                    }}
                  >
                    {kind === "wards"
                      ? "Wijken CSV"
                      : kind === "csv"
                        ? "Locaties CSV"
                        : "Locaties GeoJSON"}
                  </button>
                ))}
              </div>
            </details>
          </div>
        </div>
        <div className="bb-mobile-tabs">
          <button
            aria-expanded={drawer === "wards"}
            onClick={() => setDrawer(drawer === "wards" ? null : "wards")}
          >
            <SlidersHorizontal size={15} />
            Wijken
          </button>
          <button
            aria-expanded={drawer === "insights"}
            onClick={() => setDrawer(drawer === "insights" ? null : "insights")}
          >
            <BarChart3 size={15} />
            Inzichten
          </button>
        </div>
        <aside className="bb-sidebar" aria-label="Wijken kiezen">
          <div className="an-panel-title">
            <h2>
              <Layers2 size={16} />
              Wijken <span className="bb-count">{wards.length}</span>
            </h2>
            <button
              className="an-mobile-close"
              aria-label="Sluit wijken"
              onClick={() => setDrawer(null)}
            >
              <X size={16} />
            </button>
          </div>
          <label className="an-search bb-ward-search">
            <Search size={13} />
            <input
              aria-label="Zoek een wijk"
              placeholder="Zoek een wijk…"
              value={wardSearch}
              onChange={(event) => setWardSearch(event.target.value)}
            />
            {wardSearch && (
              <button
                className="an-icon"
                aria-label="Wis wijkzoekopdracht"
                onClick={() => setWardSearch("")}
              >
                <X size={12} />
              </button>
            )}
          </label>
          <div className="bb-ward-list">
            <button
              className={`bb-all${selected === null ? " bb-active" : ""}`}
              aria-pressed={selected === null}
              onClick={() => chooseWard(null)}
            >
              <MapPinned size={17} />
              <span>
                <strong>Heel Amsterdam</strong>
                <small>
                  {number(totals.granted)} verleend · {number(totals.pending)}{" "}
                  in behandeling
                </small>
              </span>
            </button>
            {matchingWards.map((d) => {
              const s = wardStatistics.get(d.properties.code)!,
                count = available(s, mode);
              return (
                <button
                  className={`bb-ward${selected === d.properties.code ? " bb-active" : ""}`}
                  aria-label={`Selecteer ${d.properties.name}`}
                  aria-pressed={selected === d.properties.code}
                  key={d.properties.code}
                  onClick={() => chooseWard(d.properties.code)}
                >
                  <i style={{ background: availabilityColor(count) }} />
                  <span>
                    <strong>{d.properties.name}</strong>
                    <small>
                      {s.granted} verleend · {s.pending} in behandeling
                    </small>
                  </span>
                  <b style={{ color: availabilityColor(count) }}>
                    {count}
                    <small>vrij</small>
                  </b>
                </button>
              );
            })}
            {!matchingWards.length && (
              <p className="bb-caption">
                Geen wijken gevonden. Pas je zoekopdracht aan.
              </p>
            )}
          </div>
          <div className="bb-side-note">
            <Info size={14} />
            <p>
              Een vrije plek staat hier voor <b>één vergunning</b>, niet voor
              één bed. Klik een wijk om alle bijbehorende locaties te tonen.
            </p>
          </div>
          <Link className="bb-back-link" href="/analysis/" prefetch={false}>
            <ArrowLeft size={13} />
            Terug naar vrije analyse
          </Link>
        </aside>
        <section className="bb-map-frame" aria-label="B&B-kaart">
          <div
            ref={container}
            id="bnb-map"
            className="bb-map-canvas"
            role="region"
            aria-label="Kaart met wijkpolygonen en vergunninglocaties"
            tabIndex={-1}
          />
          {!runtime && (
            <div className="bb-map-loading">
              <MapPinned size={29} />
              <strong>
                {failure
                  ? "Kaart niet beschikbaar"
                  : "Wijken worden klaargezet…"}
              </strong>
              {failure && (
                <>
                  <p>{failure}</p>
                  <button
                    className="an-button"
                    onClick={() => {
                      setRuntime(null);
                      setFailure("");
                      setAttempt((v) => v + 1);
                    }}
                  >
                    Opnieuw proberen
                  </button>
                </>
              )}
            </div>
          )}
          <div className="bb-map-top">
            <div className="bb-map-selection">
              <MousePointer2 size={14} />
              <strong>{selected ? name : "Klik een wijk"}</strong>
              {selected && (
                <button
                  aria-label="Terug naar heel Amsterdam"
                  onClick={() => chooseWard(null)}
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="bb-map-actions">
              <label className="bb-hover-mode">
                <select
                  aria-label="Informatie bij aanwijzen"
                  title="Informatie bij aanwijzen"
                  value={hoverMode}
                  onChange={(event) =>
                    setHoverMode(event.target.value as HoverMode)
                  }
                >
                  <option value="follow">Info volgt muis</option>
                  <option value="fixed">Info in het midden</option>
                  <option value="click">Bij klik in het midden</option>
                  <option value="off">Info uit</option>
                </select>
              </label>
              <button
                className="an-button bb-fit"
                aria-label="Zoom naar selectie"
                title="Zoom naar selectie"
                onClick={() => runtime?.fit(model, selected)}
              >
                <Focus size={15} />
              </button>
            </div>
          </div>
          <div className="bb-map-legend">
            <strong>
              {mode === "current"
                ? "Vrije vergunningruimte"
                : "Vrij na alle lopende aanvragen"}
            </strong>
            <div>
              {legend.map((item) => (
                <span key={item.label}>
                  <i style={{ background: item.color }} />
                  {item.label}
                </span>
              ))}
            </div>
            {selected && (
              <p>
                <i style={{ background: statusColor("granted") }} />
                Verleend <i style={{ background: statusColor("pending") }} />
                In behandeling{" "}
                <span>· {locations.length} locaties zichtbaar</span>
              </p>
            )}
          </div>
        </section>
        <aside className="bb-insights" aria-label="Vergunninginzichten">
          <div className="an-panel-title">
            <h2>
              <BarChart3 size={16} />
              {name}
            </h2>
            <button
              className="an-mobile-close"
              aria-label="Sluit inzichten"
              onClick={() => setDrawer(null)}
            >
              <X size={16} />
            </button>
          </div>
          <div className="bb-insight-scroll">
            <div className="bb-availability">
              <span>
                {mode === "current"
                  ? "Vrije vergunningruimte"
                  : "Vrij na alle aanvragen"}
              </span>
              <strong
                data-bnb-stat="free"
                style={{ color: availabilityColor(free) }}
              >
                {number(free)}
              </strong>
              <p>
                {selected
                  ? availabilityLabel(free)
                  : "Som van de vrije ruimte per gebied"}
              </p>
            </div>
            <div className="bb-stat-grid">
              <div>
                <span>
                  <Check size={12} />
                  Verleend
                </span>
                <strong data-bnb-stat="granted">{number(stats.granted)}</strong>
              </div>
              <div>
                <span>
                  <Clock3 size={12} />
                  In behandeling
                </span>
                <strong data-bnb-stat="pending">{number(stats.pending)}</strong>
              </div>
              <div>
                <span>Demoquotum</span>
                <strong>{number(stats.quota)}</strong>
              </div>
              <div>
                <span>Bezetting</span>
                <strong>
                  {number(
                    stats.quota ? (stats.granted / stats.quota) * 100 : 0,
                    1,
                  )}
                  <small>%</small>
                </strong>
              </div>
            </div>
            <div
              className="bb-capacity-rail"
              role="img"
              aria-label={`${stats.granted} van ${stats.quota} vergunningen verleend, ${stats.free} vrij`}
            >
              <i
                style={{
                  width: `${stats.quota ? Math.min(100, (stats.granted / stats.quota) * 100) : 0}%`,
                }}
              />
            </div>
            <p className="bb-caption">
              {number(stats.granted)} van {number(stats.quota)}{" "}
              demo-vergunningen verleend. Aanvragen bezetten nog geen plek.
            </p>
            <section className="bb-scenario">
              <h3>
                <Sparkles size={14} />
                Wat als alle aanvragen doorgaan?
              </h3>
              <div>
                <span>Resterende ruimte</span>
                <strong data-bnb-stat="forecast">
                  {number(stats.afterPending)}
                </strong>
              </div>
              {stats.excess > 0 ? (
                <p className="bb-pressure">
                  <b>
                    {selected
                      ? `${stats.excess} aanvragen meer dan vrije plekken.`
                      : `${stats.excess} aanvragen passen niet in hun eigen gebied.`}
                  </b>{" "}
                  In dit scenario past niet elke aanvraag binnen het quotum van
                  het eigen gebied.
                </p>
              ) : (
                <p>
                  De {stats.pending} lopende aanvragen passen binnen de
                  resterende ruimte van hun eigen gebied.
                </p>
              )}
              <label className="bb-scenario-toggle">
                <input
                  type="checkbox"
                  checked={mode === "after-pending"}
                  onChange={(event) =>
                    setMode(event.target.checked ? "after-pending" : "current")
                  }
                />
                Toon deze situatie op de kaart
              </label>
            </section>
            <section className="bb-queue">
              <h3>Ook interessant</h3>
              <dl>
                <div>
                  <dt>
                    <Clock3 size={13} />
                    Gemiddeld in behandeling
                  </dt>
                  <dd>
                    {number(stats.averagePendingDays)}
                    {stats.averagePendingDays !== null && " dagen"}
                  </dd>
                </div>
                <div>
                  <dt>Mediaan in behandeling</dt>
                  <dd data-bnb-stat="median-pending">
                    {number(stats.medianPendingDays, 1)}
                    {stats.medianPendingDays !== null && " dagen"}
                  </dd>
                </div>
                <div>
                  <dt>Langst lopende aanvraag</dt>
                  <dd>
                    {number(stats.oldestPendingDays)}
                    {stats.oldestPendingDays !== null && " dagen"}
                  </dd>
                </div>
                <div>
                  <dt>Aanvragen ouder dan {queueThreshold} dagen</dt>
                  <dd data-bnb-stat="old-pending">
                    {stats.oldPending}
                    {stats.pending > 0 && (
                      <small>
                        {" "}
                        · {number((stats.oldPending / stats.pending) * 100, 1)}%
                      </small>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>
                    <BedDouble size={13} />
                    Gastplaatsen bij verleende B&B’s
                  </dt>
                  <dd>{number(stats.guests)}</dd>
                </div>
              </dl>
              <p className="bb-caption">
                {queueThreshold} dagen is een demodrempel voor signalering, geen
                wettelijke beslistermijn. De mediaan beschrijft de lopende
                wachtrij; dit is geen gemiddelde afhandeltijd. Gastplaatsen zijn
                geen vergunningruimte.
              </p>
            </section>
            {focusedPermit && (
              <PermitDetails
                permit={focusedPermit}
                clear={() => setFocused(null)}
              />
            )}
            <section className="bb-comparison">
              <h3>Waar zit de meeste ruimte?</h3>
              <label className="an-field">
                Vergelijk op
                <select
                  aria-label="Vergelijk vergunningruimte"
                  value={rankMode}
                  onChange={(e) =>
                    setRankMode(e.target.value as "count" | "share")
                  }
                >
                  <option value="count">Aantal vrije vergunningen</option>
                  <option value="share">Aandeel van het wijkquotum</option>
                </select>
              </label>
              {ranking.map((item) => (
                <button
                  key={item.ward.properties.code}
                  aria-label={`Vergelijk ${item.ward.properties.name}`}
                  onClick={() => chooseWard(item.ward.properties.code)}
                >
                  <span>
                    {item.ward.properties.name}
                    <b>
                      {rankMode === "share"
                        ? `${number(item.value, 1)}%`
                        : item.count}
                    </b>
                  </span>
                  <i>
                    <em
                      style={{
                        width: `${(item.value / Math.max(1, ...ranking.map((item) => item.value))) * 100}%`,
                        background: availabilityColor(item.count),
                      }}
                    />
                  </i>
                </button>
              ))}
              <p className="bb-caption">
                De 10 wijken met{" "}
                {rankMode === "share"
                  ? "het hoogste vrije aandeel van hun eigen quotum"
                  : "de meeste vrije vergunningen"}
                .{" "}
                {mode === "after-pending"
                  ? "Na lopende aanvragen."
                  : "Huidige stand."}{" "}
                Zoek links in alle {wards.length} wijken.
              </p>
            </section>
            {!selected && (
              <p className="bb-caption">
                Kies een wijk voor de bijbehorende locaties en detailcijfers. De
                cijfers hierboven zijn voor heel Amsterdam.
              </p>
            )}
          </div>
        </aside>
        <LocationsTable
          selected={selected}
          name={name}
          locations={locations}
          status={status}
          setStatus={setStatus}
          query={query}
          setQuery={setQuery}
          focused={focusedPermit?.id ?? null}
          focus={setFocused}
          total={stats.granted + stats.pending}
        />
        <footer className="an-status bb-status">
          <span>
            <span className="an-live-dot" />
            Voorbeelddata · geen actuele vergunningstand
          </span>
          <span>Gemeentelijke grenzen · scenario 3 november 2026</span>
          <span>
            {selected
              ? `${name} · ${locations.length} locaties`
              : `${wards.length} gebieden`}
          </span>
        </footer>
      </div>
      {notice && (
        <div className="an-notice" role="status">
          <span>{notice}</span>
          <button aria-label="Sluit melding" onClick={() => setNotice("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {help && <BnbHelp close={() => setHelp(false)} />}
    </main>
  );
}

function PermitDetails({
  permit,
  clear,
}: {
  permit: Permit;
  clear: () => void;
}) {
  return (
    <section className="bb-permit-detail">
      <div>
        <h3>Geselecteerde locatie</h3>
        <button
          className="an-icon"
          aria-label="Deselecteer locatie"
          onClick={clear}
        >
          <X size={14} />
        </button>
      </div>
      <strong>{permit.id}</strong>
      <p>{permit.label}</p>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{statusLabel(permit.status)}</dd>
        </div>
        <div>
          <dt>Gastplaatsen</dt>
          <dd>{permit.guests}</dd>
        </div>
        {permit.pendingDays !== null && (
          <div>
            <dt>In behandeling</dt>
            <dd>{permit.pendingDays} dagen</dd>
          </div>
        )}
      </dl>
      <small>Fictieve locatie, geen geregistreerd B&B-adres.</small>
    </section>
  );
}

function LocationsTable({
  selected,
  name,
  locations,
  status,
  setStatus,
  query,
  setQuery,
  focused,
  focus,
  total,
}: {
  selected: string | null;
  name: string;
  locations: Permit[];
  status: "all" | PermitStatus;
  setStatus: (status: "all" | PermitStatus) => void;
  query: string;
  setQuery: (query: string) => void;
  focused: string | null;
  focus: (id: string) => void;
  total: number;
}) {
  const filterKey = `${selected}:${status}:${query}`;
  const [paging, setPaging] = useState({ key: filterKey, page: 0, focused });
  const page =
    paging.key === filterKey
      ? Math.min(paging.page, Math.max(0, Math.ceil(locations.length / 50) - 1))
      : 0;
  if (paging.focused !== focused) {
    const index = locations.findIndex((p) => p.id === focused);
    setPaging({
      key: filterKey,
      page: index < 0 ? page : Math.floor(index / 50),
      focused,
    });
  }
  return (
    <section className="bb-table" aria-label="Vergunninglocaties">
      <div className="bb-table-heading">
        <h2>
          <MapPin size={15} />
          {selected ? `Locaties · ${name}` : "Vergunninglocaties"}
          <span className="bb-count">{locations.length}</span>
        </h2>
        <div>
          <label>
            <span className="sr-only">Status vergunning</span>
            <select
              aria-label="Status vergunning"
              disabled={!selected}
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as "all" | PermitStatus)
              }
            >
              <option value="all">Alle locaties</option>
              <option value="granted">Verleend</option>
              <option value="pending">In behandeling</option>
            </select>
          </label>
          <label className="an-search">
            <Search size={13} />
            <input
              aria-label="Zoek vergunninglocaties"
              placeholder="Zoek demo-ID…"
              value={query}
              disabled={!selected}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
      </div>
      <div className="an-table-scroll">
        {!selected ? (
          <div className="bb-table-empty">
            <MapPinned size={23} />
            <strong>Van wijk naar alle locaties</strong>
            <span>Klik op een gekleurd vlak of kies links een wijk.</span>
          </div>
        ) : !locations.length ? (
          <div className="bb-table-empty">
            <Search size={22} />
            <strong>Geen locaties bij deze filters</strong>
            <button
              className="an-text-button"
              onClick={() => {
                setStatus("all");
                setQuery("");
              }}
            >
              Wis de locatiefilters
            </button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Voorbeeldlocatie</th>
                <th scope="col">Status</th>
                <th scope="col">Gastplaatsen</th>
                <th scope="col">In behandeling</th>
              </tr>
            </thead>
            <tbody>
              {locations.slice(page * 50, (page + 1) * 50).map((p) => (
                <tr
                  key={p.id}
                  data-focused={focused === p.id ? "true" : undefined}
                >
                  <td>
                    <button
                      aria-label={`Toon ${p.id} op kaart`}
                      onClick={() => focus(p.id)}
                    >
                      {p.id}
                      <ArrowUpRight size={12} />
                    </button>
                  </td>
                  <td>
                    <span className={`bb-permit-status bb-${p.status}`}>
                      <i style={{ background: statusColor(p.status) }} />
                      {statusLabel(p.status)}
                    </span>
                  </td>
                  <td>{p.guests}</td>
                  <td>
                    {p.pendingDays === null ? (
                      "—"
                    ) : (
                      <span
                        className={
                          p.pendingDays > queueThreshold ? "bb-aged" : ""
                        }
                      >
                        {p.pendingDays} dagen
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="an-table-footer">
        <span>
          {selected
            ? `${locations.length ? `${page * 50 + 1}–${Math.min((page + 1) * 50, locations.length)}` : "0"} van ${locations.length} zichtbaar · ${total} totaal in gebied`
            : "Locaties verschijnen na je gebiedskeuze"}
        </span>
        <div>
          <button
            aria-label="Vorige locaties"
            disabled={page === 0}
            onClick={() =>
              setPaging({ key: filterKey, page: page - 1, focused })
            }
          >
            <ChevronLeft size={14} />
          </button>
          <button
            aria-label="Volgende locaties"
            disabled={(page + 1) * 50 >= locations.length}
            onClick={() =>
              setPaging({ key: filterKey, page: page + 1, focused })
            }
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}

function BnbHelp({ close }: { close: () => void }) {
  return (
    <Modal
      title="Zo werkt het B&B-voorbeeld"
      close={close}
      className="bb-help-dialog"
    >
      <div className="bb-help-body">
        <span className="an-intro-label">WIJK → LOCATIES → INZICHT</span>
        <h3>Waar is nog vergunningruimte?</h3>
        <ol>
          <li>
            <b>Klik een wijk.</b> De kaart toont alle bijbehorende verleende
            vergunningen en aanvragen met markers, en behoudt je kaartpositie.
            De lijst volgt mee. Gebruik de zoomknop als je het gebied wilt
            uitvergroten.
          </li>
          <li>
            <b>Bekijk eigenschappen bij de muis.</b> Kies boven de kaart “Info
            volgt muis”, “Info in het midden”, “Bij klik in het midden” of “Info
            uit”. De informatie volgt je muis of staat vast in het midden van de
            kaart. Klik om eigenschappen in het midden vast te zetten; sluit met
            het kruisje of Escape. Bij de klikstand verschijnt vooraf geen
            hoverkaart. Op een aanraakscherm gebruik je de gebiedskeuze en
            locatieklikken.
          </li>
          <li>
            <b>Lees de kleuren.</b> Rood: geen plek; oranje: 1–9; geel: 10–24;
            groen: 25 of meer. Een plek is één vergunning, niet één bed.
          </li>
          <li>
            <b>Onderzoek de aanvragen.</b> Filter op status, klik een locatie
            voor details of bekijk de behandelduur en gastplaatsen.
          </li>
          <li>
            <b>Vergelijk een scenario.</b> Zet “Toon deze situatie op de kaart”
            aan om de vrije ruimte te zien als alle lopende aanvragen binnen hun
            eigen gebied worden verleend.
          </li>
        </ol>
        <h4>Hoe rekenen we?</h4>
        <p>
          Huidig vrij = demoquotum − verleende vergunningen. Lopende aanvragen
          zijn nog niet toegekend. Vrij na aanvragen = huidig vrij minus lopende
          aanvragen, met een minimum van nul. Ruimte wordt per gebied berekend
          en daarna opgeteld.
        </p>
        <h4>Wat is echt, wat is voorbeelddata?</h4>
        <p>
          De 110 wijkpolygonen komen uit{" "}
          <a href={boundarySource} target="_blank" rel="noreferrer">
            de gemeentelijke B&B-kaart
          </a>
          , opgehaald op 3 november 2026. Het zijn precies de kleinere
          vergunningsgebieden op die kaart, met coördinaten afgerond op zes
          decimalen.
        </p>
        <p>
          Alle quota, vergunningen, locaties en behandelinformatie zijn{" "}
          <b>fictief</b>. De{" "}
          <a href={permitSource} target="_blank" rel="noreferrer">
            gemeentelijke B&B-dataset
          </a>{" "}
          geeft een beschikbaarheidsindicatie per <b>wijk</b>, geen volledig
          adressenbestand of aantallen lopende aanvragen. Alleen de
          gebiedsindeling is overgenomen. Kaartkleuren en exacte aantallen in
          dit voorbeeld worden berekend uit demodata en zijn geen actuele
          gemeentelijke beschikbaarheidsmelding.
        </p>
        <p>
          De signalering na {queueThreshold} dagen is een demodrempel. De
          fictieve markers zijn niet gekoppeld aan echte adressen. Ook exports
          zijn als fictieve data gemarkeerd.
        </p>
      </div>
      <div className="an-intro-actions">
        <button className="an-button an-primary" onClick={close}>
          Begrepen <Check size={14} />
        </button>
      </div>
    </Modal>
  );
}
