"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpRight,
  ChartNoAxesCombined,
  Search,
  TrendingUp,
} from "lucide-react";
import { WorkspaceNavigation } from "@/components/workspaces/navigation";
import {
  ShareView,
  flag,
  oneOf,
  text,
} from "@/components/workspaces/view-state";
import { SourceAge } from "@/components/workspaces/source-age";
import { assetPath } from "@/lib/paths";
import { loadDevelopment } from "./data";
import { DevelopmentMap, DevelopmentTimeline } from "./charts";
import { DevelopmentControls, DevelopmentRanking } from "./panels";
import {
  compare,
  comparisonCsv,
  crossesBreak,
  defaults,
  euro,
  exclusion,
  percent,
  rank,
  validPeriod,
  valueAt,
  type Exclusion,
  type Filters,
} from "./model";
import "./development.css";

const reasons: Record<Exclusion, string> = {
  "boundary-break": "wijziging in gebiedsafbakening",
  "missing-woz": "ontbrekende WOZ in begin- of eindjaar",
  "small-stock": "minder woningen dan het minimum",
  "missing-stock": "onvolledige woningvoorraadcijfers",
  "changed-stock": "voorraadverandering boven de ingestelde grens",
};
const yearsAvailable = Array.from({ length: 15 }, (_, i) => 2012 + i);

function save(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DevelopmentDashboard() {
  const [filters, setFilters] = useState<Filters>(defaults);
  const [selected, setSelected] = useState("");
  const [indexed, setIndexed] = useState(true);
  const [ascending, setAscending] = useState(false);
  const [limit, setLimit] = useState(30);
  const inputRef = useRef<HTMLInputElement>(null);
  const profileRef = useRef<HTMLHeadingElement>(null);
  const data = useQuery({
    queryKey: ["development-snapshot"],
    queryFn: ({ signal }) => loadDevelopment(signal),
    staleTime: Infinity,
    retry: false,
  });
  const snapshot = data.data?.snapshot;
  const ranking = useMemo(
    () => rank(snapshot?.areas ?? [], filters, ascending),
    [snapshot, filters, ascending],
  );
  const area = snapshot?.areas.find((row) => row.code === selected);
  const comparison = area ? compare(area, filters) : null;
  const cityComparison = snapshot ? compare(snapshot.city, filters) : null;
  const reason = area ? exclusion(area, filters) : null;
  const outsideSearch =
    !!area && !ranking.rows.some((row) => row.area.code === area.code);
  const update = (patch: Partial<Filters>) => {
    setFilters((value) => ({ ...value, ...patch }));
    setLimit(30);
  };
  const choose = (code: string) => {
    setSelected(code);
    requestAnimationFrame(() => {
      profileRef.current?.focus({ preventScroll: true });
      profileRef.current?.scrollIntoView({
        behavior: "instant",
        block: "nearest",
      });
    });
  };
  const exportData = () => {
    if (!snapshot) return;
    save(
      `buurtontwikkeling-${filters.start}-${filters.end}.json`,
      JSON.stringify(
        {
          version: 1,
          kind: "Amsterdam neighborhood WOZ comparison",
          filters,
          ascending,
          selected,
          indexed,
          provenance: snapshot.meta,
          city: snapshot.city,
          selectedArea: area ?? null,
          results: ranking.rows,
          exclusions: ranking.excluded,
          csv: {
            delimiter: ";",
            decimal: ".",
            missing: "empty",
            encoding: "UTF-8 with BOM",
          },
        },
        null,
        2,
      ),
      "application/json",
    );
  };

  return (
    <div
      className="bd-root"
      data-development
      data-ready={!!snapshot}
      data-selected={selected}
    >
      <a className="bd-skip" href="#development-main">
        Naar de buurtontwikkeling
      </a>
      <header className="bd-header">
        <Link className="bd-brand" href="/" prefetch={false}>
          <Image
            src={assetPath("/logo.svg")}
            alt=""
            width={31}
            height={31}
            priority
          />
          <span>
            Map Master<small>AMSTERDAM IN ONTWIKKELING</small>
          </span>
        </Link>
        <WorkspaceNavigation current="/analysis/development/" />
        <a href="#development-method" className="bd-button">
          Bronnen & methode
        </a>
      </header>
      <main id="development-main">
        <section className="bd-intro">
          <div>
            <span className="bd-eyebrow">
              BUURTONTWIKKELING ·{" "}
              {snapshot
                ? `${snapshot.meta.years[0]}–${snapshot.meta.years.at(-1)}`
                : "2012–2026"}
            </span>
            <h1>
              Hoe verandert de waarde
              <br />
              van jouw buurt?
            </h1>
            <p>
              Volg de gemiddelde WOZ door de jaren. Vergelijk buurten, bekijk de
              woningvoorraad en ontdek waar het gemiddelde het sterkst
              veranderde.
            </p>
          </div>
          <div className="bd-intro-note">
            <TrendingUp size={22} />
            <strong>Vijftien jaar in perspectief</strong>
            <p>
              Officiële cijfers van Onderzoek en Statistiek Amsterdam, met
              woningvoorraad en bronjaren bij elke vergelijking.
            </p>
            <span>WOZ per woning · euro · jaarlijkse reeks</span>
          </div>
        </section>
        <div className="bd-questions" aria-label="Begin met een vraag">
          <button
            disabled={!snapshot}
            onClick={() => {
              update({ ...defaults });
              setAscending(false);
            }}
          >
            <TrendingUp size={20} />
            <span>
              Welke buurt steeg het hardst?
              <small>Vergelijk tien jaar met voorraadfilter</small>
            </span>
            <ArrowUpRight size={17} />
          </button>
          <button
            disabled={!snapshot}
            onClick={() => {
              inputRef.current?.focus();
              inputRef.current?.scrollIntoView({ block: "center" });
            }}
          >
            <Search size={20} />
            <span>
              Hoe deed mijn buurt het?<small>Zoek en open je eigen buurt</small>
            </span>
            <ArrowUpRight size={17} />
          </button>
          <button
            disabled={!snapshot}
            onClick={() =>
              update({
                start: snapshot ? snapshot.meta.years.at(-1)! - 1 : 2025,
                end: snapshot?.meta.years.at(-1) ?? 2026,
                query: "",
              })
            }
          >
            <ChartNoAxesCombined size={20} />
            <span>
              Wat veranderde het laatste jaar?
              <small>Bekijk de recentste jaar-op-jaarverandering</small>
            </span>
            <ArrowUpRight size={17} />
          </button>
        </div>
        {data.isPending && (
          <p className="bd-loading" role="status">
            WOZ-reeksen en buurtgrenzen laden…
          </p>
        )}
        {data.error && (
          <div className="bd-error" role="alert">
            <h2>Buurtontwikkeling laden lukt nu niet</h2>
            <p>
              {data.error instanceof Error
                ? data.error.message
                : "Controleer je verbinding en probeer opnieuw."}
            </p>
            <button className="bd-button" onClick={() => void data.refetch()}>
              Opnieuw proberen
            </button>
          </div>
        )}
        {snapshot && (
          <div className="bd-content">
            <DevelopmentControls
              years={snapshot.meta.years}
              filters={filters}
              update={update}
              inputRef={inputRef}
            />
            <div className="bd-share-row">
              <p className="bd-note" role="status">
                <strong data-stat="neighborhoods">{ranking.rows.length}</strong>{" "}
                buurten in beeld · {ranking.eligible} voldoen aan de
                vergelijkingsfilters
              </p>
              <ShareView
                app="development"
                data={{ ...filters, selected, indexed, ascending }}
                defaults={{
                  ...defaults,
                  selected: "",
                  indexed: true,
                  ascending: false,
                }}
                rules={{
                  start: oneOf(yearsAvailable),
                  end: oneOf(yearsAvailable),
                  minimum: oneOf([0, 20, 100, 500]),
                  stockFilter: flag,
                  maxStockChange: oneOf([10, 20, 50, 100]),
                  query: text,
                  selected: text,
                  indexed: flag,
                  ascending: flag,
                }}
                apply={(view) => {
                  const period = {
                    start: view.start as number,
                    end: view.end as number,
                  };
                  setFilters({
                    start: validPeriod(period) ? period.start : defaults.start,
                    end: validPeriod(period) ? period.end : defaults.end,
                    minimum: view.minimum as number,
                    stockFilter: view.stockFilter as boolean,
                    maxStockChange: view.maxStockChange as number,
                    query: view.query as string,
                  });
                  setSelected(view.selected as string);
                  setIndexed(view.indexed as boolean);
                  setAscending(view.ascending as boolean);
                  setLimit(30);
                }}
              />
            </div>
            <div className="bd-stats">
              <div>
                <span>Periode</span>
                <strong>
                  {filters.start}–{filters.end}
                </strong>
                <small>
                  Waardepeildata {filters.start - 1}–{filters.end - 1}
                </small>
              </div>
              <div>
                <span>Amsterdam, officiële stadsreeks</span>
                <strong data-stat="city-growth">
                  {percent(cityComparison?.growth ?? null)}
                </strong>
                <small>
                  {crossesBreak(snapshot.city, filters)
                    ? "Gebiedswijziging Weesp rond 2022–2023: groei onbekend"
                    : "Buurtfilters veranderen het stadsgemiddelde niet"}
                </small>
              </div>
              <div>
                <span>Hoogste verandering binnen selectie</span>
                <strong>
                  {percent(
                    ranking.rows.length
                      ? Math.max(...ranking.rows.map((row) => row.growth))
                      : null,
                  )}
                </strong>
                <small>
                  {ranking.rows.length
                    ? ranking.rows.reduce((a, b) =>
                        a.growth >= b.growth ? a : b,
                      ).area.name
                    : "Pas je filters aan om buurten te zien"}
                </small>
              </div>
            </div>
            <div className="bd-visuals">
              <section
                className="bd-card bd-map-panel"
                aria-labelledby="development-map-title"
              >
                <span className="bd-eyebrow">HET RUIMTELIJKE VERHAAL</span>
                <h2 id="development-map-title">WOZ-verandering op de kaart</h2>
                <p className="bd-note">
                  {filters.start}–{filters.end} · kies een buurt. Selecteren kan
                  ook via de ranglijst.
                </p>
                <DevelopmentMap
                  geometry={data.data!.geometry}
                  rows={ranking.rows}
                  selected={selected}
                  choose={choose}
                />
                <p className="bd-note">
                  Gebiedsindeling {snapshot.meta.geometryVintage}. Grijze
                  buurten vallen buiten de selectie of hebben onvoldoende
                  gegevens.
                </p>
              </section>
              <section
                className="bd-card bd-profile"
                aria-labelledby="development-profile-title"
              >
                <div className="bd-section-head">
                  <div>
                    <span className="bd-eyebrow">JOUW BUURT DOOR DE JAREN</span>
                    <h2
                      id="development-profile-title"
                      tabIndex={-1}
                      ref={profileRef}
                    >
                      {area?.name ?? "Amsterdam als vertrekpunt"}
                    </h2>
                  </div>
                  {selected && (
                    <button
                      className="bd-button"
                      onClick={() => setSelected("")}
                    >
                      Buurtselectie wissen
                    </button>
                  )}
                </div>
                {area ? (
                  <>
                    <p className="bd-note">{area.code}</p>
                    <dl className="bd-area-stats">
                      <div>
                        <dt>WOZ {filters.start}</dt>
                        <dd>{euro(valueAt(area.woz, filters.start))}</dd>
                      </div>
                      <div>
                        <dt>WOZ {filters.end}</dt>
                        <dd>{euro(valueAt(area.woz, filters.end))}</dd>
                      </div>
                      <div>
                        <dt>Verandering</dt>
                        <dd>{percent(comparison?.growth ?? null)}</dd>
                      </div>
                    </dl>
                    {outsideSearch && (
                      <p className="bd-notice" role="status">
                        Deze buurt valt buiten de huidige selectie
                        {reason
                          ? `: ${reasons[reason]}`
                          : " door je zoekopdracht"}
                        . De tijdlijn blijft beschikbaar.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="bd-note">
                    Kies een buurt op de kaart of in de ranglijst om de
                    ontwikkeling naast de stad te zien.
                    {selected &&
                      " De gedeelde buurtcode is niet in deze bronstand aanwezig."}
                  </p>
                )}
                <label className="bd-chart-mode">
                  Tijdlijn tonen als
                  <select
                    aria-label="Tijdlijn tonen als"
                    value={indexed ? "index" : "euro"}
                    onChange={(e) => setIndexed(e.target.value === "index")}
                  >
                    <option value="index">Index: beginjaar = 100</option>
                    <option value="euro">Gemiddelde WOZ in euro</option>
                  </select>
                </label>
                <DevelopmentTimeline
                  area={area}
                  city={snapshot.city}
                  period={filters}
                  indexed={indexed}
                />
                {crossesBreak(snapshot.city, filters) && (
                  <p className="bd-notice">
                    Weesp ging in 2022 over naar Amsterdam. De stadsreeks heeft
                    rond 2022–2023 een mogelijke gebiedsbreuk. Een indexlijn
                    stopt daarom vóór deze breuk; de euroweergave toont
                    afzonderlijke delen.
                  </p>
                )}
                {area && (
                  <Link
                    className="bd-text-link"
                    prefetch={false}
                    href={`/analysis/housing/?view=${encodeURIComponent(JSON.stringify({ version: 1, app: "housing", data: { selected: area.code } }))}`}
                  >
                    Bekijk het actuele buurtprofiel op de woningkaart{" "}
                    <ArrowUpRight size={14} />
                  </Link>
                )}
              </section>
            </div>
            <details className="bd-exclusions">
              <summary>
                Hoe zijn {snapshot.areas.length} buurten geselecteerd?
              </summary>
              <p>
                Elke buurt krijgt de eerste toepasselijke reden. De zoekopdracht
                wordt daarna toegepast op de {ranking.eligible} overgebleven
                buurten.
              </p>
              <ul>
                {Object.entries(ranking.excluded).map(([key, count]) => (
                  <li key={key}>
                    {count} · {reasons[key as Exclusion]}
                  </li>
                ))}
              </ul>
              <p>
                Het voorraadfilter staat{" "}
                {filters.stockFilter
                  ? `aan: maximaal ±${filters.maxStockChange}% ten opzichte van het beginjaar, voor elk jaar in de periode`
                  : "uit"}
                .{" "}
                {filters.minimum > 0
                  ? `In begin- en eindjaar zijn minimaal ${filters.minimum} woningen vereist.`
                  : "Er geldt geen minimumaantal woningen."}
              </p>
            </details>
            <DevelopmentRanking
              rows={ranking.rows}
              filters={filters}
              selected={selected}
              choose={choose}
              ascending={ascending}
              setAscending={setAscending}
              limit={limit}
              setLimit={setLimit}
            />
            <div className="bd-export">
              <div>
                <strong>Neem je vergelijking mee</strong>
                <p>
                  De JSON bewaart reeksen, filters, definities en broncontroles.
                  De CSV bevat de zichtbare buurten met begin- en eindwaarden.
                </p>
              </div>
              <button
                className="bd-button"
                onClick={() =>
                  save(
                    `buurtontwikkeling-${filters.start}-${filters.end}.csv`,
                    comparisonCsv(ranking.rows, filters),
                    "text/csv;charset=utf-8",
                  )
                }
              >
                <ArrowDownToLine size={15} />
                CSV downloaden
              </button>
              <button className="bd-button" onClick={exportData}>
                <ArrowDownToLine size={15} />
                JSON met bronmetadata
              </button>
            </div>
            <section
              id="development-method"
              className="bd-method"
              aria-labelledby="development-method-title"
            >
              <span className="bd-eyebrow">OVER DEZE CIJFERS</span>
              <h2 id="development-method-title">
                Een buurtgemiddelde in context
              </h2>
              <p>
                De gemiddelde WOZ per woning komt uit de Statistiekhub van
                Onderzoek en Statistiek Amsterdam, indicator{" "}
                <strong>WWOZ_GEM</strong>. De woningvoorraad komt uit{" "}
                <strong>WVOORRBAG</strong>. Bronjaar {filters.end} heeft
                waardepeildatum 1 januari {filters.end - 1}. De procentuele
                verandering is (eindwaarde / beginwaarde − 1) × 100.
              </p>
              <details>
                <summary>Wat vertelt de ontwikkeling?</summary>
                <p>
                  De reeks beschrijft het gemiddelde van de woningen in een
                  buurt. Nieuwbouw, sloop, transformatie en veranderingen in
                  woningtypen kunnen dit gemiddelde verschuiven. Het
                  voorraadfilter helpt om grote verschuivingen te herkennen. Ook
                  bij een stabiele voorraad kan de woningmix veranderen.
                  Bedragen zijn nominaal en niet gecorrigeerd voor inflatie.
                  Voor een marktprijs per m² is een andere bron nodig: deze
                  indicator geeft WOZ per woning.
                </p>
              </details>
              <details>
                <summary>
                  Gebiedsindeling, ontbrekende waarden en reeksbreuken
                </summary>
                <p>
                  De historische cijfers zijn waar mogelijk door O&S herberekend
                  naar gebiedsindeling {snapshot.meta.geometryVintage}. De kaart
                  gebruikt de bijbehorende historische buurtgeometrieën,
                  gekoppeld via de officiële gebiedsidentificaties. Weesp en
                  Dorp Driemond vragen extra aandacht rond 2022; onzekere
                  vergelijkingen over een vastgelegde breuk blijven leeg.
                </p>
                <p>
                  Een ontbrekende waarde blijft onbekend. Voor de ranglijst
                  moeten begin- en eindwaarde bekend zijn; een ontbrekend
                  tussenjaar onderbreekt de lijn. Het voorraadfilter vereist
                  complete jaarlijkse tellingen. Vanaf 2015 omvat de
                  BAG-woningvoorraad ook kleine huur- en studentenwoningen: bij
                  een eerdere start kan de definitiewijziging het filter
                  beïnvloeden.
                </p>
              </details>
              <SourceAge
                retrievedAt={snapshot.meta.retrievedAt}
                sourceYear={snapshot.meta.years.at(-1)}
              />
              <div className="bd-source-links">
                <a
                  href="https://onderzoek.amsterdam.nl/interactief/dashboard-kerncijfers"
                  target="_blank"
                  rel="noreferrer"
                >
                  O&S kerncijfers <ArrowUpRight size={14} />
                </a>
                <a
                  href="https://onderzoek.amsterdam.nl/artikel/nieuwe-toegang-tot-actuele-statistieken"
                  target="_blank"
                  rel="noreferrer"
                >
                  Statistiekhub: bron en toegang <ArrowUpRight size={14} />
                </a>
                <Link href="/data/bbga/" prefetch={false}>
                  Bronprofiel in de databank <ArrowUpRight size={14} />
                </Link>
              </div>
            </section>
          </div>
        )}
        <noscript>
          <p className="bd-loading">
            Schakel JavaScript in om periodes en buurten te vergelijken. De bron
            is ook beschikbaar via het{" "}
            <a href="https://onderzoek.amsterdam.nl/interactief/dashboard-kerncijfers">
              O&S-kerncijferdashboard
            </a>
            .
          </p>
        </noscript>
      </main>
      <footer className="bd-footer">
        <span>Onderzoek en Statistiek Amsterdam · open gebiedscijfers</span>
        <Link href="/analysis/housing/" prefetch={false}>
          Verder naar wonen & buurtkenmerken →
        </Link>
      </footer>
    </div>
  );
}
