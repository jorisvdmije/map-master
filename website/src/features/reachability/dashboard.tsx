"use client";
import Image from "next/image";
import { ReachabilityResult } from "./result";
import Link from "next/link";
import {
  ShareView,
  flag,
  bounded,
  oneOf,
} from "@/components/workspaces/view-state";
import { WorkspaceNavigation } from "@/components/workspaces/navigation";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bike,
  Car,
  Footprints,
  Zap,
  Focus,
  MapPin,
  Ruler,
  Upload,
  X,
} from "lucide-react";
import {
  calculateReachability,
  createValhallaProvider,
  ReachabilityError,
  type Coordinate,
  type ReachabilityRequest,
  type TravelProfile,
} from "@jorisvdmije/map-master";
import {
  parseGeoJSON,
  spatialRows,
  type AnalysisArea,
  type Dataset,
} from "@/features/analysis/model";
import { assetPath } from "@/lib/paths";
import type { MeasureState, ReachabilityRuntime } from "./runtime";
import {
  coordinateInput,
  coordinateOrigin,
  coordinateValue,
  initialOrigin,
  type CoordinateInput,
} from "./coordinates";
import "@/features/analysis/analysis.css";
import "@/features/housing/housing.css";
import "./reachability.css";

const profiles: { id: TravelProfile; name: string; icon: typeof Bike }[] = [
  { id: "walking", name: "Lopen", icon: Footprints },
  { id: "cycling", name: "Fiets", icon: Bike },
  { id: "e-bike", name: "E-bike", icon: Zap },
  { id: "driving", name: "Auto", icon: Car },
];
const provider = createValhallaProvider({
  endpoint:
    process.env.NEXT_PUBLIC_VALHALLA_ENDPOINT ||
    "https://valhalla1.openstreetmap.de/isochrone",
  clientId: "map-master-geometry-editor",
});
const number = (n: number, digits = 0) =>
  n.toLocaleString("nl-NL", { maximumFractionDigits: digits });
function routingError(error: Error) {
  if (error instanceof ReachabilityError) {
    if (error.code === "invalid-request")
      return "Controleer het vertrekpunt en kies één tot vier reistijden van maximaal 60 minuten.";
    if (error.code === "invalid-response")
      return "De routedienst leverde geen volledige, geldige contouren. Probeer het later opnieuw.";
    return `De routedienst is tijdelijk niet beschikbaar${error.message.match(/HTTP \d+/)?.[0] ? ` (${error.message.match(/HTTP \d+/)![0]})` : ""}. Probeer het later opnieuw.`;
  }
  return "De routedienst reageert niet op tijd of is niet bereikbaar. Probeer het later opnieuw.";
}
export function ReachabilityDashboard() {
  const params = useSearchParams(),
    client = useQueryClient(),
    host = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null);
  const [location, setLocation] = useState(() => {
    const point = initialOrigin(params);
    return { point, input: coordinateInput(point) };
  });
  const origin = location.point,
    validOrigin = coordinateOrigin(location.input);
  const lngInvalid = coordinateValue(location.input.lng, 180) === null,
    latInvalid = coordinateValue(location.input.lat, 85) === null;
  const editCoordinate = (axis: keyof CoordinateInput, value: string) =>
    setLocation((previous) => {
      const input = { ...previous.input, [axis]: value };
      return { input, point: coordinateOrigin(input) ?? previous.point };
    });
  const [runtime, setRuntime] = useState<ReachabilityRuntime | null>(null),
    [mapError, setMapError] = useState("");
  const [profile, setProfile] = useState<TravelProfile>("cycling"),
    [minutes, setMinutes] = useState(15),
    [intervals, setIntervals] = useState(true),
    [direction, setDirection] = useState<"from" | "to">("from");
  const [submitted, setSubmitted] = useState<ReachabilityRequest | null>(null),
    [picking, setPicking] = useState(false),
    [dataset, setDataset] = useState<Dataset | null>(null),
    [fileError, setFileError] = useState("");
  const [measurement, setMeasurement] = useState<MeasureState>({
    drawing: false,
    canFinish: false,
    count: 0,
  });
  const choose = useRef((point: Coordinate) => {
    const input = coordinateInput(point);
    setLocation((previous) => ({
      input,
      point: coordinateOrigin(input) ?? previous.point,
    }));
    setPicking(false);
  });
  const query = useQuery({
    queryKey: ["reachability", submitted],
    enabled: !!submitted,
    queryFn: ({ signal }) =>
      calculateReachability(provider, submitted!, { signal }),
    staleTime: 5 * 60_000,
    retry: false,
  });
  useEffect(() => {
    const lifetime = new AbortController();
    void import("./runtime")
      .then(({ mountReachability }) =>
        mountReachability(
          host.current!,
          lifetime.signal,
          client,
          origin,
          (p) => choose.current(p),
          setMeasurement,
        ),
      )
      .then((value) => {
        if (value && !lifetime.signal.aborted) setRuntime(value);
      })
      .catch((error) => {
        if (!lifetime.signal.aborted) {
          setMapError(
            error instanceof Error ? error.message : "Kaart niet beschikbaar.",
          );
          lifetime.abort();
        }
      });
    return () => lifetime.abort();
    // The initial camera is fixed at mount; coordinate changes move only the origin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);
  useEffect(() => {
    runtime?.setOrigin(origin);
  }, [runtime, origin]);
  useEffect(() => {
    runtime?.render(query.data, intervals, dataset?.data);
  }, [runtime, query.data, intervals, dataset]);
  const rows = useMemo(
    () =>
      query.data?.contours.features.map((f) => ({
        minutes: Number(f.properties!.minutes),
        area: Number(f.properties!.areaSquareMetres) / 1_000_000,
        count: dataset ? spatialRows(dataset, f as AnalysisArea).length : null,
      })) ?? [],
    [query.data, dataset],
  );
  const changed =
    !!submitted &&
    (!validOrigin ||
      submitted.origin[0] !== origin[0] ||
      submitted.origin[1] !== origin[1] ||
      submitted.profile !== profile ||
      submitted.direction !== direction ||
      Math.max(...submitted.minutes) !== minutes ||
      submitted.minutes.length !==
        (intervals
          ? [5, 10, 15, 30, 45, 60].filter((t) => t <= minutes).slice(-4).length
          : 1));
  const submit = () => {
    if (!validOrigin) return;
    const next: ReachabilityRequest = {
      origin: [...validOrigin],
      profile,
      direction,
      minutes: intervals
        ? [5, 10, 15, 30, 45, 60].filter((t) => t <= minutes).slice(-4)
        : [minutes],
    };
    if (JSON.stringify(next) === JSON.stringify(submitted))
      void query.refetch();
    else setSubmitted(next);
  };
  const read = async (value?: File) => {
    if (!value) return;
    try {
      if (value.size > 10 * 1024 * 1024)
        throw new Error("Gebruik een GeoJSON-bestand van maximaal 10 MB.");
      const data = parseGeoJSON(JSON.parse(await value.text()), value.name);
      setDataset(data);
      setFileError("");
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : "Bestand niet leesbaar.",
      );
    }
  };
  return (
    <main
      lang="nl"
      className="hs-root ra-root"
      data-reachability
      data-ready={runtime ? "true" : undefined}
    >
      <header className="an-header">
        <Link className="an-brand" href="/" prefetch={false}>
          <Image src={assetPath("/logo.svg")} width={31} height={31} alt="" />
          <span>
            Map Master<small>AFSTAND IS NIET ALTIJD BEREIK</small>
          </span>
        </Link>
        <WorkspaceNavigation current="/analysis/reachability/" />
        <Link
          className="an-button"
          href="/guides/reachability/"
          prefetch={false}
        >
          Bronnen & methode
        </Link>
      </header>
      <ShareView
        app="reachability"
        data={{ origin, profile, minutes, intervals, direction }}
        defaults={{
          origin,
          profile: "cycling",
          minutes: 15,
          intervals: true,
          direction: "from",
        }}
        rules={{
          origin: (value) =>
            Array.isArray(value) &&
            value.length === 2 &&
            bounded(-180, 180)(value[0]) &&
            bounded(-85, 85)(value[1]),
          profile: oneOf(profiles.map((p) => p.id)),
          minutes: oneOf([5, 10, 15, 30, 45, 60]),
          intervals: flag,
          direction: oneOf(["from", "to"]),
        }}
        apply={(v) => {
          const point = v.origin as Coordinate;
          setLocation({ point, input: coordinateInput(point) });
          setProfile(v.profile as TravelProfile);
          setMinutes(v.minutes as number);
          setIntervals(v.intervals as boolean);
          setDirection(v.direction as "from" | "to");
        }}
      />
      <section className="hs-intro">
        <div>
          <span className="hs-eyebrow">VAN VERTREKPUNT NAAR REISGEBIED</span>
          <h1>Wat ligt er binnen jouw bereik?</h1>
          <p>
            Reistijdcontouren volgen het wegennet. Meet daarnaast een lijn, of
            tel je eigen locaties binnen het bereik.
          </p>
        </div>
      </section>
      <nav className="ra-mobile-nav" aria-label="Onderdelen bereikbaarheid">
        <a href="#reach-settings">Instellingen</a>
        <a href="#reach-map">Kaart bekijken</a>
      </nav>
      <div className="ra-workspace">
        <aside className="ra-panel" id="reach-settings">
          <h2>Bereik instellen</h2>
          <div className="ra-profiles" role="group" aria-label="Vervoermiddel">
            {profiles.map((p) => (
              <button
                key={p.id}
                aria-pressed={profile === p.id}
                onClick={() => setProfile(p.id)}
              >
                <p.icon size={21} />
                <span>{p.name}</span>
              </button>
            ))}
          </div>
          <div className="ra-coordinates">
            <label>
              Lengtegraad
              <input
                aria-label="Lengtegraad vertrekpunt"
                type="text"
                inputMode="decimal"
                value={location.input.lng}
                aria-invalid={lngInvalid || undefined}
                aria-describedby={`ra-coordinate-help${lngInvalid ? " ra-lng-error" : ""}`}
                onChange={(e) => editCoordinate("lng", e.target.value)}
              />
              {lngInvalid && (
                <small
                  id="ra-lng-error"
                  className="ra-coordinate-error"
                  role="alert"
                >
                  Vul een lengtegraad tussen −180 en 180 in.
                </small>
              )}
            </label>
            <label>
              Breedtegraad
              <input
                aria-label="Breedtegraad vertrekpunt"
                type="text"
                inputMode="decimal"
                value={location.input.lat}
                aria-invalid={latInvalid || undefined}
                aria-describedby={`ra-coordinate-help${latInvalid ? " ra-lat-error" : ""}`}
                onChange={(e) => editCoordinate("lat", e.target.value)}
              />
              {latInvalid && (
                <small
                  id="ra-lat-error"
                  className="ra-coordinate-error"
                  role="alert"
                >
                  Vul een breedtegraad tussen −85 en 85 in.
                </small>
              )}
            </label>
          </div>
          <p className="hs-note" id="ra-coordinate-help">
            Decimale graden, met punt of komma. De kaart houdt het laatste
            geldige punt vast totdat beide waarden kloppen.
          </p>
          <button
            className="an-button"
            aria-pressed={picking}
            disabled={!runtime}
            onClick={() => {
              runtime!.pickOrigin(!picking);
              setPicking(!picking);
            }}
          >
            <MapPin size={14} />
            {picking
              ? "Klik een plek op de kaart"
              : "Kies vertrekpunt op kaart"}
          </button>
          <div className="ra-config">
            <label>
              Reistijd
              <select
                aria-label="Reistijd"
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              >
                {[5, 10, 15, 30, 45, 60].map((t) => (
                  <option key={t} value={t}>
                    {t} minuten
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reisrichting
              <select
                aria-label="Reisrichting"
                value={direction}
                onChange={(e) => setDirection(e.target.value as "from" | "to")}
              >
                <option value="from">Vanaf vertrekpunt</option>
                <option value="to">Naar bestemming</option>
              </select>
            </label>
          </div>
          <label className="ra-check">
            <input
              type="checkbox"
              checked={intervals}
              onChange={(e) => setIntervals(e.target.checked)}
            />
            Toon reistijdintervallen
          </label>
          <button
            className="an-button an-primary ra-calculate"
            disabled={query.isFetching || !runtime || !validOrigin}
            onClick={submit}
          >
            {query.isFetching
              ? "Reistijden berekenen…"
              : "Bereken bereikbaarheid"}
          </button>
          {query.isFetching && (
            <button
              className="an-button"
              onClick={() => {
                void client.cancelQueries({
                  queryKey: ["reachability", submitted],
                });
                setSubmitted(null);
              }}
            >
              Berekening annuleren
            </button>
          )}
          {changed && (
            <p className="hs-note" role="status">
              Instellingen gewijzigd. Bereken opnieuw om ze toe te passen. De
              getoonde contouren horen bij de vorige berekening.
            </p>
          )}
          {query.error && (
            <p className="ra-error" role="alert">
              {routingError(query.error)}
              {query.data &&
                " Het vorige geslaagde resultaat blijft zichtbaar."}
            </p>
          )}
          {mapError && (
            <p className="ra-error" role="alert">
              {mapError}
            </p>
          )}
          {query.data && (
            <ReachabilityResult
              result={query.data}
              rows={rows}
              profileName={
                profiles.find((p) => p.id === query.data!.request.profile)
                  ?.name ?? ""
              }
            />
          )}
          {submitted && (
            <button
              className="an-button"
              onClick={() => {
                void client.cancelQueries({
                  queryKey: ["reachability", submitted],
                });
                setSubmitted(null);
              }}
            >
              Contouren wissen
            </button>
          )}
          <p className="hs-note">
            Reistijden zijn modelschattingen op het wegennet. Actuele
            verkeersdrukte, wachttijden en toegankelijkheid kunnen afwijken.
            E-bike: modelsnelheid 25 km/u.
          </p>
        </aside>
        <section className="ra-map-panel" id="reach-map">
          <div className="ra-map-tools">
            <button
              className="an-button"
              disabled={!runtime || measurement.drawing}
              onClick={() => {
                setPicking(false);
                runtime?.measure();
              }}
            >
              <Ruler size={15} />
              Meetlijn tekenen
            </button>
            {measurement.drawing && (
              <>
                <button
                  className="an-button"
                  disabled={!measurement.canFinish}
                  onClick={() => runtime?.editor.finish()}
                >
                  Meting afronden
                </button>
                <button
                  className="an-button"
                  onClick={() => runtime?.editor.cancel()}
                >
                  Annuleren
                </button>
              </>
            )}
            {measurement.count > 0 && (
              <button
                className="an-button"
                onClick={() => runtime?.clearMeasurement()}
              >
                Metingen wissen
              </button>
            )}
            <button
              className="an-button"
              disabled={!query.data}
              onClick={() => runtime?.fit()}
            >
              <Focus size={15} />
              Zoom naar contour
            </button>
          </div>
          <div
            ref={host}
            className="ra-map"
            role="region"
            aria-label="Bereikbaarheidskaart"
          />
          <div className="ra-map-caption">
            {measurement.drawing
              ? "Klik punten en rond af met Enter. Escape annuleert. De afstand volgt de getekende lijn, niet een berekende route."
              : picking
                ? "Klik om het vertrekpunt te kiezen."
                : "Contouren zijn doorschijnend. Selecteren of berekenen verandert de camera niet."}
          </div>
          <div className="ra-data">
            <div>
              <h3>Welke locaties vallen binnen bereik?</h3>
              <p>
                Laad je eigen voorzieningen, woningen of andere
                GeoJSON-objecten. Gebruik de contouren ook als
                onderzoeksgebieden in de vrije analyse.
              </p>
            </div>
            <button className="an-button" onClick={() => file.current?.click()}>
              <Upload size={14} />
              GeoJSON laden
            </button>
            {dataset && (
              <span>
                {dataset.name} · {number(dataset.data.features.length)} objecten{" "}
                <button
                  className="an-icon"
                  aria-label="Onderzoeksdata verwijderen"
                  onClick={() => setDataset(null)}
                >
                  <X size={13} />
                </button>
              </span>
            )}
            {fileError && (
              <p className="ra-error" role="alert">
                {fileError}
              </p>
            )}
            <input
              ref={file}
              type="file"
              className="sr-only"
              aria-label="Onderzoeksdata bereikbaarheid"
              accept=".geojson,.json"
              onChange={(e) => {
                void read(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        </section>
      </div>
      <footer className="hs-footer">
        <span>
          {query.data?.attribution ??
            "Routeberekening: Valhalla · Kaartgegevens © OpenStreetMap contributors"}
        </span>
        <Link href="/guides/reachability/" prefetch={false}>
          Hoe werken bereikbaarheidscontouren?
        </Link>
      </footer>
    </main>
  );
}
