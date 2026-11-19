import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type HeatView } from "./heat";
import { number } from "./format";

export function HeatTable({
  view,
  selected,
  select,
}: {
  view: HeatView;
  selected: string | null;
  select: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [paging, setPaging] = useState({ view, page: 0 });
  const ranked = useMemo(
    () =>
      open
        ? [...view.data.features].sort(
            (a, b) =>
              b.properties.count - a.properties.count ||
              a.properties.id.localeCompare(b.properties.id),
          )
        : [],
    [view, open],
  );
  const current =
    paging.view === view
      ? Math.min(paging.page, Math.max(0, Math.ceil(ranked.length / 20) - 1))
      : 0;
  return (
    <details
      className="st-heat-table"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        {view.hexWidth ? "Hexagonen als tabel" : "Bronvakken als tabel"}{" "}
        <span>
          {number(view.cells)} vakken · {number(view.total)} registraties
        </span>
      </summary>
      {open && (
        <>
          <p>
            Dezelfde gewogen vakken als op de kaart, met de hoogste aantallen
            eerst. Selecteren markeert een vak en verandert de kaartpositie
            niet.
          </p>
          <div className="st-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>
                    {view.hexWidth
                      ? `Hexagon · ${view.hexWidth} m`
                      : "Bronvak · 25 m"}
                  </th>
                  <th>Aantal</th>
                  <th>Gekoppelde straatnamen</th>
                </tr>
              </thead>
              <tbody>
                {ranked.slice(current * 20, (current + 1) * 20).map((f) => (
                  <tr
                    key={f.properties.id}
                    className={
                      selected === f.properties.id ? "st-row-selected" : ""
                    }
                  >
                    <td>
                      <button
                        aria-pressed={selected === f.properties.id}
                        onClick={() => select(f.properties.id)}
                      >
                        {f.properties.id}
                      </button>
                    </td>
                    <td>{number(f.properties.count)}</td>
                    <td>{f.properties.names.join(" / ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="st-table-pagination">
            <span>
              {ranked.length
                ? `${current * 20 + 1}–${Math.min((current + 1) * 20, ranked.length)}`
                : 0}{" "}
              van {number(ranked.length)}
            </span>
            <div>
              <button
                aria-label="Vorige bronvakken"
                disabled={!current}
                onClick={() => setPaging({ view, page: current - 1 })}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                aria-label="Volgende bronvakken"
                disabled={(current + 1) * 20 >= ranked.length}
                onClick={() => setPaging({ view, page: current + 1 })}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </>
      )}
    </details>
  );
}
