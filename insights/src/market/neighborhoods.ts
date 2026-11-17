import {
  crossesBreak,
  getValue,
  percentChange,
  type Dataset,
} from "../data/model";

export type NeighborhoodRow = {
  code: string;
  name: string;
  actualGrowth: number;
  expectedGrowth: number;
  residual: number;
  woz: number;
  homes: number;
  stockGrowth: number;
};
export type NeighborhoodReport = {
  year: number | null;
  availableAt: string | null;
  rows: NeighborhoodRow[];
  benchmarkGrowth: number | null;
  trainingYears: number[];
  trainingCount: number;
  fitted: boolean;
  excluded: number;
  features: string[];
  limitation: string;
};
const median = (values: number[]) => {
  const a = [...values].sort((x, y) => x - y);
  return a.length % 2
    ? a[Math.floor(a.length / 2)]
    : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};
const labels = [
  "WOZ-niveau vorig jaar",
  "Eerdere WOZ-groei",
  "Omvang woningvoorraad",
  "Eerdere voorraadgroei",
];
export const NEIGHBORHOOD_LIMITATION =
  "Historische WOZ-analyse met huidige bronversies. Als voorzichtige aanname zijn buurtcijfers pas vanaf 1 januari van het volgende bronjaar bruikbaar. De verwachte groei is conditioneel op de gerealiseerde mediaan van het meetjaar; dit is geen voorspelling van toekomstige verkoopprijzen.";
function sample(dataset: Dataset, year: number) {
  const rows: {
    code: string;
    name: string;
    x: number[];
    growth: number;
    woz: number;
    homes: number;
    stockGrowth: number;
  }[] = [];
  for (const area of dataset.areas) {
    if (crossesBreak(area, year - 2, year) || year === 2015 || year === 2016)
      continue;
    const value = getValue(dataset, area.code, year, "woz"),
      prior = getValue(dataset, area.code, year - 1, "woz"),
      older = getValue(dataset, area.code, year - 2, "woz");
    const stock = getValue(dataset, area.code, year, "homes"),
      previousStock = getValue(dataset, area.code, year - 1, "homes"),
      olderStock = getValue(dataset, area.code, year - 2, "homes");
    if (
      value === null ||
      prior === null ||
      older === null ||
      stock === null ||
      previousStock === null ||
      olderStock === null ||
      prior <= 0 ||
      older <= 0 ||
      stock < 100 ||
      previousStock < 100 ||
      olderStock < 100
    )
      continue;
    const growth = percentChange(prior, value),
      priorGrowth = percentChange(older, prior),
      stockGrowth = percentChange(previousStock, stock),
      priorStockGrowth = percentChange(olderStock, previousStock);
    if (
      growth === null ||
      priorGrowth === null ||
      stockGrowth === null ||
      priorStockGrowth === null ||
      Math.abs(stockGrowth) > 20 ||
      Math.abs(priorStockGrowth) > 20
    )
      continue;
    rows.push({
      code: area.code,
      name: area.name,
      x: [
        Math.log(prior),
        priorGrowth,
        Math.log(previousStock),
        priorStockGrowth,
      ],
      growth,
      woz: value,
      homes: stock,
      stockGrowth,
    });
  }
  return rows;
}
function solve(a: number[][], b: number[]): number[] | null {
  const m = a.map((r, i) => [...r, b[i]]),
    n = b.length;
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r;
    if (Math.abs(m[pivot][c]) < 1e-10) return null;
    [m[c], m[pivot]] = [m[pivot], m[c]];
    const d = m[c][c];
    for (let j = c; j <= n; j++) m[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c];
      for (let j = c; j <= n; j++) m[r][j] -= f * m[c][j];
    }
  }
  const result = m.map((r) => r[n]);
  return result.every(Number.isFinite) ? result : null;
}
export function neighborhoodReport(
  dataset: Dataset,
  originDate: string,
): NeighborhoodReport {
  const date = Date.parse(originDate);
  if (!Number.isFinite(date))
    throw new Error("Ongeldige informatiegrens voor de buurtanalyse.");
  const years = dataset.years.filter(
    (year) => Date.parse(`${year + 1}-01-01`) <= date,
  );
  const candidates = years
    .map((year) => ({ year, rows: sample(dataset, year) }))
    .filter((s) => s.rows.length >= 3);
  const latest = candidates.at(-1);
  const empty: NeighborhoodReport = {
    year: null,
    availableAt: null,
    rows: [],
    benchmarkGrowth: null,
    trainingYears: [],
    trainingCount: 0,
    fitted: false,
    excluded: dataset.areas.length,
    features: labels,
    limitation: NEIGHBORHOOD_LIMITATION,
  };
  if (!latest) return empty;
  const training = candidates.filter((s) => s.year < latest.year);
  const train = training.flatMap((s) => {
    const base = median(s.rows.map((r) => r.growth));
    return s.rows.map((r) => ({ x: r.x, y: r.growth - base }));
  });
  const n = train.length,
    p = labels.length;
  const means = Array.from({ length: p }, (_, j) =>
    n ? train.reduce((s, r) => s + r.x[j] / n, 0) : 0,
  );
  const scales = means.map(
    (mean, j) =>
      Math.sqrt(
        n ? train.reduce((s, r) => s + (r.x[j] - mean) ** 2 / n, 0) : 0,
      ) || 1,
  );
  const yMean = n ? train.reduce((s, r) => s + r.y / n, 0) : 0;
  const xx = Array.from({ length: p }, () => Array(p).fill(0) as number[]),
    xy = Array(p).fill(0) as number[];
  for (const row of train) {
    const x = row.x.map((v, j) => (v - means[j]) / scales[j]);
    for (let j = 0; j < p; j++) {
      xy[j] += x[j] * (row.y - yMean);
      for (let k = 0; k < p; k++) xx[j][k] += x[j] * x[k];
    }
  }
  for (let j = 0; j < p; j++) xx[j][j] += Math.max(10, n * 0.1);
  const beta = training.length >= 3 && n >= 200 ? solve(xx, xy) : null;
  const benchmark = median(latest.rows.map((r) => r.growth));
  const rows = latest.rows
    .map((row) => {
      const adjustment = beta
        ? yMean +
          row.x.reduce(
            (s, v, j) => s + (beta[j] * (v - means[j])) / scales[j],
            0,
          )
        : 0;
      const expectedGrowth = benchmark + adjustment;
      return {
        code: row.code,
        name: row.name,
        actualGrowth: row.growth,
        expectedGrowth,
        residual: row.growth - expectedGrowth,
        woz: row.woz,
        homes: row.homes,
        stockGrowth: row.stockGrowth,
      };
    })
    .sort((a, b) => b.residual - a.residual || a.code.localeCompare(b.code));
  return {
    year: latest.year,
    availableAt: `${latest.year + 1}-01-01`,
    rows,
    benchmarkGrowth: benchmark,
    trainingYears: training.map((s) => s.year),
    trainingCount: n,
    fitted: !!beta,
    excluded: dataset.areas.length - rows.length,
    features: labels,
    limitation: NEIGHBORHOOD_LIMITATION,
  };
}
