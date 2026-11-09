"use client";
import { useState } from "react";
import {
  metrics,
  labels,
  format,
  type Neighborhood,
  type Snapshot,
} from "./model";

export function NeighborhoodComparison({
  all,
  selected,
  indicators,
}: {
  all: Neighborhood[];
  selected: string;
  indicators?: Snapshot["meta"]["indicators"];
}) {
  const [codes, setCodes] = useState<string[]>([]);
  const rows = codes.flatMap((code) =>
    all.filter((row) => row.properties.code === code),
  );
  return (
    <section
      className="hs-compare"
      aria-label="Vastgezette buurten vergelijken"
    >
      <h2>Buurten naast elkaar</h2>
      <p>
        Zet maximaal drie buurten vast. Elke kolom gebruikt dezelfde definities
        en bronjaren; ontbrekende cijfers blijven onbekend.
      </p>
      <button
        className="an-button"
        disabled={!selected || codes.includes(selected) || codes.length >= 3}
        onClick={() => setCodes((previous) => [...previous, selected])}
      >
        Geselecteerde buurt vastzetten
      </button>
      {rows.length > 0 && (
        <div className="hs-table">
          <table>
            <caption>
              Vergelijking van {rows.length} buurten · ongewogen buurtcijfers
            </caption>
            <thead>
              <tr>
                <th scope="col">Kenmerk en CBS-jaar</th>
                {rows.map((row) => (
                  <th scope="col" key={row.properties.code}>
                    {row.properties.name}
                    <button
                      className="an-button"
                      aria-label={`${row.properties.name} uit vergelijking verwijderen`}
                      onClick={() =>
                        setCodes(
                          codes.filter((code) => code !== row.properties.code),
                        )
                      }
                    >
                      Verwijderen
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => (
                <tr key={metric}>
                  <th scope="row">
                    {labels[metric]} ·{" "}
                    {indicators?.[metric]?.year ?? "bronjaar onbekend"}
                    <small>{indicators?.[metric]?.description}</small>
                  </th>
                  {rows.map((row) => (
                    <td key={row.properties.code}>
                      {format(row.properties[metric], metric)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
