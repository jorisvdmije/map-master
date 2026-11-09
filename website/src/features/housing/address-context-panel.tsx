"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { download } from "@/features/playground/project";
import {
  addressSources,
  homeBnbContext,
  homeLeasehold,
} from "./address-context";
import { sourceMessage } from "./errors";
import type { Home } from "./model";

const retrieved = (date: string) =>
  new Date(date).toLocaleString("nl-NL", {
    dateStyle: "short",
    timeStyle: "short",
  });

export function AddressContext({ home }: { home: Home }) {
  const [open, setOpen] = useState(false);
  const key = [home.properties.id, ...home.geometry.coordinates];
  const leasehold = useQuery({
    queryKey: ["home-leasehold-context", ...key],
    queryFn: ({ signal }) => homeLeasehold(home, signal),
    enabled: open,
    staleTime: 15 * 60_000,
    retry: false,
  });
  const bnb = useQuery({
    queryKey: ["home-bnb-context", ...key],
    queryFn: ({ signal }) => homeBnbContext(home, signal),
    enabled: open,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return (
    <details
      className="hs-environment hs-address-context"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Erfpacht & vakantieverhuur</summary>
      {open && (
        <div>
          <h4>Erfpacht rond dit BAG-punt</h4>
          <div data-address-context="leasehold" aria-live="polite">
            {leasehold.isPending ? (
              <p>Erfpachtkaart ophalen…</p>
            ) : leasehold.error ? (
              <p className="hs-note" role="status">
                {sourceMessage(leasehold.error)}{" "}
                <button
                  className="an-button"
                  onClick={() => void leasehold.refetch()}
                >
                  Erfpacht opnieuw proberen
                </button>
              </p>
            ) : leasehold.data?.status === "missing" ? (
              <p>
                Geen kaartmatch. De eigendoms- of erfpachtstatus van deze woning
                blijft onbekend.
              </p>
            ) : (
              <>
                <dl className="hs-details">
                  {leasehold.data?.parcels.map((p) => (
                    <div key={p.id}>
                      <dt>Uitgever op perceelkaart</dt>
                      <dd>{p.issuer}</dd>
                    </div>
                  ))}
                </dl>
                <p>
                  Het BAG-punt ligt op{" "}
                  {leasehold.data?.parcels.length === 1
                    ? "een geregistreerd erfpachtperceel"
                    : "meerdere geregistreerde erfpachtpercelen"}
                  . Dit koppelt de locatie, niet het appartementsrecht.
                </p>
              </>
            )}
          </div>
          <p>
            Canon, afkoop en einddatum van het tijdvak zijn niet gekoppeld.{" "}
            <a
              href={addressSources.leaseholdLookup}
              target="_blank"
              rel="noreferrer"
            >
              Erfpachtgegevens van deze woning controleren
            </a>{" "}
            ·{" "}
            <a
              href={addressSources.leaseholdCalculator}
              target="_blank"
              rel="noreferrer"
            >
              Gemeentelijke adresrekentool
            </a>
          </p>
          {leasehold.data && (
            <p className="hs-note">
              Opgehaald {retrieved(leasehold.data.retrievedAt)} · bronpeildatum
              niet meegeleverd ·{" "}
              <a
                href={addressSources.leasehold}
                target="_blank"
                rel="noreferrer"
              >
                Erfpachtbron
              </a>
            </p>
          )}
          <h4>Toeristische verhuur</h4>
          <div data-address-context="bnb" aria-live="polite">
            {bnb.isPending ? (
              <p>B&B-wijkindicatie ophalen…</p>
            ) : bnb.error ? (
              <p className="hs-note" role="status">
                {sourceMessage(bnb.error)}{" "}
                <button
                  className="an-button"
                  onClick={() => void bnb.refetch()}
                >
                  B&B opnieuw proberen
                </button>
              </p>
            ) : bnb.data?.status === "missing" ? (
              <p>Geen wijkmatch. B&B-beschikbaarheid onbekend.</p>
            ) : (
              <>
                {bnb.data?.status === "boundary" && (
                  <p>
                    Het BAG-punt raakt meerdere wijken. Er is geen eenduidige
                    wijkindicatie.
                  </p>
                )}
                <dl className="hs-details">
                  {bnb.data?.wards.map((w) => (
                    <div key={w.id}>
                      <dt>B&B · {w.name}</dt>
                      <dd>{w.label}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </div>
          <p>
            B&B-beschikbaarheid geldt voor een vergunningswijk. Een
            vakantieverhuurvergunning op dit adres en het aantal verhuurde
            nachten zijn niet gekoppeld.{" "}
            <a
              href={addressSources.holidayRental}
              target="_blank"
              rel="noreferrer"
            >
              Officiële regels vakantieverhuur
            </a>{" "}
            ·{" "}
            <a href={addressSources.bnbMap} target="_blank" rel="noreferrer">
              Gemeentelijke B&B-kaart
            </a>
          </p>
          {bnb.data && (
            <p className="hs-note">
              Opgehaald {retrieved(bnb.data.retrievedAt)} · bronpeildatum niet
              meegeleverd ·{" "}
              <a href={addressSources.bnb} target="_blank" rel="noreferrer">
                B&B-bron
              </a>
            </p>
          )}
          <button
            className="an-button"
            disabled={
              leasehold.isFetching ||
              bnb.isFetching ||
              (!leasehold.data && !bnb.data)
            }
            onClick={() =>
              download(
                JSON.stringify({
                  bagId: home.properties.id,
                  coordinates: home.geometry.coordinates,
                  leasehold: leasehold.error
                    ? { status: "unavailable" }
                    : leasehold.data,
                  bnb: bnb.error ? { status: "unavailable" } : bnb.data,
                  scope:
                    "Ruimtelijke perceel- en wijkcontext. Geen bewijs van individueel erfpachtrecht, canon, afkoop, vakantieverhuurvergunning of verhuuractiviteit.",
                }),
                "woning-erfpacht-en-verhuurcontext.json",
                "application/json",
              )
            }
          >
            Exporteer erfpacht- en verhuurcontext
          </button>
        </div>
      )}
    </details>
  );
}
