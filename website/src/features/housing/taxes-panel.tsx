"use client";

import { useBrowserDate } from "@/components/workspaces/source-age";
import { useId, useState } from "react";
import {
  housingTaxes,
  housingTaxSource,
  parseWozEuros,
  type HousingTaxInput,
} from "./taxes";
import "./taxes.css";

const euros = (cents: number) =>
  (cents / 100).toLocaleString("nl-NL", { style: "currency", currency: "EUR" });

export function HousingTaxes() {
  const id = useId();
  const year = Number(useBrowserDate().slice(0, 4));
  const [tenure, setTenure] = useState<HousingTaxInput["tenure"]>("owner");
  const [household, setHousehold] =
    useState<HousingTaxInput["household"]>("single");
  const [woz, setWoz] = useState("");
  const estimate = housingTaxes({ tenure, household, woz });
  const invalid =
    tenure === "owner" && woz !== "" && parseWozEuros(woz) === null;
  return (
    <details className="hs-taxes">
      <summary>
        <span>Gemeentelijke belastingen</span>
        <small>Reken zelf · Amsterdam {housingTaxSource.year}</small>
      </summary>
      <div className="hs-tax-content">
        {year > housingTaxSource.year && (
          <p className="hs-note" role="status">
            Dit zijn historische tarieven uit {housingTaxSource.year}; actuele
            tarieven zijn nog niet gecontroleerd.
          </p>
        )}
        <p>
          Bereken OZB, rioolheffing en afvalstoffenheffing voor een gewone
          woning en een volledig jaar.
        </p>
        <div className="hs-tax-inputs">
          <label>
            Woonsituatie
            <select
              aria-label="Belastingen woonsituatie"
              value={tenure}
              onChange={(event) =>
                setTenure(event.target.value as HousingTaxInput["tenure"])
              }
            >
              <option value="owner">Eigenaar en bewoner</option>
              <option value="tenant">Huurder en bewoner</option>
            </select>
          </label>
          <label>
            Huishouden
            <select
              aria-label="Belastingen huishouden"
              value={household}
              onChange={(event) =>
                setHousehold(event.target.value as HousingTaxInput["household"])
              }
            >
              <option value="single">1 persoon</option>
              <option value="multiple">2 of meer personen</option>
            </select>
          </label>
          {tenure === "owner" && (
            <label>
              Eigen WOZ-beschikking {housingTaxSource.year} (€)
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                aria-label={`Eigen WOZ-waarde ${housingTaxSource.year}`}
                aria-invalid={invalid || undefined}
                aria-describedby={`${id}-woz-help`}
                value={woz}
                placeholder="Bijvoorbeeld 500.000"
                onChange={(event) => setWoz(event.target.value)}
              />
              <small id={`${id}-woz-help`}>
                {invalid
                  ? "Vul een positief bedrag in hele euro’s in, bijvoorbeeld 500.000 of 500.000,00."
                  : "Punten scheiden duizendtallen; de komma is het decimaalteken. Er is geen woningwaarde ingevuld."}
              </small>
            </label>
          )}
        </div>
        <div aria-live="polite" aria-atomic="true" data-tax-result>
          {estimate ? (
            <>
              <dl className="hs-details">
                <div>
                  <dt>
                    OZB{" "}
                    {tenure === "owner"
                      ? `(${(housingTaxSource.ozbPerMillion / 10000).toLocaleString("nl-NL")}% WOZ)`
                      : "woning"}
                  </dt>
                  <dd>{euros(estimate.ozbCents)}</dd>
                </div>
                <div>
                  <dt>Rioolheffing eigenaar</dt>
                  <dd>{euros(estimate.sewerCents)}</dd>
                </div>
                <div>
                  <dt>Afvalstoffenheffing</dt>
                  <dd>{euros(estimate.wasteCents)}</dd>
                </div>
              </dl>
              <div className="hs-tax-total">
                <span>
                  Subtotaal per jaar
                  <strong data-tax-annual>{euros(estimate.totalCents)}</strong>
                </span>
                <span>
                  Gemiddeld per maand
                  <strong>{euros(estimate.monthlyCents)}</strong>
                </span>
              </div>
            </>
          ) : (
            <p className="hs-note">
              Vul de WOZ-waarde uit je eigen beschikking in om het subtotaal te
              berekenen.
            </p>
          )}
        </div>
        <p className="hs-note">
          Indicatie bij maximaal 300 m³ watergebruik per jaar, zonder
          kwijtschelding. Waterschapsbelasting, erfpacht en overige woonlasten
          vallen buiten dit subtotaal. Je aanslag kan afwijken.
        </p>
        <p className="hs-note">
          <a href={housingTaxSource.url} target="_blank" rel="noreferrer">
            Officiële tarieven Amsterdam {housingTaxSource.year}
          </a>{" "}
          · gecontroleerd{" "}
          {new Date(
            `${housingTaxSource.checkedAt}T12:00:00Z`,
          ).toLocaleDateString("nl-NL")}
          .
        </p>
      </div>
    </details>
  );
}
