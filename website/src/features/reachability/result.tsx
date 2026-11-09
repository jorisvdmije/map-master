import { ArrowDownToLine } from "lucide-react";
import type { ReachabilityResult as Result } from "@jorisvdmije/map-master";
import { download } from "@/features/playground/project";
const number = (n: number, digits = 0) =>
  n.toLocaleString("nl-NL", { maximumFractionDigits: digits });
export function ReachabilityResult({
  result,
  rows,
  profileName,
}: {
  result: Result;
  rows: { minutes: number; area: number; count: number | null }[];
  profileName: string;
}) {
  return (
    <section className="ra-result" aria-label="Bereikbaarheidsresultaat">
      <span className="hs-eyebrow">BEREKEND RESULTAAT</span>
      <a className="ra-result-map-link" href="#reach-map">
        Bekijk contouren op de kaart ↓
      </a>
      <h3>
        {profileName} · {Math.max(...result.request.minutes)} minuten
      </h3>
      <p>
        {result.request.direction === "to"
          ? "Bereikbaar naar de bestemming"
          : "Bereikbaar vanaf het vertrekpunt"}{" "}
        {result.request.origin.map((n) => number(n, 5)).join(" / ")}
      </p>
      <table>
        <thead>
          <tr>
            <th>Bereik</th>
            <th>Oppervlak</th>
            <th>Objecten</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.minutes}>
              <td>{r.minutes} min</td>
              <td>{number(r.area, 2)} km²</td>
              <td>{r.count === null ? "—" : number(r.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hs-note">
        Cumulatief per reistijd; tel de rijen niet op. Elk geraakt object telt
        eenmaal, zonder oppervlakteweging. Objecten tellen pas na het laden van
        eigen GeoJSON.
      </p>
      <button
        className="an-button"
        onClick={() =>
          download(
            JSON.stringify({
              ...result.contours,
              provenance: {
                request: result.request,
                provider: result.provider,
                attribution: result.attribution,
                calculatedAt: result.calculatedAt,
                meaning:
                  "Gemodelleerde netwerkreistijd; geen gegarandeerde reistijd",
              },
            }),
            "bereikbaarheidscontouren.geojson",
            "application/geo+json",
          )
        }
      >
        <ArrowDownToLine size={14} />
        Contouren exporteren
      </button>
    </section>
  );
}
