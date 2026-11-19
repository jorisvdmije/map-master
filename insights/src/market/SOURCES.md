# Housing-market time machine: data contract

This example uses **real observations** downloaded from official public APIs.
The normalized snapshot is `public/data/market.json`; opening the example requires
only that local asset, not a running CBS, ECB or DNB connection. It contains:

| Series | Geography and definition | Actual coverage |
| --- | --- | --- |
| Existing house-price index | Amsterdam, CBS/Kadaster, 2020=100 | 127 quarters, 1995-Q1–2026-Q3 |
| Registered house transactions | Amsterdam, existing dwellings sold to private individuals | Same 127 quarters |
| House-purchase lending interest rate | Netherlands, ECB MIR, new business, all initial rate fixations, AAR/NDER, % per annum | 321 months, 2000-01–2026-09 |

The snapshot was assembled on **11 November 2026**. Each raw response has its own
URL, SHA-256, retrieval timestamp and record count in `meta.sources`; the normalized
observations have a separate SHA-256. No synthetic observations are included.

## CBS price index and transactions

[CBS table 85792NED](https://www.cbs.nl/nl-nl/cijfers/detail/85792NED), regional code
`GM0363` (Amsterdam), supplies both quarterly series. The fetch validates the
region title and the metadata units for `PrijsindexVerkoopprijzen_1` (`2020=100`)
and `VerkochteWoningen_4` (`aantal`). Annual rows are excluded; quarters are never
manufactured by dividing annual totals.

This is the published existing owner-occupied housing index, based on Kadaster
transactions and WOZ appraisal values using the SPAR method. It is neither an
average sale price, a neighborhood WOZ average nor a price per square meter.
Transactions are registrations, not estate agents' sale agreements or listings.
See the [CBS PBK methodology](https://www.cbs.nl/nl-nl/onze-diensten/methoden/onderzoeksomschrijvingen/korte-onderzoeksomschrijvingen/prijsindex-bestaande-koopwoningen--pbk---2020-100).

CBS's table metadata, last modified **22 October 2026**, states that new regional
figures appear approximately **22 days after a reporting quarter**. It describes
the index as directly definitive, with exceptional corrections for material
errors. Later Kadaster recounts may differ from the numbers retained in StatLine.
This application preserves the published CBS series and performs no independent
municipal boundary harmonization or neighborhood aggregation.

Raw requests use the official OData endpoint:

```text
https://opendata.cbs.nl/ODataApi/OData/85792NED/TypedDataSet?$filter=RegioS%20eq%20%27GM0363%27&$format=json
```

The fetch also retains and verifies `TableInfos`, `DataProperties` and `RegioS`
metadata. The newest downloaded Amsterdam quarter, 2026-Q3, has index **135.4**
and **3,842** registered transactions.

## ECB mortgage-related rate

The exact source series is
[`MIR.M.NL.B.A2C.A.R.A.2250.EUR.N`](https://data.ecb.europa.eu/data/datasets/MIR/MIR.M.NL.B.A2C.A.R.A.2250.EUR.N).
Its API metadata specifies:

- Monthly reporting for the **Netherlands**, not Amsterdam.
- Euro-denominated house-purchase lending to households and nonprofit
  institutions serving households, excluding revolving loans, overdrafts and
  credit card debt.
- **New business**, covering all initial rate fixation lengths, with annualized
  agreed rate / narrowly defined effective rate in **percent per annum**.

New business includes new negotiations of existing agreements. This is not a
current advertised mortgage offer, a fixed ten-year quote, APR including all fees,
or the average rate on the outstanding mortgage stock. The
[ECB MIR definitions and release schedule](https://www.ecb.europa.eu/stats/financial_markets_and_interest_rates/bank_interest_rates/mfi_interest_rates/html/index.en.html)
state publication on the **23rd working day after the reporting month**. The
[DNB explanation](https://www.dnb.nl/statistieken/veelgestelde-vragen/) also
distinguishes contract averages and advertised rates.

The source begins in **January 2000**. The first 36 records, through December
2002, carry ECB status **E (estimated)**; from January 2003 the current records
carry **A (normal)**. `obsStatus` preserves this source flag. Early estimates are
genuine ECB records, not interpolations by this application. They do not prove
that those estimates were publicly available in 2000–2002. Rate-based historical
models should therefore prefer observations from 2003 onward or explicitly
explain the use of the estimated segment. No pre-2000 rates are filled in.

The latest downloaded rate, **September 2026**, is **3.9%**. The raw CSV endpoint
is:

```text
https://data-api.ecb.europa.eu/service/data/MIR/M.NL.B.A2C.A.R.A.2250.EUR.N?startPeriod=1995-01&format=csvdata
```

## Reconstructed availability, not historical vintages

**This snapshot is today's downloaded version of the historical series. It is
not a database of what was actually published at each historical forecast date.**

Every observation stores both its `periodEnd` and `availableAt`. The latter is
calculated as **period end + 60 calendar days** for prices, transactions and rates.
This is a deliberately conservative modeling assumption relative to the current
publication schedules above. It is not a verified historical first-release date,
and is not a guarantee for every past reporting period or estimated observation.

The current download can include revisions, rebasing and methodological changes
that were unknown at an earlier cutoff. Filtering by `availableAt` avoids using a
future reporting period under the stated lag assumption, but cannot remove this
revision/vintage limitation. A fully historical real-time backtest would require
archived releases and their actual publication timestamps. The metadata explicitly
labels availability as `mode: reconstructed` and carries this limitation in Dutch
for display and export.

The assumption also intentionally withholds some already downloaded observations:
2026-Q3 prices and September 2026 rates have `availableAt: 2026-11-29`, even though
the file was assembled on 11 November. These dates must not be shortened merely
because their final values are visible in the downloaded snapshot.

The national lending rate is an explanatory indicator, not an Amsterdam-specific
mortgage measure. No income, inflation adjustment, new-build series, individual
valuation or price per square meter is inferred from these three observations.

## Refresh and validation

From the `insights` directory, using the supported Node runtime:

```sh
node scripts/fetch-market.mjs
```

The script downloads and validates the official dimensions, units, series keys,
coverage, nonnegative values, complete ordered periods and reconstructed
availability dates. Missing published values remain `null`, never zero. A failed
request or validation leaves the previous snapshot intact; writing is atomic.

On the initial run, the ECB CSV was fetched successfully during source research.
Subsequent refresh attempts returned HTTP 504. The initial genuine raw response
was then explicitly normalized using:

```sh
node scripts/fetch-market.mjs --ecb-response-file /path/to/captured-official-response.csv
```

This option is only for a raw response already captured from the documented ECB
endpoint; it applies the same metadata and observation validation and retains the
response's original file timestamp and raw hash. It does not synthesize or silently
substitute another series. Default refreshes still request the official live API.

`validateMarketData` checks source/series identity, units, date rules, contiguous
unique periods and numeric validity. `loadMarketData` additionally verifies the
normalized values' SHA-256 before returning them. Caller cancellation propagates;
there is no network or fabricated-data fallback.

Initial normalized SHA-256:
`2e190852ac3c7a12c21658d5369bbe8d197eb8c237f8495dcd0b588e40fdddbe`.
