import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';

const site = resolve(import.meta.dirname, '..');
const fields = {
  homes:'Woningvoorraad_35', woz:'GemiddeldeWOZWaardeVanWoningen_39', owner:'Koopwoningen_47',
  apartments:'PercentageMeergezinswoning_45', density:'Omgevingsadressendichtheid_121',
  supermarket:'AfstandTotGroteSupermarkt_111', residents:'AantalInwoners_5',
  newBuild:'BouwjaarAfgelopenTienJaar_52', newHomes:'NieuwbouwWoningen_36',
  rent:'HuurwoningenTotaal_48', socialRent:'InBezitWoningcorporatie_49', vacancy:'OnbewoondeWoningen_46',
  householdSize:'GemiddeldeHuishoudensgrootte_33', gas:'GemiddeldAardgasverbruik_55',
  electricity:'GemiddeldeElektriciteitslevering_53', districtHeating:'PercentageWoningenMetStadsverwarming_56',
  gp:'AfstandTotHuisartsenpraktijk_110', school:'AfstandTotSchool_113', daycare:'AfstandTotKinderdagverblijf_112',
  gasFree:'AardgasvrijeWoningen_57', solar:'WoningenMetZonnestroom_59',
};
const changeField = 'IndelingswijzigingGemeenteWijkBuurt_4';
const additional2025 = [changeField, 'k_0Tot15Jaar_8', 'k_65JaarOfOuder_12'];
const olderFields = {
  educationLow:'BasisonderwijsVmboMbo1_67', educationMiddle:'HavoVwoMbo24_68', educationHigh:'HboWo_69',
  income:'GemiddeldInkomenPerInwoner_78', lowIncome:'k_40PersonenMetLaagsteInkomen_79',
};
const tables = [
  {year:2025, id:'86165NED', fields:[...Object.values(fields), ...additional2025]},
  {year:2024, id:'85984NED', fields:[changeField, 'GemiddeldeWOZWaardeVanWoningen_39', ...Object.values(olderFields)]},
  {year:2023, id:'85618NED', fields:[changeField, 'GemiddeldeWOZWaardeVanWoningen_36']},
];
const sources = [];
async function pages(url, kind) {
  const rows = [], visited = new Set();
  while (url) {
    assert.ok(!visited.has(url) && visited.size < 30, 'Pagination must finish'); visited.add(url);
    const response = await fetch(url, {signal:AbortSignal.timeout(45000)});
    assert.ok(response.ok, `${response.status}: ${url}`);
    const text = await response.text(), data = JSON.parse(text);
    sources.push({url, sha256:createHash('sha256').update(text).digest('hex')});
    rows.push(...(kind === 'geo' ? data.features : data.value));
    url = kind === 'geo' ? data.links?.find(l=>l.rel==='next')?.href : data['odata.nextLink'];
  }
  return rows;
}
const geometryUrl = 'https://api.pdok.nl/cbs/wijken-en-buurten-2025/ogc/v1/collections/buurten/items?gemeentecode=GM0363&limit=1000&f=json';
const [geometry, ...extractions] = await Promise.all([
  pages(geometryUrl, 'geo'),
  ...tables.map(async table => {
    const root = `https://opendata.cbs.nl/ODataApi/OData/${table.id}/`;
    const tableUrl = new URL(`${root}TypedDataSet`);
    tableUrl.searchParams.set('$filter', "startswith(WijkenEnBuurten,'BU0363')");
    tableUrl.searchParams.set('$select', ['WijkenEnBuurten', ...table.fields].join(','));
    const [rows, properties] = await Promise.all([pages(tableUrl.href, 'table'), pages(`${root}DataProperties`, 'table')]);
    const keys = new Set(properties.map(p => p.Key));
    for (const key of table.fields) assert.ok(keys.has(key), `CBS schema changed: ${table.id}/${key}`);
    const values = new Map(rows.map(r => [r.WijkenEnBuurten.trim(), r]));
    assert.equal(values.size, rows.length, `Duplicate CBS statistic identifiers: ${table.id}`);
    return { ...table, rows, values };
  }),
]);
const [current, previous, oldest] = extractions;
const statistics = current.rows, values = current.values;
assert.ok(geometry.length > 400 && statistics.length > 400,'Unexpectedly incomplete Amsterdam extraction');
assert.equal(new Set(geometry.map(f=>f.properties.buurtcode)).size,geometry.length);
const number = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
const euro = n => number(n) === null ? null : n * 1000;
const share = (numerator, denominator) => number(numerator) !== null && number(denominator) !== null && denominator > 0 && numerator <= denominator ? 100 * numerator / denominator : null;
const unchanged = row => row?.[changeField]?.trim() === '1';
const features = geometry.map(f=>{
  const p=f.properties; assert.equal(p.gemeentecode,'GM0363');
  const row=values.get(p.buurtcode), props={code:p.buurtcode,name:p.buurtnaam,year:2025,hasStatistics:!!row};
  for(const [key,field] of Object.entries(fields)) props[key]=number(row?.[field]);
  if(props.woz !== null) props.woz *= 1000;
  props.children = share(row?.k_0Tot15Jaar_8, props.residents);
  props.elderly = share(row?.k_65JaarOfOuder_12, props.residents);
  const prior = previous.values.get(p.buurtcode), first = oldest.values.get(p.buurtcode);
  const comparable2024 = !!prior && unchanged(row);
  const comparable2023 = comparable2024 && !!first && unchanged(prior);
  props.boundaryChange = row?.[changeField]?.trim() ?? null;
  props.wozPrevious = comparable2024 ? euro(prior.GemiddeldeWOZWaardeVanWoningen_39) : null;
  props.wozChange = props.woz !== null && props.wozPrevious !== null && props.wozPrevious > 0 ? 100 * (props.woz / props.wozPrevious - 1) : null;
  props.wozHistory = [
    { year:2023, value:comparable2023 ? euro(first.GemiddeldeWOZWaardeVanWoningen_36) : null, valuationDate:'2022-01-01', comparable:comparable2023 },
    { year:2024, value:props.wozPrevious, valuationDate:'2023-01-01', comparable:comparable2024 },
    { year:2025, value:props.woz, valuationDate:'2024-01-01', comparable:!!row },
  ];
  const education = Object.keys(olderFields).filter(k => k.startsWith('education')).map(k => number(prior?.[olderFields[k]]));
  // Every category must be published. A suppressed count is never subtracted from a total.
  props.education = comparable2024 && education.every(n => n !== null) ? share(education[2], education.reduce((a,b) => a + b, 0)) : null;
  props.income = comparable2024 ? euro(prior?.[olderFields.income]) : null;
  props.lowIncome = comparable2024 ? number(prior?.[olderFields.lowIncome]) : null;
  return {type:'Feature',id:p.buurtcode,geometry:JSON.parse(JSON.stringify(f.geometry,(_,v)=>typeof v==='number'?Math.round(v*1e6)/1e6:v)),properties:props};
}).sort((a,b)=>a.properties.code.localeCompare(b.properties.code));
const data = {type:'FeatureCollection',features};
const source = year => `https://www.cbs.nl/nl-nl/cijfers/detail/${tables.find(t => t.year === year).id}`;
const indicator = (label, unit, description, year = 2025, referenceYear = year) => ({ label, unit, description, year, referenceYear, source:source(year) });
const indicators = {
  woz:indicator('Gemiddelde WOZ', '€', 'Buurtgemiddelde, waardepeildatum 1 januari 2024. Geen verkoopprijs of individuele taxatie.', 2025, 2024),
  wozChange:indicator('WOZ-verandering', '%', 'Procentuele verandering in het buurtgemiddelde tussen CBS 2024 en 2025 (waardepeildata 1 januari 2023 en 2024). Alleen gekoppeld bij CBS-indelingsindicator 1. Verandering in woningmix kan meespelen.', 2025, 2024),
  wozPrevious:indicator('Gemiddelde WOZ vorig jaar', '€', 'CBS 2024, waardepeildatum 1 januari 2023, alleen bij vergelijkbare buurtafbakening.', 2024, 2023),
  owner:indicator('Koopwoningen', '%', 'Aandeel van de woningvoorraad in eigendom van de bewoner(s) of in gebruik als tweede woning.'),
  apartments:indicator('Meergezinswoningen', '%', 'Aandeel woningen dat samen met andere woningen of bedrijfsruimten een pand vormt.'),
  density:indicator('Adressendichtheid', 'adressen/km²', 'CBS-omgevingsadressendichtheid, geen bevolkingsdichtheid.'),
  supermarket:indicator('Afstand supermarkt', 'km over de weg', 'Gemiddelde afstand van inwoners tot de dichtstbijzijnde grote supermarkt over de weg.'),
  newBuild:indicator('Gebouwd in laatste 10 jaar', '%', 'Aandeel woningen met pandbouwjaar in de afgelopen tien jaar, op 1 januari 2025. Dit zijn bestaande woningen, geen geplande bouwprojecten.'),
  newHomes:indicator('Nieuwbouwwoningen toegevoegd', 'woningen', 'Aantal woningen door nieuwbouw toegevoegd in 2025. Geen plannen, vergunningen of prognose.'),
  rent:indicator('Huurwoningen', '%', 'Aandeel huurwoningen in de woningvoorraad; onbekend eigendom telt niet als huur.'),
  socialRent:indicator('Corporatiewoningen', '%', 'Aandeel woningvoorraad in bezit van een woningcorporatie. Eigendomscategorie; geen bewezen sociale huurprijs.'),
  vacancy:indicator('Zonder ingeschreven bewoner', '%', 'Aandeel woningen zonder BRP-inschrijving op 1 januari 2025. Dit bewijst geen fysieke leegstand of vakantieverhuur.'),
  householdSize:indicator('Huishoudensgrootte', 'personen', 'Gemiddeld aantal personen per particulier huishouden; institutionele huishoudens ontbreken.'),
  children:indicator('Inwoners 0–14 jaar', '%', 'Afgeleid uit afgeronde aantallen inwoners 0 tot 15 jaar gedeeld door totaal inwoners. Kleine buurten hebben afrondingsonzekerheid.'),
  elderly:indicator('Inwoners 65+', '%', 'Afgeleid uit afgeronde aantallen inwoners van 65 jaar of ouder gedeeld door totaal inwoners. Kleine buurten hebben afrondingsonzekerheid.'),
  gas:indicator('Gemiddeld gasverbruik', 'm³/jaar', 'Gemiddeld jaarverbruik op woningniveau uit de CBS-tabel 2025, geen actuele meterstand. Stadsverwarming kan het gasgemiddelde verlagen. De opgehaalde metadata specificeert geen afzonderlijk waarnemingsjaar.', 2025, null),
  electricity:indicator('Elektriciteitslevering', 'kWh/jaar', 'Gemiddelde jaarlijkse levering van het net aan woningen uit CBS-tabel 2025; geen totale energievraag of nettoverbruik na eigen opwek. De opgehaalde metadata specificeert geen afzonderlijk waarnemingsjaar.', 2025, null),
  districtHeating:indicator('Stadsverwarming', '%', 'Aandeel woningen aangesloten op stadsverwarming. Beperkte brondekking; ontbrekend is niet nul. CBS-tabel 2025; afzonderlijk waarnemingsjaar niet vermeld in opgehaalde metadata.', 2025, null),
  gasFree:indicator('Aardgasvrije woningen', '%', 'Aandeel woningen zonder gasverbruik en met hoofdzakelijk elektrische verwarming of stadsverwarming volgens CBS. CBS-tabel 2025; afzonderlijk waarnemingsjaar niet vermeld in opgehaalde metadata.', 2025, null),
  solar:indicator('Woningen met zonnestroom', '%', 'Aandeel woningen met een of meer zonnestroominstallaties volgens CBS; geen gemeten opwek. CBS-tabel 2025; afzonderlijk waarnemingsjaar niet vermeld in opgehaalde metadata.', 2025, null),
  gp:indicator('Afstand huisarts', 'km over de weg', 'Gemiddelde afstand van inwoners tot de dichtstbijzijnde huisartsenpraktijk over de weg; geen informatie over patiëntenstops.'),
  school:indicator('Afstand basisschool', 'km over de weg', 'Gemiddelde afstand tot een reguliere basisschool over de weg; speciaal onderwijs ontbreekt.'),
  daycare:indicator('Afstand kinderopvang', 'km over de weg', 'Gemiddelde afstand tot het dichtstbijzijnde kinderdagverblijf over de weg; geen vrije plaatsen of BSO.'),
  education:indicator('Hbo/wo onder bekende onderwijsniveaus', '%', 'CBS 2024, personen 15–74 jaar op 1 oktober van verslagjaar 2024 volgens de actuele metadata. Hbo/wo gedeeld door de som van de drie gepubliceerde onderwijsniveaus. Alleen bij alle categorieën bekend en onveranderde buurtgrens; afgeronde/geschatte aantallen.', 2024),
  income:indicator('Inkomen per inwoner', '€/jaar', 'Voorlopig gemiddeld persoonlijk jaarinkomen per inwoner in particuliere huishoudens over verslagjaar 2024, bevolking op 1 januari 2024 volgens de actuele CBS-metadata. Alleen gepubliceerd bij minstens 2.500 personen; ontbrekende buurten worden niet geschat.', 2024),
  lowIncome:indicator('Personen in laagste 40% inkomens', '%', 'Voorlopig aandeel personen met persoonlijk inkomen dat tot de landelijke laagste 40% behoort, inkomensverslagjaar 2024 volgens de actuele CBS-metadata. Dit is geen armoedepercentage.', 2024),
};
const meta = {retrievedAt:new Date().toISOString(),statisticsYear:2025,wozValuationDate:'2024-01-01',table:'86165NED',geometryCount:geometry.length,statisticsCount:statistics.length,unmatchedStatistics:[...values.keys()].filter(k=>!features.some(f=>f.id===k)),withoutStatistics:features.filter(f=>!f.properties.hasStatistics).map(f=>f.id),fields,olderFields,indicators,historyTables:tables.map(({year,id}) => ({year,table:id,valuationDate:`${year-1}-01-01`})),historyMethod:'Match official buurtcode and require CBS change indicator 1 for every intervening year. Changed/unknown boundaries and suppressed values remain null. WOZ changes are neighborhood averages, not a house price index.',sources:sources.sort((a,b) => a.url.localeCompare(b.url)),sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex')};
assert.equal(meta.unmatchedStatistics.length,0,'Do not silently lose statistical rows');
meta.indicatorYearDefinition = 'year is the CBS table year. referenceYear is the observation/valuation year explicitly identified in the current source metadata; null means no separate observation year is specified, not an inferred lag.';
for (const feature of features) {
  for (const [key, value] of Object.entries(feature.properties)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value) && (key === 'wozChange' || value >= 0), `Invalid ${key}`);
    if (indicators[key]?.unit === '%' && key !== 'wozChange' && value !== null) assert.ok(value <= 100, `Invalid percentage ${key}`);
  }
}
const directory=resolve(site,'src/features/housing'); await mkdir(directory,{recursive:true});
const target=resolve(directory,'snapshot.json'), temporary=target+'.tmp';
await writeFile(temporary,JSON.stringify({meta,data})+'\n'); await rename(temporary,target);
console.log(JSON.stringify({count:features.length,coverage:Object.fromEntries(Object.keys(indicators).map(key=>[key,features.filter(f=>f.properties[key]!==null).length])),sha256:meta.sha256,sources:meta.sources.length},null,2));
