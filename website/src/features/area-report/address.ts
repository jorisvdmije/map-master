import { searchAddressMatches } from "../data/address-search";
import type { ReportPoint } from "./model";
export type Address = ReportPoint & { id: string; kind: "address" };
/** Amsterdam addresses only: the report describes Amsterdam neighbourhoods. */
export async function searchAddresses(
  query: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<Address[]> {
  const matches = await searchAddressMatches(query, signal, {
    municipality: "0363",
    request,
    unavailable:
      "De adreszoeker is tijdelijk niet bereikbaar. Kies een buurt of probeer opnieuw.",
  });
  return matches.map((match) => ({ ...match, kind: "address" }));
}
