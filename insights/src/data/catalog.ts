import type { Variable } from "./model";

export const STATISTICS_ORIGIN = "https://api.data.amsterdam.nl";
export const STATISTICS_ROOT = `${STATISTICS_ORIGIN}/v1/statistieken/v2/`;
export const CATALOG_GEOMETRY_VINTAGE = "2022-03-24";
export const CATALOG_SOURCE_URL =
  "https://onderzoek.amsterdam.nl/dataset/basisbestand-gebieden-amsterdam-bbga";

export type SourceIndicator = {
  variableId: string;
  id: number;
  code: string;
  /** Exact source metadata unit; null denotes an unlabelled count. */
  unit: string | null;
  period: "Peildatum";
  metadataReference: string;
};
export type SourceDefinition = {
  id: string;
  title: string;
  description: string;
  theme: string;
  publisher: string;
  upstreamSources: string[];
  sourceUrl: string;
  variables: Variable[];
  years: number[];
  kind: "api" | "snapshot";
  snapshotPath: string;
  geometryVintage: string;
  indicators: SourceIndicator[];
  notes: string;
};

const range = (start: number, end: number) =>
  Array.from({ length: end - start + 1 }, (_, i) => start + i);
const variable = (
  id: string,
  indicator: number,
  label: string,
  unit: string,
  description: string,
): Variable => ({
  id,
  label,
  unit,
  description,
  kind: "number",
  available: true,
  source: `${STATISTICS_ROOT}indicatoren/${indicator}/`,
});
const indicator = (
  variableId: string,
  id: number,
  code: string,
  unit: string | null,
  metadataReference = "1 januari",
): SourceIndicator => ({
  variableId,
  id,
  code,
  unit,
  period: "Peildatum",
  metadataReference,
});
const common = {
  publisher: "Onderzoek en Statistiek Amsterdam",
  sourceUrl: CATALOG_SOURCE_URL,
  kind: "api" as const,
  geometryVintage: CATALOG_GEOMETRY_VINTAGE,
};

/** Lightweight metadata only. No additional observations are imported at application startup. */
export const sourceCatalog: SourceDefinition[] = [
  {
    ...common,
    id: "population",
    title: "Bevolking & leeftijd",
    theme: "Bevolking",
    description: "Inwoners, kinderen en 65-plussers per buurt door de tijd.",
    upstreamSources: ["BRP", "O&S"],
    years: range(2012, 2026),
    snapshotPath: "data/catalog/population.json",
    variables: [
      variable(
        "population_total",
        2267,
        "Inwoners",
        "personen",
        "Personen ingeschreven in het Amsterdamse bevolkingsregister op 1 januari, inclusief briefadreshoudenden. Geen schatting van het aantal feitelijk aanwezige mensen.",
      ),
      variable(
        "population_children_pct",
        2075,
        "Inwoners 0–17 jaar",
        "%",
        "Aandeel ingeschreven inwoners van 0 tot en met 17 jaar, op 1 januari.",
      ),
      variable(
        "population_seniors_pct",
        2167,
        "Inwoners 65+",
        "%",
        "Aandeel ingeschreven inwoners van 65 jaar en ouder, op 1 januari.",
      ),
    ],
    indicators: [
      indicator("population_total", 2267, "BEVTOTAAL", null),
      indicator("population_children_pct", 2075, "BEV0_17_P", "%"),
      indicator("population_seniors_pct", 2167, "BEV65PLUS_P", "%"),
    ],
    notes:
      "BRP via O&S. Bekende grensbreuken blijven van toepassing; geen ontbrekende historie aangevuld.",
  },
  {
    ...common,
    id: "households",
    title: "Huishoudens",
    theme: "Samenleving",
    description:
      "Alleenwonenden en huishoudens met kinderen naast woning- en buurtontwikkeling.",
    upstreamSources: ["BRP", "O&S"],
    years: range(2012, 2026),
    snapshotPath: "data/catalog/households.json",
    variables: [
      variable(
        "households_single_pct",
        2201,
        "Eenpersoonshuishoudens",
        "%",
        "Aandeel huishoudens dat uit één persoon bestaat. De bron rekent ook kamerbewoners tot deze categorie; het is geen percentage inwoners.",
      ),
      variable(
        "households_children_pct",
        2216,
        "Huishoudens met kinderen",
        "%",
        "Aandeel huishoudens met ongehuwde thuiswonende kinderen, op 1 januari.",
      ),
    ],
    indicators: [
      indicator("households_single_pct", 2201, "BEVALLEENHH_P", "%"),
      indicator("households_children_pct", 2216, "BEVHHMKIND_P", "%"),
    ],
    notes:
      "BRP via O&S. Percentages hebben huishoudens als noemer, geen woningen of personen.",
  },
  {
    ...common,
    id: "income",
    title: "Inkomen",
    theme: "Werk & inkomen",
    description:
      "Besteedbaar huishoudinkomen en huishoudens in het laagste landelijke inkomensquintiel.",
    upstreamSources: [
      "CBS",
      "Integrale Inkomens- en Vermogensstatistiek (IIV)",
      "bewerking O&S",
    ],
    years: range(2012, 2024),
    snapshotPath: "data/catalog/income.json",
    variables: [
      variable(
        "income_mean",
        2634,
        "Besteedbaar huishoudinkomen",
        "€",
        "Gemiddeld besteedbaar huishoudinkomen, na belastingen en premies. Studentenhuishoudens en bewoners van instituten zijn uitgesloten. Nominale euro, niet voor inflatie gecorrigeerd; bronjaren 2012–2024.",
      ),
      variable(
        "income_low_quintile_pct",
        2635,
        "Laagste inkomensquintiel",
        "%",
        "Aandeel huishoudens in de laagste 20%-groep van de landelijke verdeling van besteedbaar huishoudinkomen. Geen armoedegrens en geen laagste 20% binnen Amsterdam.",
      ),
    ],
    indicators: [
      indicator("income_mean", 2634, "IHHINK_GEM", "euro", "jaarcijfer"),
      indicator("income_low_quintile_pct", 2635, "IINKQ1_P", "%", "jaarcijfer"),
    ],
    notes:
      "CBS IIV, bewerkt en gepubliceerd door O&S. De indicator noemt jaarcijfer; de API-waarnemingen zijn gelabeld als Peildatum 1 januari van het bronjaar. We bewaren het opgegeven bronjaar en leiden daar geen ander inkomensjaar uit af. 2025 en 2026 zijn niet beschikbaar.",
  },
  {
    ...common,
    id: "ownership",
    title: "Koop & corporatiebezit",
    theme: "Wonen",
    description: "Hoe verandert de eigendomsverhouding van de woningvoorraad?",
    upstreamSources: [
      "AFWC",
      "BAG",
      "BRK",
      "BRP",
      "Handelsregister",
      "WOZ",
      "O&S",
    ],
    years: range(2012, 2026),
    snapshotPath: "data/catalog/ownership.json",
    variables: [
      variable(
        "ownership_owner_pct",
        2989,
        "Koopwoningen",
        "%",
        "Aandeel BAG-woonadressen met eigendomsverhouding eigenaar-bewoner op 1 januari. Geen aandeel verkochte woningen.",
      ),
      variable(
        "ownership_corporation_pct",
        2970,
        "Corporatiewoningen",
        "%",
        "Aandeel woningvoorraad in bezit van een woningcorporatie. Dit is een eigendomscategorie, geen bewezen sociale huurprijs.",
      ),
    ],
    indicators: [
      indicator("ownership_owner_pct", 2989, "WKOOP_P", "%"),
      indicator("ownership_corporation_pct", 2970, "WCORHUUR_P", "%"),
    ],
    notes:
      "Meerdere registraties gecombineerd door O&S. Corporatiebezit en eigenaar-bewoner tellen niet samen noodzakelijk op tot 100%; overige eigendomscategorieën bestaan ook.",
  },
  {
    ...common,
    id: "energy",
    title: "Energielabels",
    theme: "Duurzaamheid",
    description:
      "Vergelijk buurten op geregistreerde gunstige en ongunstige energielabels.",
    upstreamSources: ["RVO", "BAG", "O&S"],
    years: [2018, 2019, 2021, 2022, 2023, 2024, 2025, 2026],
    snapshotPath: "data/catalog/energy.json",
    variables: [
      variable(
        "energy_good_pct",
        2990,
        "Energielabel A++++ t/m B",
        "%",
        "Aandeel woningen met geregistreerd energielabel A++++ tot en met B. Geen gemeten energieverbruik. Onbekende labels vormen een aparte categorie; 2020 ontbreekt in de bron.",
      ),
      variable(
        "energy_poor_pct",
        2992,
        "Energielabel E t/m G",
        "%",
        "Aandeel woningen met geregistreerd energielabel E, F of G. Geen schatting van labels die niet geregistreerd zijn. 2020 ontbreekt in de bron.",
      ),
    ],
    indicators: [
      indicator("energy_good_pct", 2990, "WLABELAB_P", "%", "jaarcijfer"),
      indicator("energy_poor_pct", 2992, "WLABELEFG_P", "%", "jaarcijfer"),
    ],
    notes:
      "RVO en BAG via O&S. De metadata noemt jaarcijfer, de feitelijke API-waarnemingen heten Peildatum 1 januari. De registratiegraad en labelmethodiek kunnen veranderen. 2020 wordt niet geïnterpoleerd.",
  },
  {
    ...common,
    id: "environment",
    title: "Groen in de buurt",
    theme: "Leefomgeving",
    description:
      "Het aandeel publiek groen als ruimtelijke context voor ontwikkeling.",
    upstreamSources: [
      "BGT",
      "Hoofdgroenstructuur",
      "Natuurnetwerk Nederland (NNN)",
      "Top10NL",
    ],
    years: range(2019, 2025),
    snapshotPath: "data/catalog/environment.json",
    variables: [
      variable(
        "environment_green_pct",
        2771,
        "Publiek groen",
        "%",
        "Levend groen in de publieke ruimte, exclusief agrarisch groen, als percentage van het landoppervlak. Geen aandeel particuliere tuinen en geen boomkroonbedekking.",
      ),
    ],
    indicators: [
      indicator("environment_green_pct", 2771, "ORPUBGROEN_P", "%", ""),
    ],
    notes:
      "O&S combineert ruimtelijke basisregistraties. API-waarnemingen zijn gelabeld Peildatum 1 januari; de indicatormetadata specificeert geen nadere meetdatum. Geen 2026-waarneming beschikbaar.",
  },
];

export function getSource(id: string): SourceDefinition | undefined {
  return sourceCatalog.find((source) => source.id === id);
}
