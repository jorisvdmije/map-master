import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile, readFile, stat } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';

const {
  MARKET_AVAILABILITY_LIMITATION, MARKET_CBS_ROOT, MARKET_ECB_URL, MARKET_ECB_SERIES,
  marketPeriodEnd, marketAvailableAt, validateMarketData,
} = await tsImport('../src/market/data.ts', import.meta.url);

const hash = (value) => createHash('sha256').update(value).digest('hex');
const sources = [];

function trustedCbsPage(value, first) {
  const url = new URL(value), initial = new URL(first);
  assert.equal(url.origin, 'https://opendata.cbs.nl');
  assert.equal(url.pathname, initial.pathname);
  assert.ok(!url.username && !url.password && !url.hash);
  for (const [key, item] of initial.searchParams) assert.equal(url.searchParams.get(key), item, `CBS pagination changed ${key}`);
  for (const key of url.searchParams.keys()) assert.ok(initial.searchParams.has(key) || key === '$skiptoken' || key === '$skip', 'Unexpected CBS continuation filter');
  return url.href;
}
async function cbs(table, definition, query = '') {
  const first = `${MARKET_CBS_ROOT}${table}?${query ? `${query}&` : ''}$format=json`;
  const rows = [], seen = new Set();
  let next = first;
  while (next) {
    const url = trustedCbsPage(next, first);
    assert.ok(!seen.has(url) && seen.size < 10, 'Repeated CBS page'); seen.add(url);
    const response = await fetch(url, { signal: AbortSignal.timeout(45000), redirect: 'error' });
    assert.ok(response.ok, `CBS ${response.status}`);
    const raw = await response.text();
    assert.ok(raw.length < 10 * 1024 * 1024, 'CBS page is unexpectedly large');
    const data = JSON.parse(raw);
    assert.ok(Array.isArray(data.value));
    sources.push({ url, sha256: hash(raw), definition, records: data.value.length, retrievedAt: new Date().toISOString() });
    rows.push(...data.value);
    next = data['odata.nextLink'];
  }
  return rows;
}
function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\r' || c === '\n')) {
      row.push(field); field = '';
      if (c !== ',') { if (row.some(Boolean)) rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else field += c;
  }
  assert.ok(!quoted, 'Unclosed ECB CSV field');
  row.push(field); if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift();
  assert.ok(headers && new Set(headers).size === headers.length && rows.length && rows.every((r) => r.length === headers.length));
  return rows.map((values) => Object.fromEntries(headers.map((header, i) => [header, values[i]])));
}
async function ecb() {
  // A previously captured official response can be normalized explicitly when the public API is down.
  // Its content still undergoes the exact same series/dimension validation and receives its real file timestamp.
  const fileFlag = process.argv.indexOf('--ecb-response-file');
  let raw, retrievedAt;
  if (fileFlag >= 0) {
    const path = process.argv[fileFlag + 1];
    assert.ok(path, 'Missing captured ECB response path');
    raw = await readFile(path, 'utf8');
    retrievedAt = (await stat(path)).mtime.toISOString();
  } else {
    const response = await fetch(MARKET_ECB_URL, { signal: AbortSignal.timeout(45000), redirect: 'error' });
    assert.ok(response.ok, `ECB ${response.status}`);
    raw = await response.text();
    retrievedAt = new Date().toISOString();
  }
  assert.ok(raw.length < 5 * 1024 * 1024, 'ECB response unexpectedly large');
  const rows = parseCsv(raw);
  sources.push({ url: MARKET_ECB_URL, sha256: hash(raw), records: rows.length, retrievedAt,
    definition: 'ECB MIR: Dutch MFI new-business house-purchase lending to households and NPISH, all initial rate fixations, AAR/NDER, percent per annum. Includes renegotiated agreements; not advertised mortgage offers.' });
  return rows;
}

const [information, properties, regions, cbsRows, ecbRows] = await Promise.all([
  cbs('TableInfos', 'CBS table metadata, update date, frequency and statistical definitions'),
  cbs('DataProperties', 'CBS field metadata; confirms sale price index 2020=100 and transaction counts'),
  cbs('RegioS', 'CBS regional dimension; confirms GM0363 is Amsterdam'),
  cbs('TypedDataSet', 'CBS quarterly Amsterdam existing house-price index and registered transactions', "$filter=RegioS%20eq%20%27GM0363%27"),
  ecb(),
]);
assert.equal(information.length, 1); assert.equal(information[0].Identifier, '85792NED');
assert.equal(information[0].Frequency, 'Perkwartaal');
assert.equal(regions.find((region) => region.Key === 'GM0363')?.Title, 'Amsterdam');
assert.equal(properties.find((property) => property.Key === 'PrijsindexVerkoopprijzen_1')?.Unit, '2020=100');
assert.equal(properties.find((property) => property.Key === 'VerkochteWoningen_4')?.Unit, 'aantal');
const prices = cbsRows.filter((row) => /^\d{4}KW0[1-4]$/.test(row.Perioden)).map((row) => {
  assert.equal(row.RegioS, 'GM0363');
  const period = `${row.Perioden.slice(0, 4)}-Q${row.Perioden.at(-1)}`;
  const periodEnd = marketPeriodEnd(period, 'quarter');
  assert.ok(row.PrijsindexVerkoopprijzen_1 === null || (typeof row.PrijsindexVerkoopprijzen_1 === 'number' && Number.isFinite(row.PrijsindexVerkoopprijzen_1) && row.PrijsindexVerkoopprijzen_1 > 0));
  assert.ok(row.VerkochteWoningen_4 === null || (Number.isSafeInteger(row.VerkochteWoningen_4) && row.VerkochteWoningen_4 >= 0));
  return { period, value: row.PrijsindexVerkoopprijzen_1, transactions: row.VerkochteWoningen_4, periodEnd, availableAt: marketAvailableAt(periodEnd) };
}).sort((a, b) => a.period.localeCompare(b.period));

const rates = ecbRows.map((row) => {
  assert.equal(row.KEY, MARKET_ECB_SERIES); assert.equal(row.FREQ, 'M'); assert.equal(row.REF_AREA, 'NL');
  assert.equal(row.BS_ITEM, 'A2C'); assert.equal(row.MATURITY_NOT_IRATE, 'A'); assert.equal(row.DATA_TYPE_MIR, 'R');
  assert.equal(row.BS_COUNT_SECTOR, '2250'); assert.equal(row.CURRENCY_TRANS, 'EUR'); assert.equal(row.IR_BUS_COV, 'N');
  assert.equal(row.UNIT, 'PCPA'); assert.equal(row.UNIT_MULT, '0');
  assert.ok(row.TITLE_COMPL.includes('New business coverage') && row.TITLE_COMPL.includes('Lending for house purchase'));
  const period = row.TIME_PERIOD, periodEnd = marketPeriodEnd(period, 'month');
  const value = row.OBS_VALUE === '' ? null : Number(row.OBS_VALUE);
  assert.ok(value === null || (Number.isFinite(value) && value >= 0 && value < 100));
  assert.ok(/^[A-Z]$/.test(row.OBS_STATUS));
  return { period, value, periodEnd, availableAt: marketAvailableAt(periodEnd), obsStatus: row.OBS_STATUS };
}).sort((a, b) => a.period.localeCompare(b.period));

assert.ok(prices.length >= 120 && rates.length >= 300, 'Unexpectedly incomplete market history');
const payload = { prices, rates };
const data = {
  ...payload,
  meta: {
    version: 1, retrievedAt: new Date().toISOString(), priceUnit: 'index 2020=100', rateUnit: '% per jaar',
    transactionUnit: 'verkochte woningen', geography: 'Amsterdam', rateGeography: 'Nederland',
    cbsTable: '85792NED', cbsRegion: 'GM0363', cbsTableModified: information[0].Modified,
    ecbSeries: MARKET_ECB_SERIES,
    availability: { mode: 'reconstructed', priceLagDays: 60, rateLagDays: 60, limitation: MARKET_AVAILABILITY_LIMITATION },
    definitions: {
      price: 'CBS/Kadaster prijsindex bestaande koopwoningen in Amsterdam, basisjaar 2020=100, kwartaalcijfers. SPAR-methode op geregistreerde verkopen en WOZ-waarden. Geen gemiddelde verkoopprijs of prijs per m².',
      transactions: 'Aantal bij het Kadaster geregistreerde verkopen van bestaande woningen aan particulieren in Amsterdam, gemeten aan het einde van het kwartaal. Geen telling van op Funda aangeboden of bij makelaars verkochte woningen.',
      rate: 'ECB MIR, Nederlandse banken en overige rapporterende MFI’s: nieuw overeengekomen leningen voor woningaankoop aan huishoudens en instellingen zonder winstoogmerk ten behoeve van huishoudens, alle initiële rentevastperioden. AAR/NDER in procent per jaar; nieuwe contracten inclusief heronderhandelingen. Geen actuele advertentierente en geen gemiddelde rente over de uitstaande hypotheekvoorraad.',
    },
    notes: [
      'CBS-prijsindex en transacties betreffen Amsterdam (GM0363); de hypotheekrente is een landelijke Nederlandse indicator. De rente is niet specifiek voor Amsterdam.',
      'Prijsindex beschikbaar vanaf 1995-Q1. De geselecteerde ECB-reeks begint in 2000-01; eerdere rentes worden niet aangevuld of geëxtrapoleerd.',
      'ECB markeert 2000-01 tot en met 2002-12 als E (estimated). Vanaf 2003-01 hebben de huidige bronwaarnemingen status A (normal). Deze vroege bronschattingen zijn behouden en herkenbaar; het zijn geen door Atlas bedachte waarden.',
      'CBS beschrijft de PBK als direct definitief, met revisies bij uitzonderlijke fouten; herbasering en uitzonderlijke revisies kunnen historische waarden beïnvloeden. ECB-rentestatistieken kunnen worden herzien. Dit bestand bewaart alleen de nu gedownloade versie.',
      'De beschikbaarheidsaanname van 60 kalenderdagen is bewust ruimer dan CBS ongeveer 22 dagen en ECB 23 werkdagen. Dit is geen garantie voor iedere historische publicatie. Reconstructie van bronbeschikbaarheid is onderscheiden van echte gearchiveerde publicatievintages.',
      'Ook reeds gedownloade recente observaties worden in de terugblik pas toegestaan op hun aangenomen availableAt-datum. Daardoor kan availableAt later liggen dan deze downloaddatum.',
      'Geen nieuwbouw, individuele taxatie, vierkantemeterprijs, inflatiecorrectie of gemeentelijke hypotheekrente wordt uit deze reeksen afgeleid.',
    ],
    methods: [
      { title: 'CBS prijsindex en transacties per regio', url: 'https://www.cbs.nl/nl-nl/cijfers/detail/85792NED' },
      { title: 'CBS PBK-methode en publicatiestrategie', url: 'https://www.cbs.nl/nl-nl/onze-diensten/methoden/onderzoeksomschrijvingen/korte-onderzoeksomschrijvingen/prijsindex-bestaande-koopwoningen--pbk---2020-100' },
      { title: 'ECB MIR-definities en publicatieschema', url: 'https://www.ecb.europa.eu/stats/financial_markets_and_interest_rates/bank_interest_rates/mfi_interest_rates/html/index.en.html' },
      { title: 'ECB-reeks Nederlandse nieuw overeengekomen woningleningen', url: 'https://data.ecb.europa.eu/data/datasets/MIR/MIR.M.NL.B.A2C.A.R.A.2250.EUR.N' },
      { title: 'DNB toelichting op hypotheekrentes', url: 'https://www.dnb.nl/statistieken/veelgestelde-vragen/' },
    ],
    sources: sources.sort((a, b) => a.url.localeCompare(b.url)), sha256: hash(JSON.stringify(payload)),
  },
};
validateMarketData(data);
const directory = new URL('../public/data/', import.meta.url);
await mkdir(directory, { recursive: true });
const temporary = new URL('market.json.tmp', directory), target = new URL('market.json', directory);
await writeFile(temporary, `${JSON.stringify(data)}\n`);
await rename(temporary, target);
console.log(`Woningmarkt: ${prices.length} Amsterdam quarters ${prices[0].period}–${prices.at(-1).period}; ${rates.length} NL mortgage-rate months ${rates[0].period}–${rates.at(-1).period}; SHA256 ${data.meta.sha256}`);
