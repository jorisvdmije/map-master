import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  loadMarketData,
  validateMarketData,
  marketAvailableAt,
  marketPeriodEnd,
} from "../src/market/data.ts";
const raw = JSON.parse(
  readFileSync(new URL("../public/data/market.json", import.meta.url), "utf8"),
);
test("official market snapshots retain quarterly Amsterdam prices and monthly national rates", () => {
  const data = validateMarketData(raw);
  assert.equal(data.prices[0].period, "1995-Q1");
  assert.equal(data.meta.rateGeography, "Nederland");
  assert.equal(data.meta.priceUnit, "index 2020=100");
  assert.ok(data.prices.length >= 120 && data.rates.length >= 300);
  assert.ok(data.rates.some((r) => r.obsStatus === "E"));
  assert.equal(data.meta.availability.mode, "reconstructed");
});
test("quarter/month end dates and assumed 60-day availability handle leap years exactly", () => {
  assert.equal(marketPeriodEnd("2020-02", "month"), "2020-02-29");
  assert.equal(marketPeriodEnd("2021-Q3", "quarter"), "2021-09-30");
  assert.equal(marketAvailableAt("2021-09-30"), "2021-11-29");
  assert.throws(() => marketPeriodEnd("2021-Q5", "quarter"));
});
test("market loader fetches only its local snapshot and verifies normalized source checksum", async () => {
  const requested: string[] = [];
  const request = async (input: Parameters<typeof fetch>[0]) => {
    requested.push(String(input));
    return new Response(JSON.stringify(raw));
  };
  const data = await loadMarketData(undefined, request as typeof fetch);
  assert.deepEqual(requested, ["/data/market.json"]);
  assert.equal(data.prices.length, raw.prices.length);
  const changed = structuredClone(raw);
  changed.prices[10].value *= 1.01;
  await assert.rejects(
    loadMarketData(
      undefined,
      (async () => new Response(JSON.stringify(changed))) as typeof fetch,
    ),
    /controlewaarde/,
  );
});
test("wrong geography, rates units, missing periods and availability dates reject atomically", () => {
  for (const mutate of [
    (d: typeof raw) => {
      d.meta.rateGeography = "Amsterdam";
    },
    (d: typeof raw) => {
      d.meta.rateUnit = "index";
    },
    (d: typeof raw) => {
      d.prices.splice(5, 1);
    },
    (d: typeof raw) => {
      d.rates[1].period = d.rates[0].period;
    },
    (d: typeof raw) => {
      d.prices[10].availableAt = d.prices[10].periodEnd;
    },
    (d: typeof raw) => {
      d.prices[3].value = NaN;
    },
  ]) {
    const changed = structuredClone(raw);
    mutate(changed);
    assert.throws(() => validateMarketData(changed));
  }
});
test("unknown observations remain null and published zero transactions remain zero", () => {
  const changed = structuredClone(raw);
  changed.prices[4].value = null;
  changed.prices[4].transactions = 0;
  changed.rates[20].value = null;
  const result = validateMarketData(changed);
  assert.equal(result.prices[4].value, null);
  assert.equal(result.prices[4].transactions, 0);
  assert.equal(result.rates[20].value, null);
});
test("cancellation and source errors never return an empty invented market", async () => {
  const c = new AbortController();
  c.abort();
  let requests = 0;
  await assert.rejects(
    loadMarketData(c.signal, (async () => {
      requests++;
      return new Response("");
    }) as typeof fetch),
    { name: "AbortError" },
  );
  assert.equal(requests, 0);
  await assert.rejects(
    loadMarketData(
      undefined,
      (async () => new Response("", { status: 503 })) as typeof fetch,
    ),
    /konden niet worden geladen/,
  );
});
