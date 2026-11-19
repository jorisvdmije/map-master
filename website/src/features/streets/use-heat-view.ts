import { useEffect, useMemo, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { requestSignal } from "@/features/data/source-contract";
import { assetPath } from "@/lib/paths";
import {
  buildHeat,
  heatReference,
  hexagons,
  hexReference,
  validateHeat,
  type HeatData,
  type HeatSettings,
} from "./heat";
import { observationMeta } from "./model";

/**
 * Loads the concentration source cells on first use and derives the view for
 * the current streets, subject and shape. The file is fetched only while the
 * concentration map is active; a failure stays visible until `retry`.
 */
export function useHeatView({
  active,
  roads,
  heat,
  months,
  selectedId,
  client,
}: {
  active: boolean;
  /** Road segments in the current street selection. */
  roads: Parameters<typeof buildHeat>[1];
  heat: HeatSettings;
  months: number;
  selectedId: string | null;
  client: QueryClient;
}) {
  const [data, setData] = useState<HeatData | null>(null),
    [failure, setFailure] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active || data) return;
    const request = new AbortController();
    void client
      .fetchQuery({
        queryKey: ["street-heat", observationMeta.heatSha256],
        staleTime: Infinity,
        gcTime: 30 * 60_000,
        retry: false,
        queryFn: async ({ signal }) => {
          const response = await fetch(
            assetPath(
              `/data/amsterdam-street-heat.${observationMeta.heatSha256.slice(0, 16)}.json`,
            ),
            { signal: requestSignal(signal, 60_000) },
          );
          if (!response.ok)
            throw new Error(
              `Concentratiebestand niet beschikbaar (${response.status})`,
            );
          return validateHeat((await response.json()) as HeatData);
        },
      })
      .then((next) => {
        if (!request.signal.aborted) setData(next);
      })
      .catch((error) => {
        if (!request.signal.aborted)
          setFailure(
            error instanceof Error
              ? error.message
              : "Concentraties laden mislukt",
          );
      });
    return () => request.abort();
  }, [active, data, attempt, client]);
  const points = useMemo(
    () => (data && active ? buildHeat(data, roads, heat.kind, months) : null),
    [data, active, roads, heat.kind, months],
  );
  const view = useMemo(
    () =>
      points && heat.shape === "hex" ? hexagons(points, heat.radius) : points,
    [points, heat.shape, heat.radius],
  );
  const scale = useMemo(
    () =>
      data
        ? (heat.shape === "hex" ? hexReference : heatReference)(
            data,
            heat.kind,
            heat.radius,
          )
        : 1,
    [data, heat.kind, heat.radius, heat.shape],
  );
  const selectedCell = useMemo(
    () => view?.data.features.find((f) => f.properties.id === selectedId),
    [view, selectedId],
  );
  return {
    view,
    scale,
    selectedCell,
    failure,
    clearFailure: () => setFailure(""),
    retry: () => {
      setFailure("");
      setAttempt((value) => value + 1);
    },
  };
}
