import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { type MarketData, validateMarketData } from "../src/market/data.ts";
import {
  addQuarters,
  analyzeMarket,
  compareQuarter,
  forecastOrigins,
  quarterDate,
  quarterIndex,
  DEFAULT_MIN_TRAINING,
  MIN_CALIBRATION,
  type ModelId,
} from "../src/market/model.ts";

const real = validateMarketData(
  JSON.parse(
    await readFile(
      new URL("../public/data/market.json", import.meta.url),
      "utf8",
    ),
  ),
);
const asOf = "2021-Q4";
const near = (actual: number | null, expected: number, tolerance = 1e-9) => {
  assert.notEqual(actual, null);
  assert.ok(
    Math.abs(actual! - expected) <= tolerance,
    `${actual} ≈ ${expected}`,
  );
};
function controlled(): MarketData {
  // Controlled test-only trajectories; never included in product/public data.
  const data = structuredClone(real);
  data.prices = data.prices.map((record, i) => ({
    ...record,
    value: 70 * Math.exp(0.006 * i + 0.035 * Math.sin(i / 4)),
    transactions: 1200 + 8 * i + 120 * Math.sin(i / 5),
  }));
  data.rates = data.rates.map((record, i) => ({
    ...record,
    value: 4 + 0.65 * Math.sin(i / 17) - 0.002 * i,
  }));
  return data;
}
const model = (analysis: ReturnType<typeof analyzeMarket>, id: ModelId) =>
  analysis.models.find((m) => m.id === id)!;
const percentile = (values: number[], p: number) => {
  const s = [...values].sort((a, b) => a - b),
    position = (s.length - 1) * p,
    i = Math.floor(position);
  return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (position - i);
};

test("quarter arithmetic uses calendar ends, leap years and strict quarter syntax", () => {
  assert.equal(quarterDate("2020-Q1"), "2020-03-31");
  assert.equal(quarterDate("2020-Q4"), "2020-12-31");
  assert.equal(addQuarters("2020-Q4", 1), "2021-Q1");
  assert.equal(addQuarters("2021-Q1", -5), "2019-Q4");
  assert.equal(compareQuarter("2022-Q4", "2021-Q3"), 5);
  for (const period of ["2021-Q0", "2021-Q5", "2021-12", "21-Q1"])
    assert.throws(() => quarterDate(period));
});

test("real publication-lag inputs stop before the forecast date and target the requested future quarter", () => {
  const result = analyzeMarket(real, { origin: asOf, horizon: 4 });
  assert.equal(result.originDate, "2021-12-31");
  assert.equal(result.knownInputs.basePeriod, "2021-Q3");
  assert.equal(result.knownInputs.latestRatePeriod, "2021-10");
  assert.equal(result.targetPeriod, "2022-Q4");
  for (const input of result.knownInputs.records)
    assert.ok(input.availableAt <= result.originDate);
  assert.equal(result.knownInputs.latestRateEstimated, false);
  assert.ok(result.warnings.some((warning) => warning.includes("revisies")));
});

test("no-change and momentum baselines account for the lag between known base and target", () => {
  const data = controlled(),
    result = analyzeMarket(data, { origin: asOf, horizon: 4 });
  const base = data.prices.find((p) => p.period === "2021-Q3")!.value!;
  const previous = data.prices.find((p) => p.period === "2020-Q3")!.value!;
  near(model(result, "flat").predictedIndex, base);
  near(model(result, "flat").growthFromKnown, 0);
  near(
    model(result, "momentum").predictedIndex,
    base * Math.exp((Math.log(base / previous) * 5) / 4),
  );
  assert.equal(model(result, "flat").trainingCount, 0);
});

test("perturbing every unpublished price, transaction and rate cannot affect a historical prediction, scaler or interval", () => {
  for (const horizon of [1, 4] as const) {
    const original = analyzeMarket(real, { origin: asOf, horizon });
    const changed = structuredClone(real),
      cutoff = quarterDate(asOf);
    for (const record of changed.prices)
      if (record.availableAt > cutoff) {
        record.value = 9e8;
        record.transactions = 8e8;
      }
    for (const record of changed.rates)
      if (record.availableAt > cutoff) record.value = 9999;
    assert.deepEqual(
      analyzeMarket(changed, { origin: asOf, horizon }),
      original,
    );
  }
});

test("delayed historical publications remain excluded even though their period precedes the origin", () => {
  const original = controlled();
  const delayed = original.prices.find((p) => p.period === "2020-Q4")!;
  delayed.availableAt = "2025-12-31";
  const reference = analyzeMarket(original, { origin: asOf, horizon: 4 });
  const altered = structuredClone(original);
  const futurePublication = altered.prices.find(
    (p) => p.period === delayed.period,
  )!;
  futurePublication.value = 1e9;
  futurePublication.transactions = 1e9;
  assert.deepEqual(
    analyzeMarket(altered, { origin: asOf, horizon: 4 }),
    reference,
  );
  assert.ok(
    !reference.knownInputs.records.some(
      (input) => input.period === delayed.period,
    ),
  );
});

test("expanding fits contain exactly the completed eligible training origins, never later labels", () => {
  const data = controlled();
  const position = quarterIndex(asOf) - quarterIndex(data.prices[0].period);
  for (const horizon of [1, 4] as const) {
    const result = analyzeMarket(data, { origin: asOf, horizon });
    // Trend features require eight previous transaction quarters. Rate features
    // additionally need a year of normal (A) rates after the 2000–02 estimates.
    assert.equal(model(result, "trend").trainingCount, position - horizon - 8);
    assert.equal(model(result, "rates").trainingCount, position - horizon - 36);
    for (const row of result.backtest) {
      assert.ok(row.actualAvailableAt <= result.originDate);
      assert.equal(compareQuarter(row.targetPeriod, row.origin), horizon);
      assert.ok(row.originDate < result.originDate);
    }
  }
});

test("source-estimated early rates cannot influence input features or fitted rate predictions", () => {
  const data = controlled(),
    reference = analyzeMarket(data, { origin: asOf, horizon: 4 });
  for (const rate of data.rates) if (rate.obsStatus === "E") rate.value = 1e8;
  assert.deepEqual(
    analyzeMarket(data, { origin: asOf, horizon: 4 }),
    reference,
  );
  const early = analyzeMarket(data, { origin: "2002-Q4", horizon: 1 });
  assert.equal(early.knownInputs.latestRate, null);
  assert.equal(model(early, "rates").predictedIndex, null);
});

test("insufficient training and missing feature values produce an explicit unavailable model", () => {
  const young = analyzeMarket(controlled(), { origin: "2005-Q4", horizon: 4 });
  assert.equal(model(young, "rates").predictedIndex, null);
  assert.match(model(young, "rates").reason ?? "", /28/);
  const data = controlled();
  for (const row of data.prices) row.transactions = null;
  const result = analyzeMarket(data, { origin: asOf, horizon: 1 });
  assert.notEqual(model(result, "flat").predictedIndex, null);
  assert.notEqual(model(result, "momentum").predictedIndex, null);
  assert.equal(model(result, "trend").predictedIndex, null);
  assert.equal(model(result, "rates").predictedIndex, null);
  assert.ok(
    result.scores.every(
      (score) =>
        score.n === 0 && score.maeGrowthPP === null && score.rmseIndex === null,
    ),
  );
});

test("empirical bands reproduce signed earlier out-of-sample residual quantiles only", () => {
  const result = analyzeMarket(controlled(), { origin: asOf, horizon: 4 });
  const forecast = model(result, "rates"),
    band = forecast.interval;
  assert.ok(band);
  const residuals = result.backtest.map((row) =>
    Math.log(row.actualIndex / row.predictions.rates),
  );
  assert.equal(band.calibrationCount, residuals.length);
  assert.equal(band.coverage, 0.8);
  near(
    band.low,
    forecast.predictedIndex! * Math.exp(percentile(residuals, 0.1)),
  );
  near(
    band.high,
    forecast.predictedIndex! * Math.exp(percentile(residuals, 0.9)),
  );
});

test("a model can be fitted before it has enough completed forecasts for an error band", () => {
  const early = analyzeMarket(controlled(), { origin: "2015-Q4", horizon: 4 });
  assert.ok(model(early, "rates").trainingCount >= DEFAULT_MIN_TRAINING);
  assert.notEqual(model(early, "rates").predictedIndex, null);
  assert.equal(model(early, "rates").interval, null);
  const ready = analyzeMarket(controlled(), { origin: "2016-Q1", horizon: 4 });
  assert.equal(
    model(ready, "rates").interval?.calibrationCount,
    MIN_CALIBRATION,
  );
});

test("backtest scores independently match common-origin MAE in growth pp and index RMSE", () => {
  const result = analyzeMarket(real, { origin: asOf, horizon: 4 });
  assert.ok(result.backtest.length > 20);
  for (const score of result.scores) {
    const n = result.backtest.length;
    assert.equal(score.n, n);
    near(
      score.maeGrowthPP,
      result.backtest.reduce(
        (sum, row) =>
          sum +
          Math.abs(
            100 * (row.predictions[score.id] / row.baseIndex - 1) -
              100 * (row.actualIndex / row.baseIndex - 1),
          ),
        0,
      ) / n,
    );
    near(
      score.rmseIndex,
      Math.sqrt(
        result.backtest.reduce(
          (sum, row) =>
            sum + (row.predictions[score.id] - row.actualIndex) ** 2,
          0,
        ) / n,
      ),
    );
  }
});

test("rate sensitivity changes only the current rate model and carries no counterfactual error band", () => {
  const base = analyzeMarket(real, { origin: asOf, horizon: 4 });
  const changed = analyzeMarket(real, {
    origin: asOf,
    horizon: 4,
    rateDelta: 1,
  });
  for (const id of ["flat", "momentum", "trend"] as const)
    assert.deepEqual(model(changed, id), model(base, id));
  assert.deepEqual(changed.backtest, base.backtest);
  assert.deepEqual(changed.scores, base.scores);
  assert.equal(
    model(changed, "rates").trainingCount,
    model(base, "rates").trainingCount,
  );
  near(model(changed, "rates").assumedRate, base.knownInputs.latestRate! + 1);
  assert.notEqual(
    model(changed, "rates").predictedIndex,
    model(base, "rates").predictedIndex,
  );
  assert.equal(model(changed, "rates").interval, null);
});

test("missing monthly rates are not filled and cannot silently turn into a zero-interest model", () => {
  const data = controlled();
  for (const row of data.rates) row.value = null;
  const result = analyzeMarket(data, { origin: asOf, horizon: 4 });
  assert.equal(result.knownInputs.latestRate, null);
  assert.equal(model(result, "rates").predictedIndex, null);
  assert.notEqual(model(result, "trend").predictedIndex, null);
  assert.equal(
    result.knownInputs.records.filter((input) => input.kind === "rate").length,
    0,
  );
});

test("origins stop at completed quarters before source retrieval and invalid settings fail", () => {
  const origins = forecastOrigins(real);
  assert.ok(origins.includes(asOf));
  assert.ok(
    origins.every(
      (origin) => quarterDate(origin) <= real.meta.retrievedAt.slice(0, 10),
    ),
  );
  assert.equal(origins.at(-1), "2026-Q3");
  for (const options of [
    { origin: "2027-Q1", horizon: 1 },
    { origin: asOf, horizon: 2 },
    { origin: asOf, horizon: 1, minTraining: 23 },
    { origin: asOf, horizon: 1, rateDelta: 6 },
  ]) {
    assert.throws(() =>
      analyzeMarket(real, options as Parameters<typeof analyzeMarket>[1]),
    );
  }
});

test("a missing historical price is never interpolated into a momentum or regression feature", () => {
  const data = controlled();
  data.prices.find((record) => record.period === "2020-Q3")!.value = null;
  const result = analyzeMarket(data, { origin: asOf, horizon: 4 });
  assert.equal(result.knownInputs.priceGrowth4q, null);
  assert.notEqual(model(result, "flat").predictedIndex, null);
  for (const id of ["momentum", "trend", "rates"] as const)
    assert.equal(model(result, id).predictedIndex, null);
});
