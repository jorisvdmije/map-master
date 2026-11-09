# Housing snapshot

See [Open data Amsterdam](../../../../docs/open-data-amsterdam.md) for source
contracts, dates, geography, limitations and refresh instructions. `snapshot.json`
is a complete, sorted Amsterdam join by official CBS buurtcode; raw upstream page
hashes and URLs are in its metadata. Geometry is rounded to six WGS84 decimals.
CBS negative suppression codes and non-numeric values are null, never zero.
BAG data remains an on-demand public API request; no invented properties or prices.

## Expanded neighborhood indicators

The snapshot adds real CBS indicators, all joined by official buurtcode:

- [CBS 2025, table 86165NED](https://www.cbs.nl/nl-nl/cijfers/detail/86165NED):
  homes added through new construction in 2025 (`newHomes`); share of homes built
  in the past ten years (`newBuild`); rental and corporation ownership shares;
  homes with no registered BRP resident (`vacancy`); household size, age shares;
  annual gas and grid electricity averages; district heating, gas-free homes and
  homes with solar installations; average road distance to GP, primary school,
  day care and supermarket. These are neighborhood statistics, not individual
  home attributes, available places, building permits or planned developments.
- [CBS 2024, table 85984NED](https://www.cbs.nl/nl-nl/cijfers/detail/85984NED):
  education, mean personal income per inhabitant and the share of people whose
  personal income belongs to the national lowest 40%. The corresponding 2025
  fields were entirely unpublished when fetched, so these indicators explicitly
  keep their 2024 year. Income figures are provisional and often suppressed.
  They are only attached where the 2025 CBS boundary-change indicator is `1`.
- Education is `100 * hbo/wo / (basic-vmbo-mbo1 + havo-vwo-mbo2-4 + hbo/wo)`
  for people aged 15–74. All three published rounded/estimated counts must be
  known and their sum positive. It is a share of the three reported education
  groups, not a share of all residents and never a household or address attribute.
- Child (0–14) and elderly (65+) shares are derived from the published rounded
  age counts and total residents. Zero denominators, unpublished counts and
  impossible ratios remain unknown. Small-area rounding affects precision.
- `socialRent` is the technical key for **corporation ownership**, not proof of
  a regulated/social rental price. `vacancy` means no resident registered in the
  BRP, not established physical vacancy or holiday rental. `lowIncome` is the
  national bottom-40% income group, not the new CBS poverty definition.
- Energy values are the annual registrations in CBS table 2025, not live meter
  readings. Electricity is grid delivery rather than total energy consumption.
  District heating can lower gas averages; missing coverage does not mean zero.

`meta.indicators` records each definition, unit, table year and official source.
The fetch script validates all selected fields against that table's current
DataProperties metadata. The fetched metadata responses are fingerprinted too.

`year` is always the CBS table year. `referenceYear` distinguishes the actual
observation/valuation year where the **current** CBS metadata identifies it:
WOZ has valuation year 2024 (previous WOZ: 2023), education is measured on
1 October of reporting year 2024, and income refers to reporting year 2024 with
the population at 1 January 2024. These dates follow the current DataProperties
descriptions; no blanket two-year lag is applied. The current table has been
updated through October 2026 and should not be confused with an older release.
Energy DataProperties descriptions do not identify a separate observation year.
Their `referenceYear` remains null and their descriptions explicitly say table
2025 rather than claiming a separately verified meter/observation year. The
absence of an explicit date is not evidence for assuming 2024 or 2025 readings.

## WOZ history and comparability

WOZ history uses [2023 / 85618NED](https://www.cbs.nl/nl-nl/cijfers/detail/85618NED),
2024 / 85984NED and 2025 / 86165NED. Their valuation dates are respectively
1 January 2022, 2023 and 2024. Each feature includes ordered `wozHistory` entries
`{year, value, valuationDate, comparable}` and `wozPrevious` / `wozChange` for
2024 → 2025. Percentage changes can be negative. Suppressed source numbers
still become null before any arithmetic.

A matching buurtcode alone does not establish historical comparability. The
script requires CBS `IndelingswijzigingGemeenteWijkBuurt_4 = 1` for **every**
intervening year, meaning unchanged code and boundary according to CBS. Code 2
(recoding), code 3 (boundary change), unknown indicators and unmatched records
produce null rather than an inferred mapping. The 2023 value is omitted if
either the 2024 or 2025 comparison is invalid. CBS reports boundary shifts of
approximately five metres or greater in this indicator; smaller shifts can
exist. History does not use geometrical equality or assume identical boundaries
because codes happen to match.

`wozChange` is the change of two published neighborhood averages; housing stock,
mix and coverage can change. It is not a repeat-sales house-price index or a
predicted value increase for an individual dwelling.

Refresh with `npm --prefix website run data:housing`. The script retrieves all
source pages before atomically replacing the complete snapshot, checks identifier
uniqueness and percentages, and retains URLs and SHA-256 hashes. No synthetic
values, interpolation or external postcode-to-neighborhood guesses are used.

## Practical validation

An unmocked API audit and browser walkthrough on 4 November 2026 covered
Concertgebouwbuurt, Havenkwartier IJburg and Weesp-Zuid II. The audit exposed
the actual erfpacht issuer spelling `Amsterdam`; this is now normalized for
display to `Gemeente Amsterdam`, while `rawIssuer` preserves the source value
in exports. Unknown issuers still fail explicitly.

BAG can take over thirty seconds across multiple pages. Progress reports
completed source pages and records read, never a premature dwelling count.
Cancellation discards incomplete results, and expected network/time-out failures
have actionable Dutch UI messages. The original pre-fix audit is retained at
`artifacts/housing-live/live-audit.json`; the accompanying results report
distinguishes original failures from post-fix browser checks.
