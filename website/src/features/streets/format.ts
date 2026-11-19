/** Dutch number for the street workspace; null shows a dash. */
export const number = (v: number | null, digits = 0) =>
  v === null
    ? "—"
    : v.toLocaleString("nl-NL", { maximumFractionDigits: digits });
