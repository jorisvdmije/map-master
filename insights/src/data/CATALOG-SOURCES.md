# On-demand source library

The catalog contains **six genuinely fetched datasets with twelve additional
variables**, not preview fixtures. All six are published by **Onderzoek en
Statistiek Amsterdam** through the Statistiekhub v2. Their original registers and
statistical producers differ; the application does not present them as six
independent publishers.

| Catalog source | Original sources | Variables | Available source years |
| --- | --- | --- | --- |
| Bevolking & leeftijd | BRP, O&S | Inhabitants; ages 0–17 (%); ages 65+ (%) | 2012–2026 |
| Huishoudens | BRP, O&S | One-person households (%); households with children (%) | 2012–2026 |
| Inkomen | CBS, IIV, processing by O&S | Average disposable household income (€); lowest national income quintile (%) | 2012–2024 |
| Koop & corporatiebezit | AFWC, BAG, BRK, BRP, Handelsregister, WOZ, O&S | Owner-occupied homes (%); corporation-owned homes (%) | 2012–2026 |
| Energielabels | RVO, BAG, O&S | Labels A++++–B (%); labels E–G (%) | 2018, 2019, 2021–2026 |
| Groen in de buurt | BGT, Hoofdgroenstructuur, NNN, Top10NL | Public green area as share of land (%) | 2019–2025 |

Every snapshot includes all **518 neighborhood codes**, matched to the original
app's **24 March 2022** geometry vintage. A neighborhood with no published values
is retained with null cells. No observation is joined from a ward, district,
municipal average or different CBS geometry. Known boundary breaks already on
the base dataset remain in place after a source is added.

## Official references

- [Statistiekhub v2 API documentation](https://api.data.amsterdam.nl/v1/docs/datasets/statistieken@v2.html).
- [O&S BBGA dataset, geographic comparability and privacy rounding](https://onderzoek.amsterdam.nl/dataset/basisbestand-gebieden-amsterdam-bbga).
- [Population metadata](https://api.data.amsterdam.nl/v1/statistieken/v2/indicatoren/?naam=BEVTOTAAL).
- [Household metadata](https://api.data.amsterdam.nl/v1/statistieken/v2/indicatoren/?naam=BEVALLEENHH_P).
- [Income metadata](https://api.data.amsterdam.nl/v1/statistieken/v2/indicatoren/?naam=IHHINK_GEM).
- [Ownership metadata](https://api.data.amsterdam.nl/v1/statistieken/v2/indicatoren/?naam=WKOOP_P).
- [Energy metadata](https://api.data.amsterdam.nl/v1/statistieken/v2/indicatoren/?naam=WLABELAB_P).
- [Green-area metadata](https://api.data.amsterdam.nl/v1/statistieken/v2/indicatoren/?naam=ORPUBGROEN_P).

Each normalized bundle additionally retains the complete indicator definitions,
original source names, every raw request URL, raw-page SHA-256 fingerprints and a
separate fingerprint of the normalized neighborhood/year values.

## Loading and refresh

`catalog.ts` contains lightweight source metadata only. The observations in
`public/data/catalog/*.json` are separate static assets; importing the catalog
does not download them. `loadSource` is called only by an explicit add/refresh
action or a persisted-source cache restore managed by the application.

The default load mode tries the official live API, validates both the definitions
and observations, and has an overall 15-second deadline. Caller cancellation
propagates without a fallback request. If live access is unavailable, the loader
downloads the matching bundled snapshot and returns `loadedFrom: "snapshot"`,
the **snapshot's original retrieval date**, and an explicit `fallbackReason`.
It does not claim the snapshot was freshly retrieved from the API.

`mode: "snapshot"` skips live access entirely. Only the requested source file is
fetched; offline availability after the first load depends on the application's
local source cache and normal static asset availability. No automatic background
refresh is performed by the data layer.

The API currently exposes public statistical data, but its documentation announces
future API-key requirements. The fallback remains useful if that requirement,
CORS restrictions or transient network errors block direct browser requests.
No API key or private credential is embedded in the application.

To refresh the bundled source snapshots from the app directory:

```sh
node scripts/fetch-catalog.mjs
# Or one group:
node scripts/fetch-catalog.mjs population
```

Use the project's supported Node runtime and installed dependencies. This script
loads the TypeScript source loader through the installed `tsx` API, fetches one
source group at a time and atomically replaces each snapshot only after all its
validation passes. It uses the app's committed base geometry codes; no live
geometry replacement is performed.

## Temporal and statistical meaning

The API records for all selected indicators explicitly use `tijdType: Peildatum`
and start/end date `YYYY-01-01`. The population, household and ownership metadata
also say 1 January. The income and energy metadata instead say `jaarcijfer`;
the green-area metadata leaves its reference-date explanation empty. Both the
metadata wording and actual record reference are preserved in each bundle.
The app retains the supplied source year and **does not infer a shifted income
year or claim a more precise measurement date**.

Income is nominal, not inflation-adjusted, and excludes student households and
institutional residents according to the source definition. Its first quintile
is based on the national household-income distribution, not the poorest fifth
within Amsterdam. The unavailable 2025 and 2026 observations stay null.

The energy series has no 2020 source records. That year stays unknown. Registered
labels are not measured consumption, and unknown/unregistered labels form a
separate category. Changes can include registration and methodology changes.

Public green excludes agricultural green and is expressed as a share of land,
not all area including water. It is not tree canopy coverage or private gardens.

Negative suppression sentinels become null, published zero stays zero, and no
interpolation or carrying forward is used. Percentages are not converted back to
counts; the source warns about privacy rounding. Missing values from one source
never erase unrelated source metrics or custom CSV series.

## Snapshot retrieval and normalized fingerprints

All six snapshots were fetched from the live official API on **10 November 2026**.

| Source | Retrieval timestamp (UTC) | Normalized SHA-256 |
| --- | --- | --- |
| Population | 2026-11-10T21:43:03.591Z | `fa3fd3fec8826a3f4a96ec7552421b980273d5945aab6774a31ae9e283241c87` |
| Households | 2026-11-10T21:43:08.157Z | `a310deb05c63128b0e50c39bdc855a1bfa662a862469e1d27bfbb654ad4ebf04` |
| Income | 2026-11-10T21:43:12.599Z | `a7da570168b93abf6142928079a3ba9178c0151d46454c17fd32a079850c2c7d` |
| Ownership | 2026-11-10T21:43:17.389Z | `fc9f21ce7f99d2e5c35b03280cf86e73f10241c36a333da8fcdb805566ecf75d` |
| Energy | 2026-11-10T21:43:21.015Z | `f7cc4db1e705d5ff7e6ad825592ff321de1927b92ab4a0bb29717173fc8a7727` |
| Green area | 2026-11-10T21:43:23.859Z | `ad17d85ade2406485a60f6ee056f9d8c656cd052c72c31c4143b424994fa25a6` |

The refresh script retains future retrieval dates/hashes directly in the generated
bundles; this table documents the initial shipped version.
