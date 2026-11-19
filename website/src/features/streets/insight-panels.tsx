import { dataSwatch } from "@/components/workspaces/data-swatch";
import { ArrowUpRight, GitBranch, MapPinned } from "lucide-react";
import {
  aggregate,
  clusterStreets,
  labels,
  scoreColor,
  units,
  formatValue,
  clusterMetrics,
  windowTotal,
  type Metric,
  type Street,
} from "./model";
import { number } from "./format";

/** Street profiles from k-means: trained on the whole city, filtered for display. */
export function ProfilesPanel({
  clustering,
  k,
  setK,
  streets,
  activeCluster,
  setCluster,
  showOnMap,
}: {
  clustering: ReturnType<typeof clusterStreets>;
  k: number;
  setK: (k: number) => void;
  /** Streets in the current selection, to count per profile. */
  streets: Street[];
  activeCluster: number | null;
  setCluster: (cluster: number | null) => void;
  showOnMap: () => void;
}) {
  return (
    <>
      <div className="st-card-heading">
        <span className="st-kicker">VERGELIJKBARE STRATEN</span>
        <h2>Welke profielen zie je?</h2>
        <p>
          K-means groepeert straten op lichtobjectdichtheid, boomdichtheid en
          meldingsdruk. Een profiel is geen aaneengesloten gebied.
        </p>
        {clustering.clusters.length < k && (
          <p>
            Er zijn {clustering.clusters.length} verschillende profielen
            mogelijk; lege of identieke clusters zijn weggelaten.
          </p>
        )}
      </div>
      <label className="st-field">
        Aantal clusters
        <select
          aria-label="Aantal clusters"
          value={k}
          onChange={(e) => {
            setK(+e.target.value);
            setCluster(null);
          }}
        >
          {[3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n} profielen
            </option>
          ))}
        </select>
      </label>
      <button className="an-button st-wide" onClick={() => showOnMap()}>
        <GitBranch size={14} />
        Toon profielen op de kaart
      </button>
      <div className="st-cluster-list">
        {clustering.clusters.map((c) => {
          const count = streets.filter(
            (s) => clustering.assignments.get(s.id) === c.id,
          ).length;
          return (
            <section
              key={c.id}
              className={activeCluster === c.id ? "st-selected-cluster" : ""}
            >
              <div className="st-cluster-heading">
                <h3>
                  <i style={{ background: c.color }} />
                  Profiel {c.id + 1}
                </h3>
                <span>{number(count)} in selectie</span>
              </div>
              <p>Teruggetransformeerd logcentrum · {c.members} straten</p>
              {clusterMetrics.map((m, i) => (
                <div className="st-profile-bar" key={m}>
                  <span>
                    {labels[m]}
                    <small>{units[m]}</small>
                  </span>
                  <i>
                    <em
                      style={{
                        width: `${Math.min(100, (c.centroid[i]! / Math.max(1, ...clustering.clusters.map((p) => p.centroid[i]!))) * 100)}%`,
                        background: c.color,
                      }}
                    />
                  </i>
                  <b>{formatValue(c.centroid[i]!, m)}</b>
                </div>
              ))}
              <button
                className="st-text-button"
                aria-pressed={activeCluster === c.id}
                onClick={() => {
                  setCluster(activeCluster === c.id ? null : c.id);
                  showOnMap();
                }}
              >
                {activeCluster === c.id
                  ? "Wis profielfilter"
                  : "Onderzoek dit profiel"}{" "}
                <ArrowUpRight size={12} />
              </button>
              <small>{number(c.members)} straatnamen in heel Amsterdam</small>
            </section>
          );
        })}
      </div>
      <div className="st-profile-quality">
        <strong>
          {clustering.clusters.length} profielen ·{" "}
          {number(clustering.assignments.size)} straten
        </strong>
        <p>
          {clustering.converged
            ? `Geconvergeerd na ${clustering.iterations} iteraties.`
            : "Iteratielimiet bereikt; interpreteer de profielen voorzichtig."}{" "}
          {clustering.explainedVariance === null
            ? "Onvoldoende variatie om profielen te onderscheiden."
            : `${number(clustering.explainedVariance * 100, 1)}% minder spreiding binnen clusters dan bij één gezamenlijk centrum (log/z-ruimte). Dit meet compactheid, geen juistheid of betrouwbaarheid.`}
        </p>
      </div>
      <div className="st-caution">
        Getraind op heel Amsterdam met straten van minimaal 100 m NWB;{" "}
        {clustering.excluded} straten uitgesloten. Eerst log(1+x), daarna
        standaardiseren (z-scores). Balken zijn per indicator relatief aan het
        hoogste clustercentrum; getallen hebben hun eigen eenheid. Kleuren zijn
        categorieën, geen rapportcijfers. Clustercentra zijn gemiddelden in
        logruimte, teruggetransformeerd; geen gewone straatgemiddelden. Filters
        veranderen de profielen niet. Het aantal clusters én de meldingsperiode
        trainen opnieuw. Bij een wijkfilter blijft het profiel gebaseerd op de
        hele straat in de stad.
      </div>
    </>
  );
}

/** Areas ranked by the chosen indicator, from pooled source counts. */
export function AreasPanel({
  areas,
  metric,
  months,
  choose,
  showOnMap,
}: {
  areas: ReturnType<typeof aggregate>;
  metric: Metric;
  months: number;
  choose: (ward: string) => void;
  showOnMap: () => void;
}) {
  return (
    <>
      <div className="st-card-heading">
        <span className="st-kicker">VAN STRAAT NAAR GEBIED</span>
        <h2>Welke gebieden vallen op?</h2>
        <p>
          {labels[metric]} per gebied, berekend uit opgetelde bronaantallen en
          hun noemers. De meest opvallende klasse staat bovenaan.
        </p>
      </div>
      <button className="an-button st-wide" onClick={() => showOnMap()}>
        <MapPinned size={14} />
        Toon wijkindicatoren op de kaart
      </button>
      <div className="st-area-ranking">
        {areas.map((a) => (
          <button key={a.id} onClick={() => choose(a.id)}>
            <span>
              <strong>{a.name}</strong>
              <b data-swatch style={dataSwatch(scoreColor(a[metric], metric))}>
                {formatValue(a[metric], metric)}
              </b>
            </span>
            <small>
              {units[metric]} · {number(a.length / 1000, 1)} km NWB · {a.count}{" "}
              wegvakken · {a.raw.lights} lichtobjecten · {a.raw.trees} bomen ·{" "}
              {windowTotal(a.raw.reports, months)} meldingen
            </small>
          </button>
        ))}
      </div>
      {!areas.length && (
        <p className="st-muted">
          Geen gebieden in deze selectie. Wis een filter om verder te kijken.
        </p>
      )}
      <div className="st-caution">
        Dit is een ranglijst van registraties, geen getoetste hotspot of
        kwaliteitsoordeel. De gemeentelijke bronnen zijn niet volledig voor alle
        objecten en meldingen. De 110 gebieden zijn de B&B-vergunningswijken;
        bronwegvakken zijn via een representatief punt toegewezen. Straatfilters
        werken door.
      </div>
    </>
  );
}
