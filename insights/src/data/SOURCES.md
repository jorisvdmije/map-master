# Amsterdam snapshot and analysis contracts

The app ships a standalone, committed copy of the validated source data in
`public/data/`. Neither opening the app nor building it requires the documentation
website, a live Amsterdam API request or an API key. Run `npm run prepare:data`
explicitly from this app to copy a refreshed, validated dataset from the source
repository. The source fetch command is `node website/scripts/fetch-development.mjs`
from the repository root.

The snapshot was retrieved **9 November 2026** and includes **518 neighborhoods**
and source years **2012–2026**. Missing and suppressed values remain `null`; a
published housing count of zero remains zero. Only 370 neighborhoods have a
complete WOZ history. No interpolation is used.

- [O&S Statistiekhub v2](https://api.data.amsterdam.nl/v1/docs/datasets/statistieken@v2.html):
  `WWOZ_GEM` (indicator 3036), average WOZ in euros **per dwelling**, and
  `WVOORRBAG` (indicator 3031), BAG residential address count at 1 January.
- [Amsterdam KRG areas](https://api.data.amsterdam.nl/v1/docs/datasets/gebieden.html):
  geometries of 24 March 2022, matched by exact official identifiers to source
  statistical neighborhood codes.
- [O&S source and comparability explanation](https://onderzoek.amsterdam.nl/dataset/basisbestand-gebieden-amsterdam-bbga).

The displayed WOZ source year follows the valuation year: source year 2026 has
valuation date **1 January 2025**. Average WOZ is neither a sale price nor a repeat
sales index. Changes can reflect changes in the mix of homes.

The source's historical values were recalculated to the 2022 boundaries where
possible. Known breaks for Driemond remain explicit; charts do not connect across
them, indexed series stop after a break, and year-on-year growth at a break is
unknown. Growth of housing stock across 2015 is also unknown because the source
definition changed to include smaller rental homes. No city average is recreated
by averaging neighborhood means.

## Square-meter prices

The current dataset **does not contain housing sale prices per square meter**.
The full public Statistiekhub indicator catalog (1,081 indicator definitions) was
checked on 9 November 2026; available per-square-meter rental-price indicators
refer to retail premises and are not substituted. `priceM2` is registered as an
unavailable variable. Explicitly imported, sourced neighborhood/year observations
can supply it through `Area.series.priceM2`. The model never divides WOZ by an
unrelated neighborhood-average area.

## Regression and export

OLS is descriptive and uses one paired observation per neighborhood for the
selected source year. Neighborhoods with either variable missing are excluded.
At least three complete pairs and variation in X are required. Constant Y has
undefined R², represented as `null`; there are no causal, forecast or significance
claims. Repeated observations across time are never pooled in this regression.

CSV preserves source year, neighborhood identity, geometry vintage, retrieval
timestamp, each variable's unit and source, and empty cells for unknown values.
Text cells are escaped against spreadsheet formula injection.

The original snapshot metadata preserves raw source URLs, SHA-256 hashes,
definitions, valuation dates and comparability notes.
