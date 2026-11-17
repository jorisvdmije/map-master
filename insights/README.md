# Atlas — Ruimte voor inzicht

An independent data exploration application for geographic time series. Its own
React/Vite build, dependencies, public data and deployment output live here. It
does not import the documentation application or require the Map Master library.
The existing documentation and specialist analysis routes stay available as before.

## Run

With Node 22 or 24:

```sh
npm ci --prefix insights
npm run dev:insights
```

Open http://127.0.0.1:5190. Or run `npm run dev` inside this directory.

```sh
npm --prefix insights test
npm run build:insights
npm --prefix insights exec playwright install chromium
npm --prefix insights run test:browser
npm --prefix insights run test:catalog:browser
```

The browser check starts its own temporary server. Optional browser arguments:
`npm --prefix insights run test:browser -- chromium firefox webkit`.
The source-library and market-example suites accept the same browser arguments.
`npm run check:browser` inside this directory runs all three suites in Chromium
and is included in the Atlas CI job.

## Explore

- Add, duplicate, widen, reorder or remove six block types: map, time series,
  cross-sectional OLS regression, ranking, table and median statistic.
- Drag numeric variables onto an axis, color or value slot. The same slots have
  select menus for keyboard and touch users. The time-series X axis stays time.
- Click or keyboard-select neighborhoods on maps, scatterplots, rankings or the
  searchable neighborhood list. Selection highlights every block. **Alleen
  selectie** explicitly filters the analysis; clearing the last selection restores
  all neighborhoods. Time series show up to eight selected neighborhoods, or
  three explicitly labeled examples before selection.
- The shared source year controls maps, regressions, rankings and tables. The
  selected period controls time series. Playback advances the source year.
- Rankings also support **Periodegroei**, comparing the period start with the
  active year and excluding known boundary and stock-definition breaks.
- Use **⌘/Ctrl K** to search variables, block types and actions. Undo/redo covers
  workspace edits; axis menus and block move actions work without dragging.
- Browser storage automatically saves the workspace, including CSV imports.
  Download a `.atlas.json` backup to reopen or move it. This is local storage,
  not account synchronization or a collaboration backend.

## On-demand sources library

Open **Bronnenbibliotheek** through the database icon, the Data sidebar or
**⌘/Ctrl K**. Search metadata by subject, metric, original registry (for example
CBS or RVO), theme or unit before downloading observations. Only clicking
**Toevoegen** initiates a source request. Added variables are grouped by source
in the sidebar and work with every existing block.

Six extra groups supply twelve new variables:

| Group | Metrics | Source years |
| --- | --- | --- |
| Population & age | Inhabitants, children (%), seniors (%) | 2012–2026 |
| Households | One-person households (%), households with children (%) | 2012–2026 |
| Income | Disposable household income (€), lowest national quintile (%) | 2012–2024 |
| Housing ownership | Owner-occupied (%), corporation-owned (%) | 2012–2026 |
| Energy labels | Registered labels A++++–B (%), labels E–G (%) | 2018–2019, 2021–2026 |
| Public green | Public green as a percentage of land | 2019–2025 |

These are different indicator groups published by O&S Amsterdam, with original
registries including BRP, RVO, CBS and spatial base registers. They are not six
independent publishers. Definitions and available years are visible on each card.
All join the app's exact 518 neighborhoods and 2022 geographic vintage. See
[full provenance and statistical caveats](src/data/CATALOG-SOURCES.md).

Add first checks the optional browser IndexedDB cache (seven-day lifetime), then
tries the official API. Refresh bypasses that cache. A live failure falls back to
the requested group's validated bundled snapshot, visibly labeled with its original
retrieval date. A failed refresh preserves the already loaded observations and
the prior cache. Cancellation stops a pending addition without applying partial data.
Concurrent additions merge independently. A source in use by a block cannot be
removed until the block uses another variable; removing an unused source clears
undo history so it cannot restore references to missing fields.

Loaded sources are included in the normal local save and `.atlas.json` download,
so reopening the workspace needs no extra live source fetch. Legacy files without
sources remain compatible. Browser storage may be unavailable or full; the visible
save status indicates when a downloaded backup is needed. No imported CSV is sent
to a source API, and the app has no central user-data database.

Choosing a metric adjusts the active year to a shared supported year within the
current period when necessary, with an explicit notification. Gaps such as the
absent 2020 energy record remain null. Income is not silently shifted into 2025 or
2026. Index charts need a published value at the selected start year.

### Add another source

1. Register metadata and indicator contracts in `src/data/catalog.ts`: IDs,
   definitions, original registries, units, years and exact geometry vintage.
2. For another compatible Statistiekhub group, reuse `source-loader.ts`. A new
   provider needs its own adapter into the same `SourceBundle` contract, including
   explicit spatial/time matching. Arbitrary URLs are not accepted as trusted sources.
3. Run `npm run data:catalog -- source-id` to fetch a validated fallback and retain
   source definitions, request URLs and fingerprints. Commit the small normalized
   snapshot. Browsers still download it only when that source is added and live
   access is unavailable.
4. Add coverage and source-contract tests, then run `npm test`, `npm run build`
   and `npm run check:browser`.

Only the selected six compact fallbacks are shipped (about 1.2 MB combined), not
a mirror of the upstream databases. The current public API works directly from
the browser without a backend or embedded API key. Providers requiring credentials
or disallowing browser access would need a server-side adapter; credentials must
not be placed in this static application.

## Woningmarkt tijdmachine

Open the example using the pulse icon, **Woningmarkt tijdmachine** in the Data
sidebar, or the command menu. Its direct local link is
`http://127.0.0.1:5190/#woningmarkt`. The example is lazy loaded; the normal workspace
does not download its 52 KB market snapshot or forecasting code before you open it.
Your existing workspace stays intact when entering/leaving the example.

Select a historical quarter-end and predict one or four quarters ahead. The example
compares unchanged-price and annual-momentum baselines with two expanding-window
ridge models: past prices/transactions, and the same features plus mortgage rates.
Scalers and coefficients use training observations only. The target period is
relative to the selected quarter; growth is measured from the last actually usable
price index, which can be older because of publication delays.

The snapshot contains the official Amsterdam existing-house-price index and
transaction volume from CBS/Kadaster, plus the ECB national new-business
house-purchase lending rate. No neighborhood sale prices are inferred from WOZ.
See the [data contract and source caveats](src/market/SOURCES.md).

**Reconstructed availability:** these are current-vintage historical series,
not archived copies of every original release. Every market observation is assumed
usable 60 calendar days after its period ends. That conservative assumption is
displayed throughout. ECB estimated observations before 2003 are excluded from
rate features. This limits information by date, but cannot remove later source
revisions, backcasts or methodology changes from today's historical values.

Past-only forecasts are tested on later outcomes once those outcomes become
usable. Scores compare all four models over exactly the same completed origins,
using mean absolute growth error in percentage points and RMSE in index points.
The historical 80% error interval uses only earlier, completed out-of-sample
residuals. Empirical interval coverage is shown separately; nominal coverage is
not a guarantee. Overlapping forecast horizons are not independent experiments.

**Reveal:** the selected future outcome is excluded from chart paths, y scaling,
accessible markup, tooltips and the downloaded report until explicitly revealed.
Changing the forecast origin/horizon hides it again. Completed backtests shown
before reveal all have outcome availability dates on/before the information cutoff.
Future raw observations can be present in the downloaded source asset; the time
machine is a transparent analytical example, not a secure exam system.

**Rate sensitivity:** the slider shifts the latest known rate and its 12-month
change in the current rate-model feature vector. It does not retrain historical
models, change retrospective scores, simulate an entire rate path, or identify
a causal interest-rate effect. Nonzero scenarios have no calibrated error interval.
The model can extrapolate outside its historical feature range.

**Neighborhoods:** the separate annual WOZ view uses a conservatively reconstructed
availability date of 1 January after each source year. A ridge pattern is learned
from earlier years using prior WOZ level/growth and housing-stock level/growth.
Its expected change is conditional on the *realized neighborhood median of the
comparison year*: this is retrospective contextual analysis, not a forecast of
future neighborhood transaction prices. At least 100 homes, no known boundary
break, and stock changes of at most 20% are required for a comparison. The
2015 housing-stock definition transition is excluded from model samples.
Outliers remain in the data; the diverging map color scale is capped at the
95th percentile of absolute deviations and labels clipped ranges with ≤/≥.
Hover/select reveals exact deviations, including extreme observations. Current
2022 geometry and recalculated history retain the original comparability caveats.

Policy cards mark Amsterdam's 2022 purchase-protection introduction and the 2024
Affordable Rent Act as sourced context. They are not model features or estimated
causal policy effects. Events after the information cutoff become visible only
when their period is revealed. Identifying a policy effect would require a separate
design with suitable comparison groups and additional treatment data.

The JSON analysis report includes source provenance, known inputs, forecasts,
completed backtests, model scores, sensitivity settings and the retrospective WOZ
analysis. It includes the current target's actual value only after reveal. It is
an analysis report, not an editable `.atlas.json` workspace. CSV downloads retain
historical forecasts and information/availability dates for independent checks.
URL parameters retain origin, horizon and model; reveal and sensitivity reset on reload.

```sh
npm run data:market
npm run test:market:browser -- chromium firefox webkit
```

Refreshing fetches official source data and replaces the market snapshot atomically
only after validation. ECB availability can vary; the source contract documents
how an earlier captured official response can be used explicitly without fabricating
a fallback. Runtime exploration requires no live external API connection.

## Real data and custom variables

The bundled published O&S Amsterdam snapshot has **518 neighborhoods and
2012–2026 source years**, average WOZ per dwelling and BAG housing counts.
WOZ is **not a transaction price or price per square meter**. See the full
[source and calculation contract](src/data/SOURCES.md).

Import a CSV with one row per neighborhood/year, using exact BU0363 codes. A
downloadable blank template includes the real neighborhood identifiers. Choose
the area-code, year and value columns, variable name and unit. Price-per-m²
imports become the `priceM2` variable in every block. Other units create a custom
numeric variable. Missing values stay null; duplicate neighborhood/year pairs,
unknown codes and invalid years reject the import atomically. An import replaces
the entire series with the same variable identity. Source definitions and
geographic comparability of custom data remain the analyst's responsibility.
Files up to 10 MB and 20,000 rows are supported, with at most 20 imported variables
and 9 MB of combined workspace data. Reimporting a measure replaces its prior
import. Years are limited to the bundled
dataset's 2012–2026 range. No imported data is uploaded.

CSV exports contain raw source values, units, source and geometry vintage, even
when a chart displays an index or year-over-year transformation. Empty cells are
unknown. Neighborhood changes and the 2015 housing-stock definition transition
are treated explicitly; no gaps are interpolated. Regression uses paired values
from one source year, not pooled correlated observations across years.

## Build and deploy independently

`npm run build` outputs `dist/`; host it with any static hosting service. Core assets,
including boundaries and fallback snapshots, are local. No map API key, tile service,
documentation build or backend is needed. `ATLAS_BASE_PATH=/atlas/ npm run build`
supports a subpath; the default build uses relative asset URLs.

Public data copies are tracked deliberately so this directory can become its own
repository. Refresh explicitly with `npm run prepare:data` after the existing
`website/scripts/fetch-development.mjs` has validated new upstream data. Refreshing
uses the original repository; normal builds and runtime do not.

## Design reference

The public [ZENZ product description](https://www.zenztech.com/aviation-industry/)
and [approach](https://www.zenztech.com/our-approach/) informed the emphasis on
continuous exploration and connected data. No private product access, proprietary
UI or copied assets were used. Atlas specializes that interaction in geographic
time series, with visible source definitions and reusable analysis blocks.
