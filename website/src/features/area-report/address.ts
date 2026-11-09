import { requestSignal } from "../data/source-contract";
import type { ReportPoint } from "./model";
export type Address = ReportPoint & { id: string; kind: "address" };
export async function searchAddresses(
  query: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<Address[]> {
  if (query.trim().length < 3 || query.length > 200)
    throw new Error("Vul minimaal drie en maximaal 200 tekens in.");
  const url = new URL("https://api.pdok.nl/bzk/locatieserver/search/v3_1/free");
  url.search = new URLSearchParams({
    q: query.trim(),
    fq: "type:adres AND gemeentecode:0363",
    rows: "6",
    fl: "id,type,weergavenaam,gemeentecode,centroide_ll",
  }).toString();
  const response = await request(url, { signal: requestSignal(signal, 15000) });
  if (!response.ok)
    throw new Error(
      "De adreszoeker is tijdelijk niet bereikbaar. Kies een buurt of probeer opnieuw.",
    );
  const data = await response.json(),
    rows: unknown = data.response?.docs;
  if (!Array.isArray(rows) || rows.length > 6)
    throw new Error("Onverwacht antwoord van de adreszoeker.");
  const seen = new Set<string>();
  return rows.map((row) => {
    const match =
      typeof row?.centroide_ll === "string"
        ? /^POINT\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/.exec(
            row.centroide_ll,
          )
        : null;
    if (
      row.type !== "adres" ||
      row.gemeentecode !== "0363" ||
      typeof row.id !== "string" ||
      !row.id ||
      seen.has(row.id) ||
      typeof row.weergavenaam !== "string" ||
      !row.weergavenaam ||
      row.weergavenaam.length > 300 ||
      !match
    )
      throw new Error(
        "De adreszoeker gaf een ongeldige Amsterdamse locatie terug.",
      );
    seen.add(row.id);
    const coordinates: [number, number] = [Number(match[1]), Number(match[2])];
    if (
      !coordinates.every(Number.isFinite) ||
      Math.abs(coordinates[0]) > 180 ||
      Math.abs(coordinates[1]) > 90
    )
      throw new Error("Ongeldige adrescoördinaten.");
    return {
      id: row.id,
      label: row.weergavenaam,
      coordinates,
      kind: "address",
    };
  });
}
