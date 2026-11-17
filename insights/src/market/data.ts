export type QuarterObservation = {
  /** Amsterdam CBS existing owner-occupied house-price index, 2020=100. */
  period: string;
  value: number | null;
  transactions: number | null;
  periodEnd: string;
  /** Reconstructed availability assumption, not an archived first-release date. */
  availableAt: string;
};
export type MonthObservation = {
  /** National Dutch new-business house-purchase lending rate, percent per annum. */
  period: string;
  value: number | null;
  periodEnd: string;
  availableAt: string;
  /** A=normal; E=source-estimated. ECB flags 2000–2002 as estimated. */
  obsStatus?: string;
};
export type MarketSource = {
  url: string;
  sha256: string;
  definition: string;
  records: number;
  retrievedAt?: string;
};
export type MarketData = {
  prices: QuarterObservation[];
  rates: MonthObservation[];
  meta: {
    version: 1;
    retrievedAt: string;
    priceUnit: "index 2020=100";
    rateUnit: "% per jaar";
    transactionUnit: "verkochte woningen";
    geography: "Amsterdam";
    rateGeography: "Nederland";
    cbsTable: "85792NED";
    cbsRegion: "GM0363";
    cbsTableModified: string;
    ecbSeries: "MIR.M.NL.B.A2C.A.R.A.2250.EUR.N";
    availability: {
      mode: "reconstructed";
      priceLagDays: 60;
      rateLagDays: 60;
      limitation: string;
    };
    definitions: {
      price: string;
      transactions: string;
      rate: string;
    };
    notes: string[];
    methods: { title: string; url: string }[];
    sources: MarketSource[];
    sha256: string;
  };
};

export const MARKET_CBS_ROOT =
  "https://opendata.cbs.nl/ODataApi/OData/85792NED/";
export const MARKET_ECB_SERIES = "MIR.M.NL.B.A2C.A.R.A.2250.EUR.N";
export const MARKET_ECB_URL =
  "https://data-api.ecb.europa.eu/service/data/MIR/M.NL.B.A2C.A.R.A.2250.EUR.N?startPeriod=1995-01&format=csvdata";
export const MARKET_AVAILABILITY_LIMITATION =
  "Dit is de huidige downloadversie, geen archief van destijds gepubliceerde dataversies. Beschikbaarheid is gereconstrueerd als periode-einde + 60 kalenderdagen; dit zijn aannames, geen geverifieerde eerste publicatiedata. Latere revisies, herbaseringen en definitiewijzigingen kunnen in de historische waarden zitten. De terugblik beperkt datums, maar is geen volledig real-time vintage-backtest.";

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function fail(): never {
  throw new Error(
    "De woningmarktdata hebben een onverwacht formaat. De bestaande analyse is bewaard.",
  );
}
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    datePattern.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
  );
}

export function marketPeriodEnd(
  period: string,
  frequency: "quarter" | "month",
): string {
  const match =
    frequency === "quarter"
      ? /^(\d{4})-Q([1-4])$/.exec(period)
      : /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) return fail();
  const year = Number(match[1]),
    month = frequency === "quarter" ? Number(match[2]) * 3 : Number(match[2]);
  if (year < 1995 || year > 2100) return fail();
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export function marketAvailableAt(periodEnd: string, lagDays = 60): string {
  if (
    !validDate(periodEnd) ||
    !Number.isSafeInteger(lagDays) ||
    lagDays < 0 ||
    lagDays > 366
  )
    return fail();
  return new Date(Date.parse(`${periodEnd}T00:00:00.000Z`) + lagDays * 86400000)
    .toISOString()
    .slice(0, 10);
}

const numberOrNull = (value: unknown, positive = false): boolean =>
  value === null ||
  (typeof value === "number" &&
    Number.isFinite(value) &&
    (positive ? value > 0 : value >= 0));
function periodPosition(
  period: string,
  frequency: "quarter" | "month",
): number {
  return (
    Number(period.slice(0, 4)) * (frequency === "quarter" ? 4 : 12) +
    Number(frequency === "quarter" ? period.at(-1) : period.slice(-2))
  );
}

export function validateMarketData(value: unknown): MarketData {
  if (
    !object(value) ||
    !object(value.meta) ||
    !Array.isArray(value.prices) ||
    !Array.isArray(value.rates)
  )
    return fail();
  const data = value as unknown as MarketData,
    meta = data.meta;
  if (
    meta.version !== 1 ||
    typeof meta.retrievedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
      meta.retrievedAt,
    ) ||
    !validDate(meta.retrievedAt.slice(0, 10)) ||
    !Number.isFinite(Date.parse(meta.retrievedAt)) ||
    meta.priceUnit !== "index 2020=100" ||
    meta.rateUnit !== "% per jaar" ||
    meta.transactionUnit !== "verkochte woningen" ||
    meta.geography !== "Amsterdam" ||
    meta.rateGeography !== "Nederland" ||
    meta.cbsTable !== "85792NED" ||
    meta.cbsRegion !== "GM0363" ||
    meta.ecbSeries !== MARKET_ECB_SERIES ||
    typeof meta.cbsTableModified !== "string" ||
    !Number.isFinite(Date.parse(meta.cbsTableModified)) ||
    !object(meta.availability) ||
    meta.availability.mode !== "reconstructed" ||
    meta.availability.priceLagDays !== 60 ||
    meta.availability.rateLagDays !== 60 ||
    meta.availability.limitation !== MARKET_AVAILABILITY_LIMITATION ||
    !object(meta.definitions) ||
    !["price", "transactions", "rate"].every(
      (key) =>
        typeof meta.definitions[key as keyof typeof meta.definitions] ===
          "string" &&
        meta.definitions[key as keyof typeof meta.definitions].length > 20,
    ) ||
    !Array.isArray(meta.notes) ||
    !meta.notes.every((note) => typeof note === "string") ||
    !Array.isArray(meta.methods) ||
    !meta.methods.length ||
    !meta.methods.every(
      (method) =>
        object(method) &&
        typeof method.title === "string" &&
        typeof method.url === "string",
    ) ||
    !Array.isArray(meta.sources) ||
    meta.sources.length < 2 ||
    meta.sources.length > 30 ||
    !/^[a-f0-9]{64}$/.test(meta.sha256) ||
    !data.prices.length ||
    data.prices.length > 500 ||
    !data.rates.length ||
    data.rates.length > 1500
  )
    return fail();
  const retrievalDay = meta.retrievedAt.slice(0, 10);
  for (const frequency of ["quarter", "month"] as const) {
    const observations = frequency === "quarter" ? data.prices : data.rates;
    let previous = -Infinity;
    for (const observation of observations) {
      if (!object(observation) || typeof observation.period !== "string")
        return fail();
      const expectedEnd = marketPeriodEnd(observation.period, frequency),
        position = periodPosition(observation.period, frequency);
      if (
        !validDate(observation.periodEnd) ||
        !validDate(observation.availableAt) ||
        observation.periodEnd !== expectedEnd ||
        observation.availableAt !== marketAvailableAt(expectedEnd) ||
        observation.periodEnd > retrievalDay ||
        position <= previous ||
        (previous !== -Infinity && position !== previous + 1) ||
        !numberOrNull(observation.value, frequency === "quarter")
      )
        return fail();
      if (frequency === "quarter") {
        const price = observation as QuarterObservation;
        if (
          !numberOrNull(price.transactions) ||
          (price.transactions !== null &&
            !Number.isSafeInteger(price.transactions))
        )
          return fail();
      } else {
        const rate = observation as MonthObservation;
        if (
          (rate.value !== null && rate.value > 100) ||
          (rate.obsStatus !== undefined &&
            (typeof rate.obsStatus !== "string" ||
              !/^[A-Z]$/.test(rate.obsStatus)))
        )
          return fail();
      }
      previous = position;
    }
  }
  if (data.prices[0].period !== "1995-Q1" || data.rates[0].period !== "2000-01")
    return fail();
  const urls = new Set<string>();
  let hasPrices = false,
    hasRates = false;
  for (const source of meta.sources) {
    if (
      !object(source) ||
      typeof source.url !== "string" ||
      !/^[a-f0-9]{64}$/.test(source.sha256) ||
      typeof source.definition !== "string" ||
      source.definition.length < 10 ||
      !Number.isSafeInteger(source.records) ||
      source.records < 0 ||
      (source.retrievedAt !== undefined &&
        (typeof source.retrievedAt !== "string" ||
          !Number.isFinite(Date.parse(source.retrievedAt)) ||
          Date.parse(source.retrievedAt) > Date.parse(meta.retrievedAt)))
    )
      return fail();
    const url = new URL(source.url);
    if (url.username || url.password || url.hash || urls.has(url.href))
      return fail();
    urls.add(url.href);
    if (
      url.origin === "https://opendata.cbs.nl" &&
      url.pathname.startsWith("/ODataApi/OData/85792NED/")
    ) {
      if (url.pathname.endsWith("/TypedDataSet")) {
        if (url.searchParams.get("$filter") !== "RegioS eq 'GM0363'")
          return fail();
        hasPrices = true;
      }
    } else if (url.href === MARKET_ECB_URL) hasRates = true;
    else return fail();
  }
  if (
    !hasPrices ||
    !hasRates ||
    !data.prices.some((observation) => observation.value !== null) ||
    !data.rates.some((observation) => observation.value !== null)
  )
    return fail();
  return structuredClone(data);
}

export async function loadMarketData(
  signal?: AbortSignal,
  request: typeof fetch = fetch,
): Promise<MarketData> {
  signal?.throwIfAborted();
  const base =
    (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env
      ?.BASE_URL ?? "/";
  const response = await request(`${base}data/market.json`, { signal });
  if (!response.ok)
    throw new Error(
      "De woningmarktdata konden niet worden geladen. Probeer opnieuw.",
    );
  const text = await response.text();
  if (text.length > 2 * 1024 * 1024) return fail();
  const data = validateMarketData(JSON.parse(text));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify({ prices: data.prices, rates: data.rates }),
    ),
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== data.meta.sha256)
    throw new Error("De controlewaarde van de woningmarktdata klopt niet.");
  signal?.throwIfAborted();
  return data;
}
