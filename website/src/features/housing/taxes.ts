import { rangeBound } from "./model";

/** Amsterdam ordinary residential property, full calendar year; amounts in cents. */
export const housingTaxSource = {
  year: 2026,
  checkedAt: "2026-11-04",
  url: "https://www.amsterdam.nl/belastingen/belastingtarieven-2026",
  ozbPerMillion: 527,
  sewerCents: 19204,
  wasteSingleCents: 35200,
  wasteMultipleCents: 46900,
} as const;

export type HousingTaxInput = {
  tenure: "owner" | "tenant";
  household: "single" | "multiple";
  woz: string;
};
export type HousingTaxEstimate = {
  ozbCents: number;
  sewerCents: number;
  wasteCents: number;
  totalCents: number;
  monthlyCents: number;
};

/** Dutch number notation, shared with filters; WOZ must remain positive whole euros. */
export function parseWozEuros(input: string): number | null {
  const value = rangeBound(input);
  return value !== null &&
    value > 0 &&
    Number.isSafeInteger(value) &&
    Number.isSafeInteger(value * housingTaxSource.ozbPerMillion)
    ? value
    : null;
}

export function housingTaxes(
  input: HousingTaxInput,
): HousingTaxEstimate | null {
  if (
    !["owner", "tenant"].includes(input.tenure) ||
    !["single", "multiple"].includes(input.household)
  )
    return null;
  const value = parseWozEuros(input.woz);
  if (input.tenure === "owner" && value === null) return null;
  const ozbCents =
    input.tenure === "owner"
      ? Math.round((value! * housingTaxSource.ozbPerMillion) / 10000)
      : 0;
  const sewerCents = input.tenure === "owner" ? housingTaxSource.sewerCents : 0;
  const wasteCents =
    input.household === "single"
      ? housingTaxSource.wasteSingleCents
      : housingTaxSource.wasteMultipleCents;
  const totalCents = ozbCents + sewerCents + wasteCents;
  return {
    ozbCents,
    sewerCents,
    wasteCents,
    totalCents,
    monthlyCents: Math.round(totalCents / 12),
  };
}
