import { requestSignal } from "./source-contract";

/** An address found by the PDOK Locatieserver, in WGS84 longitude/latitude. */
export type AddressMatch = {
  id: string;
  label: string;
  coordinates: [number, number];
};

export const addressSearchEndpoint =
  "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free";
export const addressSearchSource = "https://www.pdok.nl/pdok-locatieserver";

const maximumRows = 6;
const point = /^POINT\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/;

/**
 * Searches Dutch addresses with the PDOK Locatieserver. Only called after an
 * explicit search: the query is the only thing sent. `municipality` (a CBS
 * code such as "0363") limits results to one municipality; every returned row
 * is validated before it can move a map or start a calculation.
 */
export async function searchAddressMatches(
  query: string,
  signal: AbortSignal,
  {
    municipality,
    request = fetch,
    unavailable = "De adreszoeker is tijdelijk niet bereikbaar. Probeer het later opnieuw.",
  }: {
    municipality?: string;
    request?: typeof fetch;
    /** Shown when the service fails; name the alternative the page offers. */
    unavailable?: string;
  } = {},
): Promise<AddressMatch[]> {
  const text = query.trim();
  if (text.length < 3 || query.length > 200)
    throw new Error("Vul minimaal drie en maximaal 200 tekens in.");
  const url = new URL(addressSearchEndpoint);
  url.search = new URLSearchParams({
    q: text,
    fq: municipality
      ? `type:adres AND gemeentecode:${municipality}`
      : "type:adres",
    rows: String(maximumRows),
    fl: "id,type,weergavenaam,gemeentecode,centroide_ll",
  }).toString();
  const response = await request(url, {
    signal: requestSignal(signal, 15000),
  });
  if (!response.ok) throw new Error(unavailable);
  const data = await response.json(),
    rows: unknown = data?.response?.docs;
  if (!Array.isArray(rows) || rows.length > maximumRows)
    throw new Error("Onverwacht antwoord van de adreszoeker.");
  const seen = new Set<string>();
  return rows.map((row) => {
    const match =
      typeof row?.centroide_ll === "string"
        ? point.exec(row.centroide_ll)
        : null;
    if (
      row.type !== "adres" ||
      (municipality && row.gemeentecode !== municipality) ||
      typeof row.id !== "string" ||
      !row.id ||
      seen.has(row.id) ||
      typeof row.weergavenaam !== "string" ||
      !row.weergavenaam ||
      row.weergavenaam.length > 300 ||
      !match
    )
      throw new Error("De adreszoeker gaf een ongeldige locatie terug.");
    seen.add(row.id);
    const coordinates: [number, number] = [Number(match[1]), Number(match[2])];
    if (
      !coordinates.every(Number.isFinite) ||
      Math.abs(coordinates[0]) > 180 ||
      Math.abs(coordinates[1]) > 90
    )
      throw new Error("Ongeldige adrescoördinaten.");
    return { id: row.id, label: row.weergavenaam, coordinates };
  });
}
