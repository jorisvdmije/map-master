export const themes = {
  wonen: "Wonen & gebouwen",
  mensen: "Bewoners & voorzieningen",
  groen: "Groen & openbare ruimte",
  mobiliteit: "Verkeer & bereikbaarheid",
  klimaat: "Klimaat & leefomgeving",
  energie: "Energie & verduurzaming",
  basis: "Kaarten & gebieden",
} as const;
export type Theme = keyof typeof themes;
export const availability = {
  local: "Bestand beschikbaar",
  connected: "In onze kaarten",
  source: "Bij de bron",
} as const;
export type Availability = keyof typeof availability;
export type RegistryEntry = {
  id: string;
  title: string;
  summary: string;
  theme: Theme;
  publisher: string;
  coverage: "amsterdam" | "netherlands";
  level: string;
  time: string;
  formats: string[];
  availability: Availability;
  source: { label: string; url: string };
  access: string;
  caveat: string;
  tags: string[];
  usedIn?: { label: string; href: string }[];
  localKey?: "housing" | "roads" | "observations" | "heat";
};
export type Download = {
  label: string;
  format: string;
  path: `/${string}`;
  bytes: number;
  sha256: string;
};
export type CatalogEntry = RegistryEntry & {
  downloads: Download[];
  snapshot?: {
    retrievedAt: string;
    count: number;
    unit: string;
    sha256: string;
  };
};
export type Catalog = {
  version: 1;
  checkedAt: string;
  datasets: CatalogEntry[];
};
