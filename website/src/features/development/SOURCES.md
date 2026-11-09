# Buurtontwikkeling: O&S Statistiekhub

The checked-in snapshot contains the published **average WOZ value in euro per
dwelling** (`WWOZ_GEM`) and the BAG housing stock (`WVOORRBAG`) for 2012–2026.
WOZ is neither a price per square metre nor a repeat-sales price index. A change
in the neighborhood average can include changes in housing mix and coverage.
Values are already euro in this API; do not apply the CBS thousands multiplier.

## Sources and definitions

- [O&S Statistiekhub API, version 2](https://api.data.amsterdam.nl/v1/docs/datasets/statistieken@v2.html).
  This is the replacement for the old BBGA API, which O&S has announced it will
  discontinue: [O&S announcement, 1 July 2026](https://onderzoek.amsterdam.nl/artikel/nieuwe-toegang-tot-actuele-statistieken).
- Indicator metadata: `/v1/statistieken/v2/indicatoren/?naam=WWOZ_GEM`
  (currently id 3036) and `?naam=WVOORRBAG` (currently id 3031).
- Observations: `/v1/statistieken/v2/cijfers/?indicator.id=3036&_pageSize=20000`
  and `?indicator.id=3031&_pageSize=20000`. Each observation includes its
  geographical type, code and vintage, observation date and indicator ID.
- Area dimensions: `/v1/statistieken/v2/gebieden/?gebiedstype.id=7&_pageSize=1000`.
  The unknown dimension `ZZ99` is omitted; all 518 real neighborhoods are retained,
  including those with unpublished values. Missing observations and suppressed
  negative values stay `null`, while a published housing stock of zero stays zero.

Both indicators refer to 1 January of the displayed source year. The WOZ metadata
states that its valuation year precedes that date: source year 2026 therefore has
valuation date 1 January 2025. `meta.valuationDates` records each date explicitly.
The metadata defines housing stock as BAG residential addresses, excluding
houseboats and mobile-home pitches. Its English definition additionally notes
the inclusion of relatively small rental homes, such as student homes, from
2015. Stock change can reflect a registration/definition change, construction,
demolition or conversion. A stock-change filter is a signal of changing housing
mix, not a count or correction of new construction.

## Geography and comparability

The O&S observations explicitly use the **24 March 2022 area definition**. This
is not a historical join to the current CBS map. `geometry.json` comes from the
official [Amsterdam KRG area API](https://api.data.amsterdam.nl/v1/docs/datasets/gebieden.html),
requested with `geldigOp=2022-03-24` and GeoJSON output. Every geometry is matched
to the statistical dimension's exact `bronId` (`identificatie.volgnummer`), not
merely to a same-looking code. Source validity dates, official CBS code and area
code must agree. Output coordinates are WGS84 rounded to six decimal places.

[O&S explains](https://onderzoek.amsterdam.nl/dataset/basisbestand-gebieden-amsterdam-bbga)
that historic observations have been recalculated to the 2022 area definition
where possible. It cautions specifically about Driemond and Amsterdam with or
without Weesp, because not all observations could be recalculated. There is no
per-observation guarantee of a consistent historical Weesp population here.

The city series is the **official Amsterdam municipality series**, code `0363`,
area vintage 2022-03-24. [Wonen in cijfers, O&S, 27 December 2023](https://onderzoek.amsterdam.nl/artikel/wonen-in-beeld)
confirms that the 474,735 homes at 1 January 2023 include almost 10,000 additional
homes due to the Weesp merger during 2022. That stock count agrees exactly with
the API's 2023 municipality value. Because the source dates are 1 January while
the merger was in March 2022, `breakYears: [2022, 2023]` conservatively prevents
an unqualified comparison across either transition. Dorp Driemond
(`BU0363SA02`) has the same breaks.
Other absent history, including absent observations for Weesp neighborhoods,
stays unknown. No interpolation, inferred historical mapping or reconstructed
city average is used.

## Refresh and integrity

Run `node website/scripts/fetch-development.mjs` from the repository root.
The fetch script uses only the current Statistiekhub and KRG area APIs, follows
trusted same-table continuations, rejects loops and incomplete final pages, and
validates the indicator definitions, dates, geographic vintage, exact geometry
identifiers and basic coverage before replacing the output files. Raw response
URLs and SHA-256 hashes are retained in `meta.sources`; normalized statistics and
geometry have separate fingerprints. A failed source fetch preserves the prior
snapshot. No browser live fetch is required to open this core analysis.

Run `node --test website/scripts/bbga.test.mjs` for source-contract regression
checks, including hostile pagination, missing/suppressed values and duplicate or
geographically inconsistent records.
