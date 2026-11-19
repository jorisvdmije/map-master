import { useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Database,
  Hash,
  Layers3,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type { SourceDefinition } from "./data/catalog";
import type { SourceBundle } from "./data/source-loader";
import "./source-library.css";

type SourceStatus = { phase: "loading" | "error"; message?: string };
export type SourceLibraryProps = {
  sources: SourceDefinition[];
  loaded: SourceBundle[];
  statuses: Record<string, SourceStatus>;
  usedSourceIds: string[];
  onAdd: (id: string) => void;
  onRefresh: (id: string) => void;
  onRemove: (id: string) => void;
  onCancel: (id: string) => void;
};

function dateLabel(date: string) {
  const value = new Date(date);
  return Number.isFinite(value.getTime())
    ? value.toLocaleDateString("nl-NL", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Datum onbekend";
}

export function SourceLibrary({
  sources,
  loaded,
  statuses,
  usedSourceIds,
  onAdd,
  onRefresh,
  onRemove,
  onCancel,
}: SourceLibraryProps) {
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<string | null>(null);
  const [onlyLoaded, setOnlyLoaded] = useState(false);
  const bundles = useMemo(
    () => new Map(loaded.map((bundle) => [bundle.sourceId, bundle])),
    [loaded],
  );
  const themes = [...new Set(sources.map((source) => source.theme))];
  const publishers = [...new Set(sources.map((source) => source.publisher))];
  const text = query.trim().toLocaleLowerCase("nl-NL");
  const matches = sources.filter(
    (source) =>
      (!theme || source.theme === theme) &&
      (!onlyLoaded || bundles.has(source.id)) &&
      (!text ||
        [
          source.title,
          source.description,
          source.theme,
          source.publisher,
          ...source.upstreamSources,
          source.notes,
          ...source.variables.flatMap((variable) => [
            variable.label,
            variable.unit,
            variable.description,
          ]),
        ]
          .join(" ")
          .toLocaleLowerCase("nl-NL")
          .includes(text)),
  );
  const reset = () => {
    setQuery("");
    setTheme(null);
    setOnlyLoaded(false);
  };

  return (
    <div className="source-library" data-source-library>
      <div className="sl-introduction">
        <div className="sl-intro-icon">
          <Layers3 size={21} />
        </div>
        <div>
          <h3>Geef je volgende vraag meer data.</h3>
          <p>
            Zoek een onderwerp en voeg de variabelen toe aan je werkruimte.
            Daarna kun je ze direct naar een as slepen.
          </p>
        </div>
      </div>
      <div className="sl-search-row">
        <div className="sl-search">
          <Search size={17} />
          <input
            type="search"
            aria-label="Zoek databronnen"
            placeholder="Zoek op onderwerp, variabele of eenheid…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              type="button"
              aria-label="Zoekopdracht bronnen wissen"
              onClick={() => setQuery("")}
            >
              <X size={15} />
            </button>
          )}
        </div>
        <button
          type="button"
          className={`sl-loaded-filter ${onlyLoaded ? "selected" : ""}`}
          aria-pressed={onlyLoaded}
          onClick={() => setOnlyLoaded((value) => !value)}
        >
          <CheckCircle2 size={14} />
          <span>In werkruimte</span>
          <b>{loaded.length}</b>
        </button>
      </div>
      <div
        className="sl-themes"
        role="group"
        aria-label="Filter bronnen op thema"
      >
        <button
          type="button"
          aria-pressed={!theme}
          onClick={() => setTheme(null)}
        >
          Alle thema’s
        </button>
        {themes.map((item) => (
          <button
            type="button"
            key={item}
            aria-pressed={theme === item}
            onClick={() => setTheme(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="sl-result-heading">
        <span aria-live="polite">
          {matches.length} {matches.length === 1 ? "bron" : "bronnen"}
          {theme ? ` · ${theme}` : ""}
        </span>
        <span>
          <Database size={12} />
          Data laden bij toevoegen
        </span>
      </div>
      <div className="sl-cards">
        {matches.map((source) => {
          const bundle = bundles.get(source.id);
          const status = statuses[source.id];
          const loading = status?.phase === "loading";
          const error = status?.phase === "error";
          const inUse = usedSourceIds.includes(source.id);
          const variables = source.variables.filter(
            (variable) => variable.kind === "number",
          );
          const years = [...source.years].sort((a, b) => a - b);
          const loadedFrom =
            bundle?.loadedFrom === "live" ? "Live opgehaald" : "Momentopname";
          return (
            <article
              className={`sl-card ${bundle ? "is-loaded" : ""} ${loading ? "is-loading" : ""}`}
              key={source.id}
              data-source-id={source.id}
              aria-busy={loading}
            >
              <div className="sl-card-heading">
                <span className="sl-source-icon">
                  <Database size={18} />
                </span>
                <div>
                  <div className="sl-card-title">
                    <h3>{source.title}</h3>
                    {bundle && (
                      <span className="sl-loaded-badge">
                        <Check size={11} />
                        Toegevoegd
                      </span>
                    )}
                  </div>
                  <p>{source.publisher}</p>
                </div>
              </div>
              <p className="sl-card-description">{source.description}</p>
              <div
                className="sl-variables"
                aria-label={`Variabelen in ${source.title}`}
              >
                {variables.map((variable) => (
                  <span key={variable.id} title={variable.description}>
                    <Hash size={10} />
                    <span>{variable.label}</span>
                    <small>{variable.unit}</small>
                  </span>
                ))}
              </div>
              <div className="sl-card-meta">
                <span>
                  <CalendarDays size={12} />
                  {years.length
                    ? years[0] === years.at(-1)
                      ? years[0]
                      : `${years[0]}–${years.at(-1)}`
                    : "Periode onbekend"}
                </span>
                <span>{source.theme}</span>
                <span>{years.length} bronjaren</span>
              </div>
              <details className="sl-definitions">
                <summary>
                  Definities & herkomst
                  <ChevronDown size={12} />
                </summary>
                <div>
                  <p className="sl-geography">
                    <strong>Gebiedsindeling</strong>
                    {source.geometryVintage
                      ? dateLabel(source.geometryVintage)
                      : "Zie bronbeschrijving"}
                    . Gegevens worden op buurtcode en bronjaar gekoppeld.
                  </p>
                  <p className="sl-geography">
                    <strong>Onderliggende registraties</strong>
                    {source.upstreamSources.join(" · ")}
                  </p>
                  <p className="sl-geography">
                    <strong>Beschikbare bronjaren</strong>
                    {years.join(", ")}
                  </p>
                  <dl>
                    {variables.map((variable) => (
                      <div key={variable.id}>
                        <dt>
                          {variable.label}
                          <span>{variable.unit}</span>
                        </dt>
                        <dd>{variable.description}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="sl-geography">{source.notes}</p>
                  <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                    Bekijk oorspronkelijke bron <ArrowUpRight size={12} />
                  </a>
                </div>
              </details>
              {bundle && (
                <div className="sl-provenance">
                  <ShieldCheck size={14} />
                  <span>
                    <strong>{loadedFrom}</strong> · bron opgehaald{" "}
                    {dateLabel(bundle.retrievedAt)}
                    <small>Beschikbaar in deze werkruimte.</small>
                  </span>
                </div>
              )}
              {bundle?.fallbackReason && !error && (
                <p className="sl-source-notice">
                  <AlertCircle size={13} />
                  <span title={bundle.fallbackReason}>
                    Live gegevens konden niet worden gebruikt. De gecontroleerde
                    momentopname is beschikbaar.
                  </span>
                </p>
              )}
              {error && (
                <div className="sl-error" role="alert">
                  <AlertCircle size={15} />
                  <span>
                    <strong>Ophalen is niet gelukt</strong>
                    {status.message ||
                      "Controleer je verbinding en probeer opnieuw."}
                    {bundle && (
                      <small>
                        De eerder geladen gegevens blijven beschikbaar.
                      </small>
                    )}
                  </span>
                </div>
              )}
              <div className="sl-card-actions">
                {loading ? (
                  <>
                    <span className="sl-loading-text" role="status">
                      <LoaderCircle size={15} />
                      {bundle ? "Bron verversen…" : "Gegevens ophalen…"}
                    </span>
                    <button
                      type="button"
                      className="sl-quiet-button"
                      aria-label={`${source.title} ophalen annuleren`}
                      onClick={() => onCancel(source.id)}
                    >
                      Annuleren
                    </button>
                  </>
                ) : bundle ? (
                  <>
                    <button
                      type="button"
                      className="sl-quiet-button"
                      aria-label={`${source.title} verversen`}
                      onClick={() => onRefresh(source.id)}
                    >
                      <RefreshCw size={13} />
                      {error ? "Opnieuw proberen" : "Verversen"}
                    </button>
                    <button
                      type="button"
                      className="sl-remove-button"
                      aria-label={`${source.title} verwijderen`}
                      disabled={inUse}
                      title={
                        inUse
                          ? "Deze bron wordt gebruikt door een blok. Kies eerst andere variabelen in dat blok."
                          : "Verwijder de variabelen van deze bron uit je werkruimte"
                      }
                      onClick={() => onRemove(source.id)}
                    >
                      <Trash2 size={13} />
                      Verwijderen
                    </button>
                  </>
                ) : (
                  <>
                    <span className="sl-ready-label">
                      Klaar om te verkennen
                    </span>
                    <button
                      type="button"
                      className="sl-add-button"
                      aria-label={`${source.title} toevoegen`}
                      onClick={() => onAdd(source.id)}
                    >
                      {error ? <RefreshCw size={14} /> : <Plus size={14} />}
                      {error ? "Opnieuw proberen" : "Toevoegen"}
                    </button>
                  </>
                )}
              </div>
              {!!bundle && inUse && (
                <p className="sl-in-use">
                  In gebruik door een blok. Kies daar eerst andere variabelen om
                  deze bron te verwijderen.
                </p>
              )}
            </article>
          );
        })}
      </div>
      {!matches.length && (
        <div className="sl-empty">
          <Search size={27} />
          <h3>Geen bron gevonden</h3>
          <p>
            Probeer een ander onderwerp of zoek bijvoorbeeld op ‘woningen’,
            ‘groei’ of ‘%’.
          </p>
          <button type="button" onClick={reset}>
            Wis de filters
          </button>
        </div>
      )}
      <div className="sl-footer">
        <ShieldCheck size={15} />
        <p>
          WOZ en woningvoorraad zijn standaard geladen. Deze bibliotheek toont
          aanvullende indicatorgroepen.{" "}
          {publishers.length === 1 ? (
            <>
              Deze bronnen zijn verschillende indicatorgroepen van{" "}
              <strong>{publishers[0]}</strong>.
            </>
          ) : (
            <>
              De bibliotheek bevat bronnen van {publishers.length}{" "}
              oorspronkelijke publiceerders.
            </>
          )}{" "}
          Nieuwe gegevens worden pas opgehaald als je een bron toevoegt.
          Ontbrekende waarden blijven onbekend.
        </p>
      </div>
    </div>
  );
}
