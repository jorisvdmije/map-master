import {
  labels,
  statusColors,
  units,
  legendLabels,
  type Metric,
} from "./model";
import type { MapMode } from "./runtime";
import type { Cluster } from "./model";

/** Legend for the street, ward and profile maps. */
export function StreetLegend({
  mapMode,
  metric,
  clusters,
  segments,
}: {
  mapMode: MapMode;
  metric: Metric;
  clusters: Cluster[];
  /** True while the segments of the selected street are shown. */
  segments: boolean;
}) {
  return (
    <div className="st-legend">
      <strong>
        {mapMode === "clusters" && !segments
          ? "Straatprofielen · geen kwaliteitsoordeel"
          : `${labels[metric]} · ${mapMode === "wards" ? `wijkindicator · ${units[metric]}` : segments ? "wegvakindicatoren geselecteerde straat" : `straatindicator · ${units[metric]}`}`}
      </strong>
      <div>
        {mapMode === "clusters" && !segments ? (
          <>
            {clusters.map((c) => (
              <span key={c.id}>
                <i style={{ background: c.color }} />
                Profiel {c.id + 1}
              </span>
            ))}
            <span>
              <i style={{ background: statusColors.missing }} />
              Geen profiel
            </span>
          </>
        ) : (
          Object.entries(legendLabels(metric)).map(([key, label]) => (
            <span key={key}>
              <i
                style={{
                  background: statusColors[key as keyof typeof statusColors],
                }}
              />
              {label}
            </span>
          ))
        )}
      </div>
      <small>
        {mapMode === "wards"
          ? "Opgetelde aantallen en noemers · klik een gebied"
          : segments
            ? "Losse wegvakken · overige straten gedimd"
            : "Vereenvoudigde lijnen · één kleur per straat · klik voor details"}
      </small>
    </div>
  );
}
