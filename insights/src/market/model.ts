import type { MarketData, QuarterObservation } from "./data";

export type ModelId = "flat" | "momentum" | "trend" | "rates";
export type Horizon = 1 | 4;
export const DEFAULT_MIN_TRAINING = 28;
export const MIN_CALIBRATION = 12;
export const INTERVAL_COVERAGE = 0.8 as const;
const RIDGE_PENALTY = 6;
const modelOrder: ModelId[] = ["flat", "momentum", "trend", "rates"];
const labels: Record<ModelId, string> = {
  flat: "Ongewijzigde prijs",
  momentum: "Historische trend",
  trend: "Trend & transacties",
  rates: "Trend, transacties & rente",
};
export type InputRecord = {
  kind: "price" | "transactions" | "rate";
  period: string;
  value: number;
  availableAt: string;
};
export type KnownInputs = {
  basePeriod: string;
  baseIndex: number;
  baseAvailableAt: string;
  latestRatePeriod: string | null;
  latestRate: number | null;
  latestRateAvailableAt: string | null;
  rateChange12m: number | null;
  priceGrowth1q: number | null;
  priceGrowth4q: number | null;
  transactionGrowth4q: number | null;
  latestRateEstimated: boolean;
  records: InputRecord[];
};
export type ForecastInterval = {
  low: number;
  high: number;
  coverage: typeof INTERVAL_COVERAGE;
  calibrationCount: number;
};
export type ModelForecast = {
  id: ModelId;
  label: string;
  predictedIndex: number | null;
  growthFromKnown: number | null;
  basePeriod: string;
  targetPeriod: string;
  trainingCount: number;
  interval: ForecastInterval | null;
  reason?: string;
  scenarioRateDelta: number;
  assumedRate: number | null;
};
export type BacktestRow = {
  origin: string;
  originDate: string;
  targetPeriod: string;
  basePeriod: string;
  baseIndex: number;
  actualIndex: number;
  actualGrowth: number;
  actualAvailableAt: string;
  predictions: Record<ModelId, number>;
  growthPredictions: Record<ModelId, number>;
  intervals: Record<ModelId, ForecastInterval | null>;
};
export type ModelScore = {
  id: ModelId;
  label: string;
  maeGrowthPP: number | null;
  rmseIndex: number | null;
  n: number;
  intervalCoverage: number | null;
  intervalN: number;
};
export type MarketAnalysis = {
  origin: string;
  originDate: string;
  targetPeriod: string;
  horizon: Horizon;
  knownInputs: KnownInputs;
  models: ModelForecast[];
  backtest: BacktestRow[];
  scores: ModelScore[];
  warnings: string[];
};
export type AnalyzeOptions = {
  origin: string;
  horizon: Horizon;
  rateDelta?: number;
  minTraining?: number;
};

type FeatureRow = {
  origin: string;
  originDate: string;
  targetPeriod: string;
  target: QuarterObservation | undefined;
  known: KnownInputs;
  momentum: number | null;
  trend: number[] | null;
  rates: number[] | null;
};
type Pending = {
  row: FeatureRow;
  forecasts: ModelForecast[];
  calibrated: boolean;
};

export function quarterIndex(period: string): number {
  const match = /^(\d{4})-Q([1-4])$/.exec(period);
  if (!match || +match[1] < 1900 || +match[1] > 2199)
    throw new Error("Gebruik een geldig kwartaal, bijvoorbeeld 2021-Q4.");
  return +match[1] * 4 + +match[2] - 1;
}
function quarterFromIndex(value: number): string {
  return `${Math.floor(value / 4)}-Q${(value % 4) + 1}`;
}
export function quarterDate(period: string): string {
  const index = quarterIndex(period),
    year = Math.floor(index / 4),
    quarter = (index % 4) + 1;
  return new Date(Date.UTC(year, quarter * 3, 0)).toISOString().slice(0, 10);
}
export function addQuarters(period: string, count: number): string {
  if (!Number.isSafeInteger(count))
    throw new Error("Het aantal kwartalen moet een geheel getal zijn.");
  const result = quarterFromIndex(quarterIndex(period) + count);
  quarterIndex(result);
  return result;
}
export function compareQuarter(a: string, b: string): number {
  return quarterIndex(a) - quarterIndex(b);
}
function monthIndex(period: string): number {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  return match ? +match[1] * 12 + +match[2] - 1 : NaN;
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function knownAt(
  record: { periodEnd: string; availableAt: string } | undefined,
  date: string,
): boolean {
  return (
    !!record &&
    Number.isFinite(Date.parse(record.periodEnd)) &&
    Number.isFinite(Date.parse(record.availableAt)) &&
    record.periodEnd.slice(0, 10) <= date &&
    record.availableAt.slice(0, 10) <= date
  );
}
function positivePrice(
  record: QuarterObservation | undefined,
  date: string,
): record is QuarterObservation & { value: number } {
  return knownAt(record, date) && finite(record?.value) && record.value > 0;
}
const growth = (value: number, base: number) => 100 * (value / base - 1);

/** Candidate origins use completed quarters only, never dates beyond the source retrieval. */
export function forecastOrigins(data: MarketData): string[] {
  if (
    !data.prices.length ||
    !Number.isFinite(Date.parse(data.meta.retrievedAt))
  )
    return [];
  const start = Math.min(
    ...data.prices.map((price) => quarterIndex(price.period)),
  );
  const retrieved = data.meta.retrievedAt.slice(0, 10);
  const date = new Date(data.meta.retrievedAt);
  const end = date.getUTCFullYear() * 4 + Math.floor(date.getUTCMonth() / 3);
  const known = data.prices.filter(
    (price) => finite(price.value) && price.value > 0,
  );
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, i) =>
    quarterFromIndex(start + i),
  ).filter(
    (origin) =>
      quarterDate(origin) <= retrieved &&
      known.some((price) => positivePrice(price, quarterDate(origin))),
  );
}

function featureRows(
  data: MarketData,
  origin: string,
  horizon: Horizon,
): FeatureRow[] {
  const prices = [...data.prices].sort((a, b) =>
    compareQuarter(a.period, b.period),
  );
  const rates = data.rates
    .filter((rate) => rate.obsStatus !== "E")
    .sort((a, b) => monthIndex(a.period) - monthIndex(b.period));
  const priceMap = new Map(prices.map((price) => [price.period, price]));
  const rateMap = new Map(rates.map((rate) => [monthIndex(rate.period), rate]));
  const first = quarterIndex(prices[0].period),
    last = quarterIndex(origin);
  const rows: FeatureRow[] = [];
  for (let index = first; index <= last; index++) {
    const period = quarterFromIndex(index),
      date = quarterDate(period);
    const base = prices.filter((price) => positivePrice(price, date)).at(-1);
    if (!base || !finite(base.value)) continue;
    const records: InputRecord[] = [
      {
        kind: "price",
        period: base.period,
        value: base.value,
        availableAt: base.availableAt,
      },
    ];
    const previous = priceMap.get(addQuarters(base.period, -1));
    const previousYear = priceMap.get(addQuarters(base.period, -4));
    const quarterGrowth = positivePrice(previous, date)
      ? Math.log(base.value / previous.value)
      : null;
    const yearGrowth = positivePrice(previousYear, date)
      ? Math.log(base.value / previousYear.value)
      : null;
    if (positivePrice(previous, date))
      records.push({
        kind: "price",
        period: previous.period,
        value: previous.value,
        availableAt: previous.availableAt,
      });
    if (positivePrice(previousYear, date))
      records.push({
        kind: "price",
        period: previousYear.period,
        value: previousYear.value,
        availableAt: previousYear.availableAt,
      });
    const transactionRecords = Array.from({ length: 8 }, (_, i) =>
      priceMap.get(addQuarters(base.period, -i)),
    );
    let transactionGrowth: number | null = null;
    if (
      transactionRecords.every(
        (record) =>
          knownAt(record, date) &&
          finite(record?.transactions) &&
          record.transactions >= 0,
      )
    ) {
      const counts = transactionRecords.map((record) => record!.transactions!);
      const recent = counts.slice(0, 4).reduce((sum, count) => sum + count, 0),
        old = counts.slice(4).reduce((sum, count) => sum + count, 0);
      if (recent > 0 && old > 0) transactionGrowth = Math.log(recent / old);
      for (const record of transactionRecords)
        records.push({
          kind: "transactions",
          period: record!.period,
          value: record!.transactions!,
          availableAt: record!.availableAt,
        });
    }
    const rate = rates
      .filter((record) => knownAt(record, date) && finite(record.value))
      .at(-1);
    const oldRate = rate
      ? rateMap.get(monthIndex(rate.period) - 12)
      : undefined;
    const oldRateKnown = knownAt(oldRate, date) && finite(oldRate?.value);
    const rateChange =
      rate && finite(rate.value) && oldRateKnown
        ? rate.value - oldRate!.value!
        : null;
    if (rate && finite(rate.value))
      records.push({
        kind: "rate",
        period: rate.period,
        value: rate.value,
        availableAt: rate.availableAt,
      });
    if (oldRateKnown)
      records.push({
        kind: "rate",
        period: oldRate!.period,
        value: oldRate!.value!,
        availableAt: oldRate!.availableAt,
      });
    const targetPeriod = addQuarters(period, horizon),
      elapsed = compareQuarter(targetPeriod, base.period);
    // A stale base makes an apparent "one-quarter" prediction a different task.
    // Keep the audit inputs, but suppress extrapolation from a base older than two quarters.
    const fresh = compareQuarter(period, base.period) <= 2;
    const momentum =
      fresh && yearGrowth !== null ? (yearGrowth * elapsed) / 4 : null;
    const trend =
      fresh &&
      yearGrowth !== null &&
      quarterGrowth !== null &&
      transactionGrowth !== null
        ? [
            (yearGrowth * elapsed) / 4,
            quarterGrowth * elapsed,
            transactionGrowth,
          ]
        : null;
    const rateFeatures =
      trend && rate && finite(rate.value) && rateChange !== null
        ? [...trend, rate.value, rateChange]
        : null;
    rows.push({
      origin: period,
      originDate: date,
      targetPeriod,
      target: priceMap.get(targetPeriod),
      momentum,
      trend,
      rates: rateFeatures,
      known: {
        basePeriod: base.period,
        baseIndex: base.value,
        baseAvailableAt: base.availableAt,
        latestRatePeriod: rate?.period ?? null,
        latestRate: rate?.value ?? null,
        latestRateAvailableAt: rate?.availableAt ?? null,
        rateChange12m: rateChange,
        priceGrowth1q:
          quarterGrowth === null ? null : 100 * Math.expm1(quarterGrowth),
        priceGrowth4q:
          yearGrowth === null ? null : 100 * Math.expm1(yearGrowth),
        transactionGrowth4q:
          transactionGrowth === null
            ? null
            : 100 * Math.expm1(transactionGrowth),
        latestRateEstimated: rate?.obsStatus === "E",
        records,
      },
    });
  }
  return rows;
}

/** Partial-pivot elimination for a small positive-definite ridge system. */
function solve(matrix: number[][], right: number[]): number[] | null {
  const n = right.length,
    a = matrix.map((row, i) => [...row, right[i]]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++)
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    if (!finite(a[pivot][column]) || Math.abs(a[pivot][column]) < 1e-12)
      return null;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    const divisor = a[column][column];
    for (let j = column; j <= n; j++) a[column][j] /= divisor;
    for (let row = 0; row < n; row++)
      if (row !== column) {
        const factor = a[row][column];
        for (let j = column; j <= n; j++) a[row][j] -= factor * a[column][j];
      }
  }
  const result = a.map((row) => row[n]);
  return result.every(finite) ? result : null;
}
function ridgePrediction(
  train: { x: number[]; y: number }[],
  input: number[],
): number | null {
  const n = train.length,
    p = input.length;
  if (
    !n ||
    !train.every(
      (row) => row.x.length === p && row.x.every(finite) && finite(row.y),
    )
  )
    return null;
  const means = Array.from({ length: p }, (_, i) =>
    train.reduce((sum, row) => sum + row.x[i] / n, 0),
  );
  const scales = means.map(
    (mean, i) =>
      Math.sqrt(
        train.reduce((sum, row) => sum + (row.x[i] - mean) ** 2 / n, 0),
      ) || 1,
  );
  const average = train.reduce((sum, row) => sum + row.y / n, 0);
  const xx = Array.from({ length: p }, () => Array(p).fill(0) as number[]),
    xy = Array(p).fill(0) as number[];
  for (const row of train) {
    const z = row.x.map((value, i) => (value - means[i]) / scales[i]);
    for (let i = 0; i < p; i++) {
      xy[i] += z[i] * (row.y - average);
      for (let j = 0; j < p; j++) xx[i][j] += z[i] * z[j];
    }
  }
  for (let i = 0; i < p; i++) xx[i][i] += RIDGE_PENALTY;
  const coefficients = solve(xx, xy);
  if (!coefficients) return null;
  const prediction =
    average +
    input.reduce(
      (sum, value, i) =>
        sum + ((value - means[i]) / scales[i]) * coefficients[i],
      0,
    );
  return finite(prediction) ? prediction : null;
}
function quantile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b),
    position = (sorted.length - 1) * p,
    lower = Math.floor(position),
    fraction = position - lower;
  return (
    sorted[lower] +
    (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction
  );
}
function interval(
  prediction: number,
  residuals: number[],
): ForecastInterval | null {
  if (residuals.length < MIN_CALIBRATION) return null;
  const low = prediction * Math.exp(quantile(residuals, 0.1)),
    high = prediction * Math.exp(quantile(residuals, 0.9));
  return finite(low) && finite(high)
    ? {
        low,
        high,
        coverage: INTERVAL_COVERAGE,
        calibrationCount: residuals.length,
      }
    : null;
}
function predict(
  row: FeatureRow,
  id: ModelId,
  prior: FeatureRow[],
  residuals: number[],
  minimum: number,
  rateDelta = 0,
): ModelForecast {
  let logChange: number | null = null,
    trainingCount = 0,
    reason: string | undefined;
  const vector = id === "trend" ? row.trend : id === "rates" ? row.rates : null;
  if (id === "flat") logChange = 0;
  else if (id === "momentum") {
    logChange = row.momentum;
    if (logChange === null)
      reason = "Onvoldoende recente prijshistorie voor een trend.";
  } else if (!vector)
    reason = "Onvoldoende complete, op deze datum beschikbare invoergegevens.";
  else {
    const training = prior.flatMap((candidate) => {
      const x = id === "trend" ? candidate.trend : candidate.rates;
      return x && positivePrice(candidate.target, row.originDate)
        ? [
            {
              x,
              y: Math.log(candidate.target.value / candidate.known.baseIndex),
            },
          ]
        : [];
    });
    trainingCount = training.length;
    if (trainingCount < minimum)
      reason = `Minimaal ${minimum} voltooide trainingsvoorbeelden nodig (${trainingCount} beschikbaar).`;
    else {
      const adjusted = [...vector];
      if (id === "rates" && rateDelta) {
        adjusted[3] += rateDelta;
        adjusted[4] += rateDelta;
      }
      logChange = ridgePrediction(training, adjusted);
      if (logChange === null)
        reason = "De modelberekening is met deze invoer niet stabiel.";
    }
  }
  const raw =
    logChange === null ? null : row.known.baseIndex * Math.exp(logChange);
  const prediction = raw !== null && finite(raw) && raw > 0 ? raw : null;
  if (raw !== null && prediction === null)
    reason = "De berekende extrapolatie valt buiten het numerieke bereik.";
  return {
    id,
    label: labels[id],
    predictedIndex: prediction,
    growthFromKnown:
      prediction === null ? null : growth(prediction, row.known.baseIndex),
    basePeriod: row.known.basePeriod,
    targetPeriod: row.targetPeriod,
    trainingCount,
    interval:
      prediction === null || rateDelta !== 0
        ? null
        : interval(prediction, residuals),
    reason,
    scenarioRateDelta: id === "rates" ? rateDelta : 0,
    assumedRate:
      row.known.latestRate === null
        ? null
        : row.known.latestRate + (id === "rates" ? rateDelta : 0),
  };
}

/**
 * Expanding-window, direct-horizon forecasts. Each training row freezes inputs at
 * its own quarter-end, and its target may enter a fit/calibration set only after
 * the target's availableAt date. No scaler, label or residual sees a future value.
 * Current-vintage revisions remain a separate limitation stated in data metadata.
 */
export function analyzeMarket(
  data: MarketData,
  options: AnalyzeOptions,
): MarketAnalysis {
  const originDate = quarterDate(options.origin);
  if (![1, 4].includes(options.horizon))
    throw new Error("Kies een horizon van 1 of 4 kwartalen.");
  if (
    !Number.isFinite(Date.parse(data.meta.retrievedAt)) ||
    originDate > data.meta.retrievedAt.slice(0, 10)
  )
    throw new Error(
      "Kies een afgerond kwartaal op of vóór de ophaaldatum van de gegevens.",
    );
  const minimum = options.minTraining ?? DEFAULT_MIN_TRAINING,
    delta = options.rateDelta ?? 0;
  if (!Number.isSafeInteger(minimum) || minimum < 24 || minimum > 1000)
    throw new Error("Gebruik minimaal 24 trainingsvoorbeelden.");
  if (!finite(delta) || Math.abs(delta) > 5)
    throw new Error(
      "De rentesensitiviteit moet tussen −5 en +5 procentpunt liggen.",
    );
  if (!data.prices.length)
    throw new Error("Er zijn geen kwartaalprijzen beschikbaar.");
  const rows = featureRows(data, options.origin, options.horizon),
    current = rows.at(-1);
  if (!current || current.origin !== options.origin)
    throw new Error(
      "Op deze datum is nog geen gepubliceerde prijsbasis beschikbaar.",
    );
  const residuals: Record<ModelId, number[]> = {
    flat: [],
    momentum: [],
    trend: [],
    rates: [],
  };
  const pending: Pending[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    for (const completed of pending) {
      if (
        completed.calibrated ||
        !positivePrice(completed.row.target, row.originDate)
      )
        continue;
      for (const forecast of completed.forecasts)
        if (forecast.predictedIndex !== null)
          residuals[forecast.id].push(
            Math.log(completed.row.target.value / forecast.predictedIndex),
          );
      completed.calibrated = true;
    }
    const prior = rows.slice(0, i);
    pending.push({
      row,
      forecasts: modelOrder.map((id) =>
        predict(row, id, prior, residuals[id], minimum),
      ),
      calibrated: false,
    });
  }
  const last = pending.at(-1)!;
  const models = last.forecasts.map((forecast) =>
    forecast.id === "rates" && delta !== 0
      ? predict(
          current,
          "rates",
          rows.slice(0, -1),
          residuals.rates,
          minimum,
          delta,
        )
      : forecast,
  );
  const backtest: BacktestRow[] = pending.flatMap((entry) => {
    if (
      !positivePrice(entry.row.target, originDate) ||
      entry.forecasts.some((forecast) => forecast.predictedIndex === null)
    )
      return [];
    const predictions = Object.fromEntries(
      entry.forecasts.map((forecast) => [
        forecast.id,
        forecast.predictedIndex!,
      ]),
    ) as Record<ModelId, number>;
    return [
      {
        origin: entry.row.origin,
        originDate: entry.row.originDate,
        targetPeriod: entry.row.targetPeriod,
        basePeriod: entry.row.known.basePeriod,
        baseIndex: entry.row.known.baseIndex,
        actualIndex: entry.row.target.value,
        actualGrowth: growth(entry.row.target.value, entry.row.known.baseIndex),
        actualAvailableAt: entry.row.target.availableAt,
        predictions,
        growthPredictions: Object.fromEntries(
          modelOrder.map((id) => [
            id,
            growth(predictions[id], entry.row.known.baseIndex),
          ]),
        ) as Record<ModelId, number>,
        intervals: Object.fromEntries(
          entry.forecasts.map((forecast) => [forecast.id, forecast.interval]),
        ) as Record<ModelId, ForecastInterval | null>,
      },
    ];
  });
  const scores: ModelScore[] = modelOrder.map((id) => {
    const n = backtest.length,
      covered = backtest.filter((row) => row.intervals[id] !== null);
    return {
      id,
      label: labels[id],
      n,
      maeGrowthPP: n
        ? backtest.reduce(
            (sum, row) =>
              sum + Math.abs(row.growthPredictions[id] - row.actualGrowth) / n,
            0,
          )
        : null,
      rmseIndex: n
        ? Math.sqrt(
            backtest.reduce(
              (sum, row) =>
                sum + (row.predictions[id] - row.actualIndex) ** 2 / n,
              0,
            ),
          )
        : null,
      intervalCoverage: covered.length
        ? covered.filter(
            (row) =>
              row.actualIndex >= row.intervals[id]!.low &&
              row.actualIndex <= row.intervals[id]!.high,
          ).length / covered.length
        : null,
      intervalN: covered.length,
    };
  });
  const warnings = [
    "Beschikbaarheidsdatums zijn conservatief gereconstrueerd. De huidige bronversie bevat mogelijke latere revisies; dit is geen backtest met oorspronkelijke publicatieversies.",
    "De 80%-band gebruikt uitsluitend eerder voltooide voorspelfouten. Het is een historische foutband, geen gegarandeerde toekomstige dekking.",
    "Door de bron als geschat gemarkeerde rentewaarden (2000–2002) zijn uitgesloten van de invoer en training.",
    "Renteverbanden zijn voorspellende associaties. De rentegevoeligheid is een conditionele invoerwijziging en geen causaal effect of marktraming.",
  ];
  if (delta !== 0)
    warnings.push(
      "De aangepaste rente verandert alleen de huidige rentevoorspelling. Historische scores blijven gelijk; voor deze gevoeligheidsvariant wordt geen foutband getoond.",
    );
  if (
    models.some(
      (model) => model.interval === null && model.predictedIndex !== null,
    ) &&
    !delta
  )
    warnings.push(
      `Voor sommige modellen zijn minder dan ${MIN_CALIBRATION} eerder voltooide voorspelfouten beschikbaar; hun foutband blijft leeg.`,
    );
  return {
    origin: options.origin,
    originDate,
    targetPeriod: current.targetPeriod,
    horizon: options.horizon,
    knownInputs: current.known,
    models,
    backtest,
    scores,
    warnings,
  };
}
