"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { download } from "@/features/playground/project";
import { homeEnergy, homeNoise, nearbyTrees } from "./environment";
import { number, type Home } from "./model";
import type { HousingRuntime } from "./runtime";

export function HomeEnvironment({
  home,
  runtime,
}: {
  home: Home;
  runtime: HousingRuntime | null;
}) {
  const [radius, setRadius] = useState(100);
  const trees = useQuery({
    queryKey: ["home-trees", home.properties.id, radius],
    queryFn: ({ signal }) => nearbyTrees(home, radius, signal),
    staleTime: 15 * 60_000,
    retry: false,
  });
  const noise = useQuery({
    queryKey: ["home-noise", home.properties.id],
    queryFn: ({ signal }) => homeNoise(home, signal),
    staleTime: 24 * 60 * 60_000,
    retry: false,
  });
  const energy = useQuery({
    queryKey: ["home-energy", home.properties.id],
    queryFn: ({ signal }) => homeEnergy(home, signal),
    staleTime: 15 * 60_000,
    retry: false,
  });
  useEffect(() => {
    runtime?.setTrees(trees.data?.data.features ?? []);
    return () => runtime?.setTrees([]);
  }, [runtime, trees.data]);
  const refresh = () => {
    void trees.refetch();
    void noise.refetch();
    void energy.refetch();
  };
  return (
    <section
      className="hs-environment"
      aria-label="Leefomgeving van deze woning"
    >
      <h3>Wonen & leefomgeving</h3>
      <label>
        Bomen rondom de woning
        <select
          aria-label="Straal bomen"
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
        >
          <option value={100}>100 meter</option>
          <option value={250}>250 meter</option>
        </select>
      </label>
      <dl className="hs-details">
        <div>
          <dt>Gemeentelijke bomen</dt>
          <dd data-environment="trees">
            {trees.isPending
              ? "Laden…"
              : trees.error && !trees.data
                ? "Niet beschikbaar"
                : number(trees.data?.data.features.length ?? null)}
          </dd>
        </div>
        <div>
          <dt>Gemodelleerd geluid</dt>
          <dd data-environment="noise">
            {noise.isPending
              ? "Laden…"
              : noise.error && !noise.data
                ? "Niet beschikbaar"
                : noise.data?.decibels == null
                  ? "Geen modelwaarde"
                  : `circa ${number(noise.data.decibels)} dB Lden`}
          </dd>
        </div>
        <div>
          <dt>Energielabel</dt>
          <dd data-environment="energy">
            {energy.isPending
              ? "Laden…"
              : energy.error && !energy.data
                ? "Niet beschikbaar"
                : energy.data?.status === "missing"
                  ? "Niet gevonden"
                  : (energy.data?.label ?? "Onbekend")}
            {energy.data?.status === "expired" && " · verlopen"}
            {energy.data?.status === "unknown" && " · geldigheid onbekend"}
          </dd>
        </div>
        {energy.data?.registered && (
          <div>
            <dt>Label geregistreerd</dt>
            <dd>{energy.data.registered}</dd>
          </div>
        )}
        {energy.data?.validUntil && (
          <div>
            <dt>Label geldig tot</dt>
            <dd>{energy.data.validUntil}</dd>
          </div>
        )}
      </dl>
      <p>
        Bomen zijn gemeentelijke registraties binnen een hemelsbrede straal;
        particuliere bomen en kroonoppervlak ontbreken. Groene punten op de
        kaart tonen de getelde bomen.
      </p>
      <p>
        Geluid: RIVM-kaart 2022 met samengestelde bronjaren 2022–2025. Dit is
        een globale rasterwaarde, geen gevelmeting of actuele hinder.
        Energielabel: gemeentelijke registratie, exact gekoppeld via BAG-ID;
        ontbrekend betekent niet onzuinig.
      </p>
      {(trees.error || noise.error || energy.error) && (
        <div className="hs-note" role="status">
          Verversen van een of meer bronnen is mislukt. Eerder opgehaalde
          waarden blijven zichtbaar met hun ophaaldatum; hun huidige status is
          onbekend.{" "}
          <button className="an-button" onClick={refresh}>
            Bronnen opnieuw proberen
          </button>
        </div>
      )}
      {!(trees.error || noise.error || energy.error) && (
        <button
          className="an-button"
          disabled={trees.isFetching || noise.isFetching || energy.isFetching}
          onClick={refresh}
        >
          Bronnen vernieuwen
        </button>
      )}
      <ul className="hs-note">
        {[
          { name: "Bomen", query: trees },
          { name: "Geluid", query: noise },
          { name: "Energie", query: energy },
        ].map(({ name, query }) => (
          <li key={name}>
            {name}:{" "}
            {query.data
              ? `laatst geslaagd op ${new Date(query.data.retrievedAt).toLocaleString("nl-NL")}`
              : "geen geslaagde opvraag"}
            {query.error ? " · verversen mislukt; huidige status onbekend" : ""}
          </li>
        ))}
      </ul>
      <Link
        className="an-button"
        href={`/analysis/reachability/?lng=${home.geometry.coordinates[0]}&lat=${home.geometry.coordinates[1]}`}
        prefetch={false}
      >
        Bereikbaarheid vanaf dit adres →
      </Link>
      <button
        className="an-button"
        disabled={trees.isPending || noise.isPending || energy.isPending}
        onClick={() =>
          download(
            JSON.stringify({
              type: "FeatureCollection",
              features: [
                {
                  ...home,
                  properties: {
                    ...home.properties,
                    municipalTrees: trees.data?.data.features.length ?? null,
                    treeRadiusMetres: radius,
                    noiseLden: noise.data?.decibels ?? null,
                    energyLabel: energy.data?.label ?? null,
                    energyLabelStatus: energy.data?.status ?? "unavailable",
                  },
                },
              ],
              provenance: {
                refreshStatus: {
                  trees: trees.error
                    ? trees.data
                      ? "stale-after-error"
                      : "unavailable"
                    : "success",
                  noise: noise.error
                    ? noise.data
                      ? "stale-after-error"
                      : "unavailable"
                    : "success",
                  energy: energy.error
                    ? energy.data
                      ? "stale-after-error"
                      : "unavailable"
                    : "success",
                },
                trees: trees.data
                  ? {
                      radius,
                      examined: trees.data.examined,
                      retrievedAt: trees.data.retrievedAt,
                      source: "Gemeente Amsterdam bomen/stamgegevens",
                    }
                  : { status: trees.error ? "unavailable" : "missing" },
                noise: noise.data ?? { status: "unavailable" },
                energy: energy.data
                  ? {
                      ...energy.data,
                      source: "Gemeente Amsterdam duurzaamheid/energielabel",
                    }
                  : { status: "unavailable" },
                scope:
                  "Omgevingsregistraties en modelwaarden; geen individuele woningwaardeschatting",
              },
            }),
            "woning-en-leefomgeving.geojson",
            "application/geo+json",
          )
        }
      >
        Exporteer woning met context
      </button>
      <p>
        <a
          href="https://api.data.amsterdam.nl/v1/docs/datasets/bomen.html"
          target="_blank"
          rel="noreferrer"
        >
          Bomenbron
        </a>{" "}
        ·{" "}
        <a
          href="https://www.atlasleefomgeving.nl/veelgestelde-vragen"
          target="_blank"
          rel="noreferrer"
        >
          RIVM-methode
        </a>{" "}
        ·{" "}
        <a
          href="https://api.data.amsterdam.nl/v1/docs/datasets/duurzaamheid.html"
          target="_blank"
          rel="noreferrer"
        >
          Energielabelbron
        </a>
      </p>
    </section>
  );
}
