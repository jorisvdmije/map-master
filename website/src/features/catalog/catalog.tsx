"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Bookmark,
  Check,
  Database,
  House,
  Layers,
  LayoutGrid,
  List,
  Search,
  SlidersHorizontal,
  Sprout,
  Wind,
  X,
} from "lucide-react";
import { download } from "@/lib/download";
import {
  useCatalogReady,
  useCatalogSearch,
  useSavedDatasets,
  updateFilters,
  saveDatasets,
} from "./browser-state";
import { CatalogHeader } from "./header";
import {
  catalogCsv,
  datasetPath,
  defaultFilters,
  filterCatalog,
  metadataExport,
  parseSaved,
  readFilters,
} from "./model";
import { availability, themes, type Catalog, type CatalogEntry } from "./types";
import "./catalog.css";

const date = (value: string) =>
  new Date(value).toLocaleDateString("nl-NL", { timeZone: "UTC" });
const questions = [
  {
    title: "Wonen & waarde",
    text: "WOZ, woningmix en adressen",
    theme: "wonen",
    icon: House,
  },
  {
    title: "Groen in de buurt",
    text: "Bomen, parken en buitenruimte",
    theme: "groen",
    icon: Sprout,
  },
  {
    title: "Gezonde leefomgeving",
    text: "Lucht, geluid en klimaat",
    theme: "klimaat",
    icon: Wind,
  },
  {
    title: "Voorzieningen dichtbij",
    text: "Bewoners, scholen en afstanden",
    theme: "mensen",
    icon: Layers,
  },
];
export function DataCatalog({ catalog }: { catalog: Catalog }) {
  const ready = useCatalogReady();
  const search = useCatalogSearch(),
    rawSaved = useSavedDatasets();
  const saved = parseSaved(rawSaved, catalog.datasets),
    filters = readFilters(search, catalog.datasets);
  const [view, setView] = useState<"cards" | "table">("cards"),
    [notice, setNotice] = useState("");
  const rows = filterCatalog(catalog.datasets, filters, saved);
  const providers = [
    ...new Set(catalog.datasets.map((entry) => entry.publisher)),
  ].sort((a, b) => a.localeCompare(b, "nl"));
  const local = catalog.datasets.filter(
    (entry) => entry.availability === "local",
  ).length;
  const connected = catalog.datasets.filter(
    (entry) => entry.availability === "connected",
  ).length;
  const patch = (value: Partial<typeof filters>, replace = false) =>
    updateFilters({ ...filters, ...value }, replace);
  const toggle = (entry: CatalogEntry) => {
    const next = saved.includes(entry.id)
      ? saved.filter((id) => id !== entry.id)
      : [...saved, entry.id];
    setNotice(
      saveDatasets(next)
        ? `${entry.title} ${next.includes(entry.id) ? "bewaard in" : "verwijderd uit"} je favorieten.`
        : "Browseropslag is niet beschikbaar. Je kunt je favorieten voor nu blijven gebruiken; download de bronprofielen om ze te bewaren.",
    );
  };
  const favorite = (entry: CatalogEntry) => (
    <button
      className="db-bookmark"
      aria-label={`${saved.includes(entry.id) ? "Verwijder" : "Bewaar"} ${entry.title}${saved.includes(entry.id) ? " uit" : " in"} favorieten`}
      aria-pressed={saved.includes(entry.id)}
      onClick={() => toggle(entry)}
    >
      <Bookmark
        size={18}
        fill={saved.includes(entry.id) ? "currentColor" : "none"}
        aria-hidden="true"
      />
    </button>
  );
  const active = Object.entries(filters).some(
    ([key, value]) =>
      value !== defaultFilters[key as keyof typeof defaultFilters],
  );
  return (
    <main
      lang="nl"
      className="db-root"
      data-catalog
      data-ready={ready ? "true" : undefined}
    >
      <a className="skip-link" href="#db-results">
        Naar de datasets
      </a>
      <CatalogHeader />
      <section className="db-hero">
        <div>
          <span className="db-eyebrow">
            <Database size={14} />
            DE DATABANK VAN MAP MASTER
          </span>
          <h1>
            Vind de data achter
            <br />
            <em>een goed inzicht.</em>
          </h1>
          <p>
            Van een boom voor de deur tot het verhaal van een hele buurt. Vind
            bronnen voor jouw vraag en ontdek waarmee je direct aan de slag
            kunt.
          </p>
        </div>
        <div className="db-hero-note">
          <span>AMSTERDAM + NEDERLAND</span>
          <strong>{catalog.datasets.length} bronprofielen</strong>
          <p>
            {local} met bestanden · {connected} gekoppeld aan onze kaarten
          </p>
          <small>
            Bronlinks bekeken op {date(catalog.checkedAt)}.<br />
            De bronperiode staat bij iedere dataset.
          </small>
        </div>
      </section>
      <div className="db-report-callout">
        <div>
          <strong>Wat vertellen deze bronnen over jouw buurt?</strong>
          <p>
            Bekijk wonen, groen, geluid, voorzieningen en bereikbaarheid samen,
            met bronjaren.
          </p>
        </div>
        <Link className="db-button" href="/area-report/" prefetch={false}>
          Maak een gebiedsrapport <ArrowUpRight size={15} />
        </Link>
      </div>
      <section className="db-start" aria-label="Begin bij een onderzoeksvraag">
        {questions.map((item) => (
          <button
            key={item.theme}
            aria-pressed={filters.theme === item.theme}
            onClick={() =>
              updateFilters({ ...defaultFilters, theme: item.theme })
            }
          >
            <item.icon size={21} aria-hidden="true" />
            <span>
              <strong>{item.title}</strong>
              <small>{item.text}</small>
            </span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        ))}
      </section>
      <div className="db-layout">
        <aside className="db-sidebar" aria-label="Datasetfilters">
          <h2>
            <SlidersHorizontal size={17} />
            Verfijn je zoekvraag
          </h2>
          <div className="db-filter-grid">
            <label>
              Thema
              <select
                aria-label="Thema"
                value={filters.theme}
                onChange={(e) => patch({ theme: e.target.value })}
              >
                <option value="all">Alle thema’s</option>
                {Object.entries(themes).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Beschikbaarheid
              <select
                aria-label="Beschikbaarheid"
                value={filters.availability}
                onChange={(e) => patch({ availability: e.target.value })}
              >
                <option value="all">Alles bekijken</option>
                {Object.entries(availability).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Gebied
              <select
                aria-label="Gebied"
                value={filters.coverage}
                onChange={(e) => patch({ coverage: e.target.value })}
              >
                <option value="all">Amsterdam en Nederland</option>
                <option value="amsterdam">Amsterdamse gegevens</option>
                <option value="netherlands">Landelijk beschikbaar</option>
              </select>
            </label>
            <label>
              Aanbieder
              <select
                aria-label="Aanbieder"
                value={filters.provider}
                onChange={(e) => patch({ provider: e.target.value })}
              >
                <option value="all">Alle aanbieders</option>
                {providers.map((provider) => (
                  <option key={provider}>{provider}</option>
                ))}
              </select>
            </label>
          </div>
          <button
            className="db-saved-filter"
            aria-pressed={filters.saved}
            onClick={() => patch({ saved: !filters.saved })}
          >
            <Bookmark size={16} aria-hidden="true" />
            Mijn bewaarde bronnen <span>{saved.length}</span>
          </button>
          {active && (
            <button
              className="db-reset"
              onClick={() => updateFilters(defaultFilters)}
            >
              <X size={14} />
              Wis alle filters
            </button>
          )}
          <details className="db-help">
            <summary>Wat betekent beschikbaar?</summary>
            <dl>
              <dt>Bestand beschikbaar</dt>
              <dd>
                Een vastgelegd bestand dat je hier kunt downloaden, met datum en
                herkomst.
              </dd>
              <dt>In onze kaarten</dt>
              <dd>
                Deze bron wordt gebruikt in een kaart van Map Master. Het
                bronprofiel legt uit welke gegevens worden gebruikt.
              </dd>
              <dt>Bij de bron</dt>
              <dd>
                Een aanvullende gegevensbron. De aanbieder bepaalt toegang,
                formaat en actualiteit.
              </dd>
            </dl>
          </details>
          <div className="db-own">
            <Database size={19} />
            <h3>Je eigen data erbij?</h3>
            <p>
              Open GeoJSON of CSV in de vrije analyse. Bewaar bewerkbare
              geometrieprojecten in de Playground.
            </p>
            <Link href="/analysis/" prefetch={false}>
              Open vrije analyse <ArrowUpRight size={14} />
            </Link>
          </div>
        </aside>
        <section className="db-results" id="db-results" aria-label="Datasets">
          <div className="db-search">
            <Search size={20} aria-hidden="true" />
            <input
              aria-label="Zoek datasets"
              type="search"
              value={filters.q}
              maxLength={200}
              placeholder="Zoek bijvoorbeeld bomen, geluid, laadpunten of WOZ…"
              onChange={(e) => patch({ q: e.target.value }, true)}
            />
            {filters.q && (
              <button
                aria-label="Wis zoekopdracht"
                onClick={() => patch({ q: "" }, true)}
              >
                <X size={17} />
              </button>
            )}
          </div>
          <div className="db-results-bar">
            <div role="status">
              <strong>
                {rows.length} {rows.length === 1 ? "bron" : "bronnen"}
              </strong>
              <span>
                {active ? "met jouw filters" : "voor je volgende onderzoek"}
              </span>
            </div>
            <div className="db-view" aria-label="Weergave">
              <button
                aria-label="Kaartenweergave"
                aria-pressed={view === "cards"}
                onClick={() => setView("cards")}
              >
                <LayoutGrid size={17} />
              </button>
              <button
                aria-label="Tabelweergave"
                aria-pressed={view === "table"}
                onClick={() => setView("table")}
              >
                <List size={18} />
              </button>
            </div>
            <details className="db-export">
              <summary>
                <ArrowDownToLine size={15} />
                Exporteer overzicht
              </summary>
              <div>
                <button
                  disabled={!rows.length}
                  onClick={() =>
                    download(
                      JSON.stringify(
                        metadataExport(catalog, rows, filters),
                        null,
                        2,
                      ),
                      "map-master-bronprofielen.json",
                    )
                  }
                >
                  Bronprofielen JSON
                </button>
                <button
                  disabled={!rows.length}
                  onClick={() =>
                    download(
                      catalogCsv(rows),
                      "map-master-bronoverzicht.csv",
                      "text/csv;charset=utf-8",
                    )
                  }
                >
                  Bronoverzicht CSV
                </button>
              </div>
            </details>
          </div>
          {notice && (
            <p className="db-notice" role="status">
              <Check size={15} />
              {notice}
            </p>
          )}
          {rows.length === 0 ? (
            <div className="db-empty">
              <Search size={30} />
              <h2>Geen bron gevonden</h2>
              <p>
                {filters.saved && !saved.length
                  ? "Bewaar een bron met het bladwijzertje. Je vindt hem daarna hier terug, in deze browser."
                  : "Probeer een ander woord of maak je filters ruimer."}
              </p>
              <button
                className="db-button"
                onClick={() => updateFilters(defaultFilters)}
              >
                Bekijk alle bronnen
              </button>
            </div>
          ) : view === "cards" ? (
            <div className="db-grid">
              {rows.map((entry) => (
                <article
                  className="db-card"
                  key={entry.id}
                  data-dataset={entry.id}
                  data-theme={entry.theme}
                >
                  <div className="db-card-top">
                    <span className="db-theme">{themes[entry.theme]}</span>
                    {favorite(entry)}
                  </div>
                  <Link
                    className="db-card-title"
                    href={datasetPath(entry.id)}
                    prefetch={false}
                  >
                    <h2>{entry.title}</h2>
                  </Link>
                  <p>{entry.summary}</p>
                  <div className="db-card-meta">
                    <span>
                      {entry.coverage === "amsterdam"
                        ? "Amsterdam"
                        : "Nederland"}{" "}
                      · {entry.level}
                    </span>
                    <span>{entry.time}</span>
                  </div>
                  <div className="db-card-bottom">
                    <span
                      className="db-availability"
                      data-availability={entry.availability}
                    >
                      {entry.availability === "local" ? (
                        <ArrowDownToLine size={12} />
                      ) : entry.availability === "connected" ? (
                        <Layers size={12} />
                      ) : (
                        <ArrowUpRight size={12} />
                      )}
                      {availability[entry.availability]}
                    </span>
                    <Link
                      href={datasetPath(entry.id)}
                      prefetch={false}
                      aria-label={`Bekijk ${entry.title}`}
                    >
                      Bekijken <ArrowUpRight size={14} />
                    </Link>
                  </div>
                  <small className="db-publisher">{entry.publisher}</small>
                </article>
              ))}
            </div>
          ) : (
            <div
              className="db-table"
              tabIndex={0}
              aria-label="Bronnenoverzicht, horizontaal schuifbaar"
            >
              <table>
                <caption>
                  Dezelfde bronnen en filters als de kaartenweergave
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Bewaar</th>
                    <th scope="col">Dataset</th>
                    <th scope="col">Aanbieder</th>
                    <th scope="col">Niveau en periode</th>
                    <th scope="col">Beschikbaar</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry) => (
                    <tr key={entry.id} data-dataset={entry.id}>
                      <td>{favorite(entry)}</td>
                      <th scope="row">
                        <Link href={datasetPath(entry.id)} prefetch={false}>
                          {entry.title}
                        </Link>
                        <small>{themes[entry.theme]}</small>
                      </th>
                      <td>{entry.publisher}</td>
                      <td>
                        {entry.level}
                        <small>{entry.time}</small>
                      </td>
                      <td>{availability[entry.availability]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="db-footnote">
            Een bronprofiel beschrijft wat je kunt vinden. Het is geen belofte
            dat alle gegevens al zijn gekoppeld. Op de bronpagina staan
            toegangsvoorwaarden, definities en de beschikbare bestanden.
          </p>
          <noscript>
            <p>
              Zoeken en bewaren werken met JavaScript. Alle bronprofielen en
              downloads blijven via de bovenstaande links bereikbaar.
            </p>
          </noscript>
        </section>
      </div>
      <footer className="db-footer">
        <span>Map Master · van bron naar inzicht</span>
        <Link href="/guides/open-data-amsterdam/" prefetch={false}>
          Lees de bronverantwoording <ArrowUpRight size={14} />
        </Link>
      </footer>
    </main>
  );
}
