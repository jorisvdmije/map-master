"use client";
import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
export const useBrowserDate = () =>
  useSyncExternalStore(
    subscribe,
    () => new Date().toISOString().slice(0, 10),
    () => "",
  );
/** Server snapshot is stable for static export; client evaluates age after hydration. */
export function SourceAge({
  retrievedAt,
  sourceYear,
  reviewDays = 90,
}: {
  retrievedAt: string;
  sourceYear?: number;
  reviewDays?: number;
}) {
  const today = useBrowserDate();
  const overdue =
    !!today &&
    Date.parse(today) - Date.parse(retrievedAt) > reviewDays * 86_400_000;
  return (
    <p className="hs-note" role={overdue ? "status" : undefined}>
      {sourceYear && <>Bronjaar {sourceYear} · </>}Snapshot opgehaald:{" "}
      {new Date(retrievedAt).toLocaleDateString("nl-NL", { timeZone: "UTC" })}.
      {overdue
        ? " Hercontrole van deze snapshot is nodig; dit zijn de laatst gepubliceerde cijfers in deze toepassing."
        : " Bronjaar en ophaaldatum verschillen; deze cijfers zijn geen actuele meting."}
    </p>
  );
}
