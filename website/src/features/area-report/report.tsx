"use client";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpRight,
  FileText,
  MapPin,
  Printer,
  Search,
  Share2,
  Trees,
  Volume2,
  Bike,
} from "lucide-react";
import { area as turfArea } from "@turf/area";
import {
  calculateReachability,
  createValhallaProvider,
} from "@jorisvdmije/map-master";
import { WorkspaceNavigation } from "@/components/workspaces/navigation";
import { SourceAge } from "@/components/workspaces/source-age";
import { assetPath } from "@/lib/paths";
import { download } from "@/lib/download";
import { homeNoise, nearbyTrees } from "../housing/environment";
import { number, type Snapshot } from "../housing/model";
import { searchAddresses, type Address } from "./address";
import {
  addressSource,
  amenityMetrics,
  areaShape,
  areasAt,
  liveResult,
  pointHome,
  pointKey,
  reportCsv,
  reportExport,
  reportGroups,
  reportHref,
  reportMetrics,
  selectedPoint,
} from "./model";
import "../catalog/catalog.css";
import "./report.css";

const date = (s: string) =>
  new Date(s).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" });
const routing = createValhallaProvider({
  endpoint:
    process.env.NEXT_PUBLIC_VALHALLA_ENDPOINT ||
    "https://valhalla1.openstreetmap.de/isochrone",
  clientId: "map-master-area-report",
});

export function AreaReport() {
  const params = useSearchParams(),
    router = useRouter();
  const [filter, setFilter] = useState(""),
    [input, setInput] = useState(""),
    [submitted, setSubmitted] = useState("");
  const [chosenAddress, setChosenAddress] = useState<Address | null>(null);
  const [boundary, setBoundary] = useState<{
    address: Address;
    codes: string[];
  } | null>(null);
  const [notice, setNotice] = useState(""),
    [addressNotice, setAddressNotice] = useState("");
  const [requested, setRequested] = useState("");
  const snapshot = useQuery({
    queryKey: ["housing-snapshot"],
    queryFn: async ({ signal }): Promise<Snapshot> => {
      const response = await fetch(assetPath("/data/amsterdam-housing.json"), {
        signal,
      });
      if (!response.ok)
        throw new Error("Buurtgegevens konden niet worden geladen.");
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
    () =>
      [...(snapshot.data?.data.features ?? [])].sort((a, b) =>
        a.properties.name.localeCompare(b.properties.name, "nl"),
      ),
    [snapshot.data],
  );
  const code = params.get("buurt") ?? "",
    area = all.find((row) => row.properties.code === code);
  const point = useMemo(() => {
    if (!area) return null;
    const base = selectedPoint(area, new URLSearchParams(params.toString()));
    return base.kind === "shared" &&
      chosenAddress &&
      pointKey(base) === pointKey(chosenAddress)
      ? chosenAddress
      : base;
  }, [area, params, chosenAddress]);
  const locationKey = point ? pointKey(point) : "",
    enabled = !!point && requested === locationKey;
  const home = point ? pointHome(point) : null;
  const trees = useQuery({
    queryKey: ["report-trees", locationKey, 250],
    queryFn: ({ signal }) => nearbyTrees(home!, 250, signal),
    enabled,
    staleTime: 15 * 60_000,
    retry: false,
  });
  const noise = useQuery({
    queryKey: ["report-noise", locationKey],
    queryFn: ({ signal }) => homeNoise(home!, signal),
    enabled,
    staleTime: 24 * 60 * 60_000,
    retry: false,
  });
  const reach = useQuery({
    queryKey: ["report-reach", locationKey],
    queryFn: ({ signal }) =>
      calculateReachability(
        routing,
        {
          origin: point!.coordinates,
          profile: "cycling",
          minutes: [15],
          direction: "from",
        },
        { signal },
      ),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const addresses = useQuery({
    queryKey: ["report-addresses", submitted],
    queryFn: ({ signal }) => searchAddresses(submitted, signal),
    enabled: submitted.length >= 3,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const hasSearch = submitted && input.trim() === submitted;
  const rows =
      area && snapshot.data ? reportMetrics(area, snapshot.data.meta) : [],
    busy = trees.isFetching || noise.isFetching || reach.isFetching;
  const choose = (next: string, address?: Address) => {
    setChosenAddress(address ?? null);
    setBoundary(null);
    setNotice("");
    setAddressNotice("");
    setRequested("");
    router.push(reportHref(next, address?.coordinates), { scroll: false });
  };
  const pickAddress = (address: Address) => {
    const matches = areasAt(all, address.coordinates);
    if (!matches.length) {
      setBoundary(null);
      setAddressNotice(
        "Dit adres valt niet binnen de vastgelegde CBS-buurtgrenzen van 2025. Kies een buurt om verder te gaan.",
      );
      return;
    }
    if (matches.length > 1) {
      setBoundary({
        address,
        codes: matches.map((row) => row.properties.code),
      });
      setAddressNotice(
        "Het adres ligt op een buurtgrens. Kies hieronder welke buurt je wilt rapporteren.",
      );
      return;
    }
    choose(matches[0].properties.code, address);
  };
  const loadEnvironment = () => {
    if (requested !== locationKey) setRequested(locationKey);
    else {
      void trees.refetch();
      void noise.refetch();
      void reach.refetch();
    }
  };
  const environment = {
    trees: {
      ...liveResult(trees),
      source: "https://api.data.amsterdam.nl/v1/docs/datasets/bomen.html",
      sourcePeriod:
        "Registratie bij opvraag; afzonderlijk inventarisatiejaar niet beschikbaar",
      radiusMetres: 250,
    },
    noise: {
      ...liveResult(noise),
      source: "https://data.rivm.nl/geo/alo/wms",
      sourcePeriod: "Kaart 2022; samengestelde bronjaren 2022–2025",
    },
    reachability: {
      ...liveResult(reach),
      source:
        process.env.NEXT_PUBLIC_VALHALLA_ENDPOINT ||
        "https://valhalla1.openstreetmap.de/isochrone",
      sourcePeriod:
        "Modelberekening bij opvraag; geen vastgesteld OSM-bronjaar",
    },
  };
  const exportReport = () => {
    if (area && point && snapshot.data)
      download(
        JSON.stringify(
          reportExport(area, snapshot.data.meta, point, environment),
          null,
          2,
        ),
        `gebiedsrapport-${area.properties.code}.json`,
      );
  };
  const share = async () => {
    if (!area || !point) return;
    const url = new URL(window.location.href);
    url.search = new URL(
      reportHref(area.properties.code, point.coordinates),
      url,
    ).search;
    setNotice(url.href);
    try {
      await navigator.clipboard.writeText(url.href);
      setNotice(
        `Link gekopieerd. De link deelt de buurt en het locatiepunt: ${url.href}`,
      );
    } catch {
      /* The visible, selectable URL remains usable without clipboard access. */
    }
  };
  const shape = area && point ? areaShape(area, point) : null;
  const maxDistance = Math.max(
    1,
    ...rows
      .filter((m) => amenityMetrics.includes(m.key))
      .map((m) => m.value ?? 0),
  );
  return (
    <main
      className="db-root gr-root"
      lang="nl"
      data-area-report
      data-ready={snapshot.data ? "true" : undefined}
    >
      <a className="skip-link" href="#gr-report">
        Naar het rapport
      </a>
      <header className="db-header">
        <Link className="db-brand" href="/" prefetch={false}>
          <Image src={assetPath("/logo.svg")} alt="" width={34} height={34} />
          <span>
            Map Master<small>VAN BRON NAAR BUURT</small>
          </span>
        </Link>
        <nav aria-label="Rapportnavigatie">
          <Link href="/data/" prefetch={false}>
            Databank
          </Link>
          <Link href="/guides/open-data-amsterdam/" prefetch={false}>
            Bronnen & methode
          </Link>
        </nav>
        <WorkspaceNavigation current="/area-report/" />
      </header>
      <section className="gr-intro">
        <span className="db-eyebrow">
          <FileText size={15} /> GEBIEDSRAPPORT · AMSTERDAM
        </span>
        <h1>Het verhaal van jouw buurt.</h1>
        <p>
          Wonen, groen, geluid en voorzieningen bij elkaar. Kies een buurt of
          zoek een adres en ontdek wat de bronnen over die plek vertellen.
        </p>
      </section>
      <div className="gr-layout">
        <aside className="gr-picker" aria-label="Gebied kiezen">
          <span className="db-eyebrow">01 / KIES JE GEBIED</span>
          <h2>Welke plek onderzoek je?</h2>
          <label htmlFor="gr-filter">Zoek buurt</label>
          <input
            id="gr-filter"
            type="search"
            value={filter}
            maxLength={200}
            placeholder="Bijvoorbeeld Concertgebouwbuurt"
            onChange={(e) => setFilter(e.target.value)}
          />
          <label htmlFor="gr-area">Buurt</label>
          <select
            id="gr-area"
            value={area ? code : ""}
            disabled={!snapshot.data}
            onChange={(e) => choose(e.target.value)}
          >
            <option value="">Kies een buurt…</option>
            {all
              .filter(
                (row) =>
                  row.properties.code === code ||
                  `${row.properties.name} ${row.properties.code}`
                    .toLocaleLowerCase("nl")
                    .includes(filter.toLocaleLowerCase("nl").trim()),
              )
              .map((row) => (
                <option key={row.properties.code} value={row.properties.code}>
                  {row.properties.name} · {row.properties.code}
                </option>
              ))}
          </select>
          {filter &&
            !all.some((row) =>
              `${row.properties.name} ${row.properties.code}`
                .toLocaleLowerCase("nl")
                .includes(filter.toLocaleLowerCase("nl").trim()),
            ) && (
              <p role="status">Geen buurt gevonden. Probeer een andere naam.</p>
            )}
          <div className="gr-or">of begin bij een adres</div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const q = input.trim();
              setAddressNotice("");
              setBoundary(null);
              if (q === submitted) void addresses.refetch();
              else setSubmitted(q);
            }}
          >
            <label htmlFor="gr-address">Amsterdams adres</label>
            <input
              id="gr-address"
              type="search"
              minLength={3}
              maxLength={200}
              required
              autoComplete="street-address"
              value={input}
              placeholder="Straat + huisnummer of postcode"
              onChange={(e) => {
                setInput(e.target.value);
                setBoundary(null);
                setAddressNotice("");
              }}
            />
            <button
              className="db-button"
              disabled={input.trim().length < 3 || addresses.isFetching}
            >
              <Search size={15} />
              {addresses.isFetching ? "Adressen zoeken…" : "Zoek adres"}
            </button>
          </form>
          {hasSearch && (
            <div className="gr-address-results" aria-live="polite">
              {addresses.error ? (
                <p role="alert">
                  Adreszoeken is niet gelukt. Probeer opnieuw of kies een buurt.
                </p>
              ) : addresses.data?.length === 0 ? (
                <p>Geen adres gevonden. Voeg een huisnummer of postcode toe.</p>
              ) : (
                addresses.data?.map((address) => (
                  <button key={address.id} onClick={() => pickAddress(address)}>
                    <MapPin size={14} />
                    {address.label}
                  </button>
                ))
              )}
            </div>
          )}
          {addressNotice && <p role="status">{addressNotice}</p>}
          {boundary && (
            <div className="gr-address-results">
              {all
                .filter((row) => boundary.codes.includes(row.properties.code))
                .map((row) => (
                  <button
                    key={row.properties.code}
                    onClick={() =>
                      choose(row.properties.code, boundary.address)
                    }
                  >
                    {row.properties.name}
                  </button>
                ))}
            </div>
          )}
          <p className="gr-small">
            Adreszoeken via{" "}
            <a href={addressSource} target="_blank" rel="noreferrer">
              PDOK Locatieserver
            </a>
            . De adreslocatie wordt gekoppeld aan de CBS-buurtgrenzen van 2025,
            ook als de huidige buurtindeling afwijkt.
          </p>
          <Link className="gr-catalog-link" href="/data/" prefetch={false}>
            Zelf bronnen ontdekken <ArrowUpRight size={14} />
          </Link>
        </aside>
        <section
          className="gr-report"
          id="gr-report"
          aria-label="Gebiedsrapport"
        >
          {snapshot.isPending && <p role="status">CBS-buurtgegevens laden…</p>}
          {snapshot.error && !snapshot.data && (
            <div className="gr-empty" role="alert">
              <h2>Buurtgegevens niet beschikbaar</h2>
              <p>Probeer de gegevens opnieuw te laden.</p>
              <button
                className="db-button"
                onClick={() => void snapshot.refetch()}
              >
                Opnieuw proberen
              </button>
            </div>
          )}
          {snapshot.data && !area && (
            <div className="gr-empty">
              <FileText size={36} />
              <h2>
                {code
                  ? "Deze buurt staat niet in de databank"
                  : "Eén plek, meerdere perspectieven"}
              </h2>
              <p>
                Kies links een buurt of adres. Het rapport toont echte
                brongegevens, inclusief ontbrekende cijfers en de periode waarop
                ze betrekking hebben.
              </p>
              <div className="gr-suggestions">
                {all
                  .filter((row) =>
                    [
                      "Concertgebouwbuurt",
                      "Havenkwartier IJburg",
                      "Weesp-Zuid II",
                    ].includes(row.properties.name),
                  )
                  .map((row) => (
                    <button
                      className="db-button"
                      key={row.properties.code}
                      onClick={() => choose(row.properties.code)}
                    >
                      {row.properties.name} <ArrowUpRight size={14} />
                    </button>
                  ))}
              </div>
            </div>
          )}
          {area && point && snapshot.data && (
            <>
              <div className="gr-heading">
                <div>
                  <span className="db-eyebrow">02 / JOUW GEBIEDSRAPPORT</span>
                  <h2>{area.properties.name}</h2>
                  <p>
                    {area.properties.code} · CBS-buurtgrens{" "}
                    {area.properties.year}
                  </p>
                </div>
                <div className="gr-actions">
                  <button className="db-button" onClick={() => void share()}>
                    <Share2 size={14} />
                    Deel rapport
                  </button>
                  <button className="db-button" onClick={() => window.print()}>
                    <Printer size={14} />
                    Afdrukken / PDF
                  </button>
                </div>
              </div>
              {notice && (
                <p className="gr-notice" role="status">
                  {notice}
                </p>
              )}
              <div className="gr-overview">
                {shape && (
                  <figure className="gr-shape">
                    <svg
                      viewBox="0 0 240 240"
                      role="img"
                      aria-label={`Buurtgrens van ${area.properties.name} met het gekozen locatiepunt`}
                    >
                      <path d={shape.path} fillRule="evenodd" />
                      <circle cx={shape.point[0]} cy={shape.point[1]} r="5" />
                      <text x="220" y="23">
                        N ↑
                      </text>
                    </svg>
                    <figcaption>
                      Buurtgrens CBS 2025 · punt voor de omgevingsbronnen
                    </figcaption>
                  </figure>
                )}
                <div className="gr-overview-data">
                  <p>
                    BUURT IN CIJFERS · CBS {snapshot.data.meta.statisticsYear}
                  </p>
                  <dl>
                    <div>
                      <dt>Inwoners</dt>
                      <dd>{number(area.properties.residents)}</dd>
                    </div>
                    <div>
                      <dt>Woningen</dt>
                      <dd>{number(area.properties.homes)}</dd>
                    </div>
                    <div>
                      <dt>Oppervlak buurtvlak</dt>
                      <dd>
                        {number(turfArea(area) / 1e6, 2)} <small>km²</small>
                      </dd>
                    </div>
                  </dl>
                  <SourceAge retrievedAt={snapshot.data.meta.retrievedAt} />
                  <p className="gr-small">
                    Oppervlak is berekend uit het volledige buurtvlak, inclusief
                    water. Buurtcijfers zijn geen kenmerken van een individuele
                    woning.
                  </p>
                </div>
              </div>
              <section className="gr-section" id="gr-voorzieningen">
                <div className="gr-section-title">
                  <span>01</span>
                  <div>
                    <h3>Voorzieningen dichtbij</h3>
                    <p>
                      Gemiddelde afstand over de weg voor inwoners van deze
                      buurt.
                    </p>
                  </div>
                </div>
                <div
                  className="gr-distances"
                  role="group"
                  aria-label="Gemiddelde afstanden tot voorzieningen"
                >
                  {rows
                    .filter((m) => amenityMetrics.includes(m.key))
                    .map((m) => (
                      <div
                        className="gr-distance"
                        key={m.key}
                        data-metric={m.key}
                      >
                        <div>
                          <strong>{m.label}</strong>
                          <span>{m.formatted}</span>
                        </div>
                        <div className="gr-track" aria-hidden="true">
                          {m.value !== null && (
                            <i
                              style={{
                                width: `${(100 * m.value) / maxDistance}%`,
                              }}
                            />
                          )}
                        </div>
                        <small>
                          CBS-tabel {m.tableYear} · waarnemingsjaar{" "}
                          {m.referenceYear ?? "niet vermeld"}
                        </small>
                        <details>
                          <summary>Definitie & bron</summary>
                          <p>
                            {m.definition}{" "}
                            <a href={m.source} target="_blank" rel="noreferrer">
                              CBS-bron ↗
                            </a>
                          </p>
                        </details>
                      </div>
                    ))}
                </div>
                <p className="gr-small">
                  Dit zijn buurtgemiddelden, geen route vanaf het gekozen punt.
                  Afstand zegt niets over vrije plaatsen, openingstijden of
                  patiëntenstops.
                </p>
              </section>
              <section
                className="gr-section gr-environment"
                aria-label="Omgeving van het gekozen punt"
              >
                <div className="gr-section-title">
                  <span>02</span>
                  <div>
                    <h3>Groen, geluid & bereikbaarheid</h3>
                    <p>Omgevingsbronnen rond één locatiepunt.</p>
                  </div>
                </div>
                <div className="gr-point">
                  <MapPin size={19} />
                  <div>
                    <strong>{point.label}</strong>
                    <p>
                      {point.coordinates.map((c) => number(c, 6)).join(" / ")} ·
                      lengtegraad / breedtegraad
                    </p>
                  </div>
                </div>
                <p className="gr-small">
                  {point.kind === "example"
                    ? "Voor deze buurt is een voorbeeldpunt binnen het buurtvlak gekozen. Het kan ook in water of op een niet-toegankelijke plek liggen. Zoek een adres voor een concrete locatie."
                    : "Dit punt ligt in de gekozen CBS-buurt. De omgevingswaarden gelden voor dit punt."}{" "}
                  Deze waarden zijn geen buurtgemiddelden.
                </p>
                <button
                  className="db-button gr-primary"
                  disabled={busy}
                  onClick={loadEnvironment}
                >
                  {busy
                    ? "Omgevingsbronnen ophalen…"
                    : requested === locationKey
                      ? "Omgevingsbronnen vernieuwen"
                      : "Omgevingsbronnen ophalen"}
                </button>
                <div className="gr-live-grid">
                  <article data-environment="trees">
                    <Trees size={21} />
                    <h4>Gemeentelijke bomen</h4>
                    <strong>
                      {trees.isFetching
                        ? "Laden…"
                        : trees.data
                          ? number(trees.data.data.features.length)
                          : trees.error
                            ? "Niet beschikbaar"
                            : "Nog niet opgehaald"}
                    </strong>
                    <p>
                      Binnen 250 meter hemelsbreed. Gemeentelijke registraties;
                      geen particuliere bomen of percentage groen.
                    </p>
                    <small>
                      Bronperiode: registratie bij opvraag; inventarisatiejaar
                      onbekend.
                    </small>
                    <FetchStatus query={trees} />
                    <a
                      href={environment.trees.source}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Gemeente Amsterdam ↗
                    </a>
                  </article>
                  <article data-environment="noise">
                    <Volume2 size={21} />
                    <h4>Gemodelleerd geluid</h4>
                    <strong>
                      {noise.isFetching
                        ? "Laden…"
                        : noise.data
                          ? noise.data.decibels === null
                            ? "Geen modelwaarde"
                            : `circa ${number(noise.data.decibels)} dB Lden`
                          : noise.error
                            ? "Niet beschikbaar"
                            : "Nog niet opgehaald"}
                    </strong>
                    <p>
                      Rasterwaarde bij het punt. Een globale modelindicatie,
                      geen gevelmeting of actuele hinder.
                    </p>
                    <small>
                      Kaart 2022 · samengestelde bronjaren 2022–2025.
                    </small>
                    <FetchStatus query={noise} />
                    <Link href="/data/geluid/" prefetch={false}>
                      RIVM-bronprofiel ↗
                    </Link>
                  </article>
                  <article data-environment="reachability">
                    <Bike size={21} />
                    <h4>15 minuten fietsen</h4>
                    <strong>
                      {reach.isFetching
                        ? "Laden…"
                        : reach.data
                          ? `${number(turfArea(reach.data.contours) / 1e6, 2)} km²`
                          : reach.error
                            ? "Niet beschikbaar"
                            : "Nog niet berekend"}
                    </strong>
                    <p>
                      Oppervlak van het gemodelleerde reisgebied vanaf dit punt
                      over het wegennet. Geen aantal voorzieningen.
                    </p>
                    <small>
                      Model bij opvraag · geen vastgesteld bronjaar van het
                      wegennet.
                    </small>
                    <FetchStatus
                      query={{
                        ...reach,
                        data: reach.data
                          ? { retrievedAt: reach.data.calculatedAt }
                          : undefined,
                      }}
                    />
                    <Link
                      href={`/analysis/reachability/?lng=${point.coordinates[0]}&lat=${point.coordinates[1]}`}
                      prefetch={false}
                    >
                      Verken bereik op de kaart ↗
                    </Link>
                  </article>
                </div>
                {(trees.error || noise.error || reach.error) && (
                  <p className="gr-notice" role="status">
                    Een of meer bronnen konden niet worden vernieuwd. Eerder
                    opgehaalde waarden houden hun eigen ophaaldatum; hun huidige
                    status is onbekend. Probeer het opnieuw met de knop
                    hierboven. Het CBS-rapport blijft beschikbaar.
                  </p>
                )}
                {reach.data && (
                  <p className="gr-small">
                    {reach.data.attribution} · Reistijden zijn modelschattingen
                    zonder actuele verkeersdrukte of gegarandeerde
                    toegankelijkheid.
                  </p>
                )}
              </section>
              {reportGroups.map((group, i) => (
                <section className="gr-section" key={group.id}>
                  <div className="gr-section-title">
                    <span>0{i + 3}</span>
                    <div>
                      <h3>{group.title}</h3>
                      <p>
                        Gepubliceerde buurtcijfers, met de eigen bronperiode per
                        kenmerk.
                      </p>
                    </div>
                  </div>
                  <div className="gr-metrics">
                    {rows
                      .filter((m) => group.metrics.includes(m.key))
                      .map((m) => (
                        <article key={m.key} data-metric={m.key}>
                          <h4>{m.label}</h4>
                          <strong>{m.formatted}</strong>
                          <small>
                            CBS-tabel {m.tableYear} ·{" "}
                            {m.key === "woz" || m.key === "wozChange"
                              ? "waardepeiljaar"
                              : "waarnemingsjaar"}{" "}
                            {m.referenceYear ?? "niet vermeld"}
                          </small>
                          <details>
                            <summary>Definitie & bron</summary>
                            <p>
                              {m.definition}{" "}
                              <a
                                href={m.source}
                                target="_blank"
                                rel="noreferrer"
                              >
                                CBS-bron ↗
                              </a>
                            </p>
                          </details>
                        </article>
                      ))}
                  </div>
                </section>
              ))}
              <section className="gr-section gr-method" id="gr-method">
                <span className="db-eyebrow">VAN INZICHT NAAR GEBRUIK</span>
                <h3>Neem dit rapport mee</h3>
                <p>
                  JSON bevat de buurtgrens, alle 25 buurtkenmerken, het
                  locatiepunt, brondefinities en de status van elke
                  omgevingsopvraag. CSV bevat alleen de 25 CBS-buurtkenmerken,
                  met bronjaren. Afdrukken maakt een leesbaar rapport dat je als
                  PDF kunt bewaren.
                </p>
                <div className="gr-actions">
                  <button
                    className="db-button gr-primary"
                    disabled={busy}
                    onClick={exportReport}
                  >
                    <ArrowDownToLine size={14} />
                    Rapport JSON
                  </button>
                  <button
                    className="db-button"
                    onClick={() =>
                      download(
                        reportCsv(area, snapshot.data!.meta),
                        `buurtcijfers-${code}.csv`,
                        "text/csv;charset=utf-8",
                      )
                    }
                  >
                    <ArrowDownToLine size={14} />
                    Buurtcijfers CSV
                  </button>
                  <Link
                    className="db-button"
                    href="/analysis/housing/"
                    prefetch={false}
                  >
                    Onderzoek alle buurten <ArrowUpRight size={14} />
                  </Link>
                </div>
                <p className="gr-small">
                  Ontbrekend of afgeschermd betekent onbekend, nooit nul.
                  CBS-buurtgrenzen en cijfers komen uit de vastgelegde snapshot;
                  live omgevingsbronnen hebben elk een eigen ophaaldatum. Er
                  wordt geen totaalscore of individuele woningwaarde afgeleid.
                </p>
                <Link href="/guides/open-data-amsterdam/" prefetch={false}>
                  Volledige bronverantwoording ↗
                </Link>
              </section>
            </>
          )}
        </section>
      </div>
      <footer className="db-footer">
        <span>Map Master · van bron naar buurt</span>
        <Link href="/data/" prefetch={false}>
          Terug naar de databank ↗
        </Link>
      </footer>
      <noscript>
        <p className="gr-nojs">
          Het kiezen van een gebied vraagt JavaScript. De{" "}
          <Link href="/data/cbs-buurten/">CBS-bestanden in de databank</Link>{" "}
          blijven rechtstreeks beschikbaar.
        </p>
      </noscript>
    </main>
  );
}

function FetchStatus({
  query,
}: {
  query: { data?: { retrievedAt: string }; error: unknown };
}) {
  return (
    <small className="gr-fetch-status">
      {query.data
        ? `Laatst geslaagd: ${date(query.data.retrievedAt)}.`
        : "Geen geslaagde opvraag."}
      {query.error && query.data
        ? " Verversen mislukt; huidige status onbekend."
        : ""}
    </small>
  );
}
