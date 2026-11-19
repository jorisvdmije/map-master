import type { Dispatch, SetStateAction } from "react";
import { ArrowUpRight, Focus, X } from "lucide-react";
import {
  hexGradient,
  heatLabels,
  heatKinds,
  heatGradient,
  defaultHeat,
  type HeatSettings,
  type HeatView,
} from "./heat";
import { observationMeta } from "./model";
import type { StreetRuntime } from "./runtime";
import { number } from "./format";

export function HeatControls({
  heat,
  setHeat,
  clearSelection,
  expanded,
  setExpanded,
  months,
  runtime,
}: {
  heat: HeatSettings;
  setHeat: Dispatch<SetStateAction<HeatSettings>>;
  /** Changing what the map shows drops the selected cell. */
  clearSelection: () => void;
  expanded: boolean;
  setExpanded: Dispatch<SetStateAction<boolean>>;
  months: number;
  runtime: StreetRuntime | null;
}) {
  return (
    <div
      className="st-heat-controls"
      aria-label="Instellingen concentratiekaart"
    >
      <fieldset className="st-heat-shapes">
        <legend>Weergave concentraties</legend>
        <div className="st-heat-radii">
          {(["smooth", "hex"] as const).map((shape) => (
            <button
              key={shape}
              aria-pressed={heat.shape === shape}
              onClick={() => {
                setHeat((h) => ({ ...h, shape }));
                clearSelection();
              }}
            >
              {shape === "smooth" ? "Vloeiend" : "Hexagonen"}
            </button>
          ))}
        </div>
        <span>
          {heat.shape === "hex"
            ? "Registraties opgeteld per vast zeshoekig vak"
            : "Vloeiende spreiding van bronregistraties"}
        </span>
      </fieldset>
      <div className="st-heat-control-grid">
        <label>
          Onderwerp
          <select
            aria-label="Onderwerp concentraties"
            value={heat.kind}
            onChange={(e) => {
              setHeat((h) => ({
                ...h,
                kind: e.target.value as HeatSettings["kind"],
              }));
              clearSelection();
            }}
          >
            {heatKinds.map((kind) => (
              <option key={kind} value={kind}>
                {heatLabels[kind]}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>
            {heat.shape === "hex"
              ? "Vakbreedte · vlak tot vlak"
              : "Vervaging · radius"}
          </legend>
          <div className="st-heat-radii">
            {[100, 250, 500].map((radius) => (
              <button
                key={radius}
                aria-pressed={heat.radius === radius}
                onClick={() => setHeat((h) => ({ ...h, radius }))}
              >
                {radius} m
              </button>
            ))}
          </div>
        </fieldset>
        <label className="st-heat-contrast">
          Contrast{" "}
          <output>
            {heat.contrast.toLocaleString("nl-NL", {
              maximumFractionDigits: 1,
            })}
            ×
          </output>
          <input
            aria-label="Contrast concentraties"
            type="range"
            min="0.5"
            max="1.8"
            step="0.1"
            value={heat.contrast}
            onChange={(e) =>
              setHeat((h) => ({ ...h, contrast: +e.target.value }))
            }
          />
        </label>
        <button
          className="st-text-button st-heat-expand"
          aria-pressed={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <Focus size={14} />
          {expanded ? "Compacte kaart" : "Grotere kaart"}
        </button>
      </div>
      <p>
        {["reports", "nuisance", "maintenance"].includes(heat.kind)
          ? `${observationMeta.months[12 - months]} t/m ${observationMeta.months.at(-1)} · periode aanpassen bij filters`
          : `Bronstand ${observationMeta.retrieved} · periodefilter geldt alleen voor meldingen`}
        <span className="st-heat-view-buttons">
          <button onClick={() => runtime?.heatCity()}>Stadsdetail</button>
          <button onClick={() => runtime?.fitHeat()}>Hele selectie</button>
          <button
            onClick={() => {
              setHeat(defaultHeat);
              clearSelection();
            }}
          >
            Herstel weergave
          </button>
        </span>
      </p>
    </div>
  );
}

/** Legend for the concentration map: fixed hexagons or smoothed density. */
export function HeatLegend({
  heat,
  scale,
}: {
  heat: HeatSettings;
  scale: number;
}) {
  return heat.shape === "hex" ? (
    <div className="st-heat-legend st-hex-legend">
      <span className="st-heat-eyebrow">HEXAGONEN · {heat.radius} M BREED</span>
      <strong>{heatLabels[heat.kind]}</strong>
      <div
        className="st-heat-gradient"
        style={{ background: hexGradient(heat.kind) }}
      />
      <div className="st-heat-legend-ends">
        <span>1</span>
        <span>≥{number(Math.max(1, Math.ceil(scale / heat.contrast)))}</span>
      </div>
      <p>
        Registraties per hexagon.
        <br />
        Vaste vakken · geen vervaging.
      </p>
    </div>
  ) : (
    <div className="st-heat-legend">
      <span className="st-heat-eyebrow">CONCENTRATIE · {heat.radius} M</span>
      <span className="st-heat-detail-eyebrow">BRONVAKKEN · 25 × 25 M</span>
      <strong>{heatLabels[heat.kind]}</strong>
      <div className="st-heat-density-legend">
        <div
          className="st-heat-gradient"
          style={{ background: heatGradient(heat.kind) }}
        />
        <div className="st-heat-legend-ends">
          <span>Weinig</span>
          <span>Veel</span>
        </div>
        <p>
          Aantallen, geen risico of percentage.
          <br />
          Zoom in voor bronvakken van 25 m.
        </p>
      </div>
      <div className="st-heat-detail-legend">
        <div
          className="st-heat-dot-key"
          style={{
            color: heat.kind === "trees" ? "#13434f" : "#742339",
          }}
        >
          <i />
          <i />
          <i />
        </div>
        <div className="st-heat-legend-ends">
          <span>Minder</span>
          <span>Meer</span>
        </div>
        <p>
          Puntgrootte toont aantallen per vak.
          <br />
          Klik op een punt of kies in de tabel.
        </p>
      </div>
    </div>
  );
}

/** The selected source cell or hexagon, with the streets it belongs to. */
export function SelectedHeatCell({
  cell,
  heat,
  close,
  selectStreet,
}: {
  cell: HeatView["data"]["features"][number];
  heat: HeatSettings;
  close: () => void;
  selectStreet: (name: string) => void;
}) {
  return (
    <div
      className="st-heat-cell"
      role="region"
      aria-label="Geselecteerd bronvak"
      aria-live="polite"
    >
      <button className="an-icon" aria-label="Sluit bronvak" onClick={close}>
        <X size={14} />
      </button>
      <span>
        {heat.shape === "hex"
          ? `HEXAGON · ${heat.radius} M BREED`
          : "BRONVAK · 25 × 25 M"}
      </span>
      <strong>
        {number(cell.properties.count)}{" "}
        {heatLabels[heat.kind].toLocaleLowerCase("nl")}
      </strong>
      <p>Gekoppeld aan:</p>
      <div>
        {cell.properties.names.slice(0, 3).map((name) => (
          <button key={name} onClick={() => selectStreet(name)}>
            {name} <ArrowUpRight size={11} />
          </button>
        ))}
      </div>
      {cell.properties.names.length > 3 && (
        <small>+{cell.properties.names.length - 3} andere straatnamen</small>
      )}
    </div>
  );
}
