import assert from "node:assert/strict";
import test from "node:test";
import { getValue, type Dataset } from "../src/data/model.ts";
import {
  importSeries,
  parseCsv,
  type Csv,
  type Mapping,
} from "../src/import.ts";
import {
  createBlock,
  initialWorkspace,
  parseWorkspace,
  reorderBlocks,
} from "../src/workspace.ts";

// Synthetic test observations only. These are never included in the application data.
const years = Array.from({ length: 15 }, (_, i) => 2012 + i);
const codes = ["BU0363AA01", "BU0363AA02"];
function dataset(): Dataset {
  return {
    years,
    areas: codes.map((code) => ({
      code,
      name: code,
      woz: { 2026: 100 },
      homes: { 2026: 2 },
    })),
    geometry: { type: "FeatureCollection", features: [] },
    variables: [
      {
        id: "year",
        label: "Jaar",
        unit: "jaar",
        kind: "time",
        source: "Test",
        description: "",
        available: true,
      },
      {
        id: "area",
        label: "Buurt",
        unit: "",
        kind: "geo",
        source: "Test",
        description: "",
        available: true,
      },
      {
        id: "woz",
        label: "WOZ",
        unit: "€",
        kind: "number",
        source: "Test",
        description: "",
        available: true,
      },
      {
        id: "homes",
        label: "Woningen",
        unit: "",
        kind: "number",
        source: "Test",
        description: "",
        available: true,
      },
      {
        id: "priceM2",
        label: "m²-prijs",
        unit: "€/m²",
        kind: "number",
        source: "Test",
        description: "",
        available: false,
      },
    ],
    meta: {
      retrievedAt: "2026-11-09T12:00:00Z",
      geometryVintage: "2022-03-24",
    },
  };
}
const mapping: Mapping = {
  code: "buurtcode",
  year: "jaar",
  value: "prijs",
  label: "Vierkantemeterprijs",
  unit: "€/m²",
};
const csv = (rows: string[][]): Csv => ({
  headers: ["buurtcode", "jaar", "prijs"],
  rows,
});
const valid = () => initialWorkspace();
const parse = (input: unknown) =>
  parseWorkspace(
    input,
    ["year", "area", "woz", "homes", "priceM2"],
    years,
    codes,
  );

test("CSV handles BOM, Dutch decimal commas, semicolons and CRLF", () => {
  const parsed = parseCsv(
    '\uFEFFbuurtcode;jaar;prijs\r\nBU0363AA01;2026;"8123,45"\r\nBU0363AA02;2025;\r\n',
  );
  assert.deepEqual(parsed.headers, ["buurtcode", "jaar", "prijs"]);
  const result = importSeries(dataset(), parsed, mapping);
  assert.equal(getValue(result, codes[0], 2026, "priceM2"), 8123.45);
  assert.equal(getValue(result, codes[1], 2025, "priceM2"), null);
  assert.equal(getValue(result, codes[1], 2026, "priceM2"), null);
});

test("CSV handles escaped quotes and line breaks inside quoted fields", () => {
  const parsed = parseCsv(
    'buurtcode,jaar,prijs,notitie\nBU0363AA01,2026,8500,"Een ""citaat""\nvolgende regel"',
  );
  assert.equal(parsed.rows[0][3], 'Een "citaat"\nvolgende regel');
  assert.equal(
    importSeries(dataset(), parsed, mapping).areas[0].series?.priceM2[2026],
    8500,
  );
});

test("CSV delimiter detection ignores commas inside quoted headers", () => {
  const parsed = parseCsv(
    'buurtcode;jaar;"prijs, gemiddeld, euro"\nBU0363AA01;2026;8500',
  );
  assert.deepEqual(parsed.headers, [
    "buurtcode",
    "jaar",
    "prijs, gemiddeld, euro",
  ]);
  assert.equal(parsed.rows[0][2], "8500");
});

test("CSV rejects duplicate headers, unequal widths, unclosed quotes and trailing quoted-field text", () => {
  for (const text of [
    "buurtcode,jaar,jaar\nBU0363AA01,2026,8500",
    "buurtcode,jaar,prijs\nBU0363AA01,2026",
    'buurtcode,jaar,prijs\nBU0363AA01,2026,"8500',
    'buurtcode,jaar,prijs\nBU0363AA01,2026,"8500"junk',
  ])
    assert.throws(() => parseCsv(text));
});

test("CSV rejects empty files, header-only data and excess file size", () => {
  for (const text of [
    "",
    "buurtcode,jaar,prijs",
    "x".repeat(10 * 1024 * 1024 + 1),
  ]) {
    assert.throws(() => parseCsv(text));
  }
});

test("imports join exact codes and years and preserve missing versus zero", () => {
  const source = dataset();
  const result = importSeries(
    source,
    csv([
      [codes[0], "2025", "0"],
      [codes[0], "2026", ""],
      [codes[1], "2026", "9200"],
    ]),
    mapping,
  );
  assert.equal(getValue(result, codes[0], 2025, "priceM2"), 0);
  assert.equal(getValue(result, codes[0], 2026, "priceM2"), null);
  assert.equal(getValue(result, codes[1], 2026, "priceM2"), 9200);
  assert.equal(getValue(source, codes[1], 2026, "priceM2"), null);
  assert.equal(result.variables.filter((v) => v.id === "priceM2").length, 1);
  assert.equal(
    result.variables.find((v) => v.id === "priceM2")?.available,
    true,
  );
  assert.match(result.variables.find((v) => v.id === "priceM2")!.source, /CSV/);
});

test("imports reject unknown codes, unsupported years, duplicate observations and nonfinite values", () => {
  for (const rows of [
    [["AA01", "2026", "8500"]],
    [[codes[0], "2030", "8500"]],
    [
      [codes[0], "2026", "8500"],
      [codes[0], "2026.0", "8600"],
    ],
    [[codes[0], "2026", "Infinity"]],
    [[codes[0], "2026", "NaN"]],
    [[codes[0], "2026", "8.500,50"]],
  ])
    assert.throws(() => importSeries(dataset(), csv(rows), mapping));
});

test("mapping requires three separate columns, bounded nonempty labels and known names", () => {
  for (const changes of [
    { code: "absent" },
    { code: "jaar" },
    { label: "" },
    { label: "  " },
    { label: "x".repeat(81) },
    { unit: "x".repeat(31) },
  ])
    assert.throws(() =>
      importSeries(dataset(), csv([[codes[0], "2026", "8500"]]), {
        ...mapping,
        ...changes,
      }),
    );
});

test("general imported measures retain negative values; square-meter prices reject negative values", () => {
  const input = csv([[codes[0], "2026", "-2,5"]]);
  const result = importSeries(dataset(), input, {
    ...mapping,
    label: "Temperatuur",
    unit: "°C",
  });
  const variable = result.variables.find((v) => v.label === "Temperatuur")!;
  assert.equal(getValue(result, codes[0], 2026, variable.id), -2.5);
  assert.throws(() => importSeries(dataset(), input, mapping));
});

test("JSON-restored import data receive CSV shape validation too", () => {
  const invalid: Csv[] = [
    { headers: ["buurtcode", "jaar", "prijs"], rows: [] },
    {
      headers: ["buurtcode", "jaar", "prijs", "prijs"],
      rows: [[codes[0], "2026", "8500", "9000"]],
    },
    {
      headers: ["buurtcode", "jaar", "prijs"],
      rows: [[codes[0], "2026", "8500", "ignored"]],
    },
  ];
  for (const input of invalid)
    assert.throws(() => importSeries(dataset(), input, mapping));
});

test("reimporting a measure updates its values without duplicating the variable", () => {
  const first = importSeries(
    dataset(),
    csv([[codes[0], "2026", "8500"]]),
    mapping,
  );
  const second = importSeries(
    first,
    csv([[codes[0], "2026", "9000"]]),
    mapping,
  );
  assert.equal(getValue(second, codes[0], 2026, "priceM2"), 9000);
  assert.equal(second.variables.filter((v) => v.id === "priceM2").length, 1);
});

test("custom measure labels are normalized consistently when updating a prior import", () => {
  const first = importSeries(dataset(), csv([[codes[0], "2026", "10"]]), {
    ...mapping,
    label: "Temperatuur",
    unit: "°C",
  });
  const firstId = first.variables.find((v) => v.label === "Temperatuur")!.id;
  const second = importSeries(first, csv([[codes[0], "2026", "20"]]), {
    ...mapping,
    label: "  TEMPERATUUR  ",
    unit: "°C",
  });
  assert.equal(
    second.variables.filter((v) => v.id.startsWith("import_")).length,
    1,
  );
  assert.equal(getValue(second, codes[0], 2026, firstId), 20);
});

test("trimming a supplied price unit cannot bypass the negative-price guard", () => {
  const normalizedMapping = { ...mapping, unit: " €/m² " };
  const result = importSeries(
    dataset(),
    csv([[codes[0], "2026", "8500"]]),
    normalizedMapping,
  );
  assert.equal(getValue(result, codes[0], 2026, "priceM2"), 8500);
  assert.throws(() =>
    importSeries(dataset(), csv([[codes[0], "2026", "-1"]]), normalizedMapping),
  );
});

test("distinct labels that normalize to the same slug cannot silently replace each other", () => {
  const first = importSeries(dataset(), csv([[codes[0], "2026", "10"]]), {
    ...mapping,
    label: "A-B",
    unit: "punten",
  });
  const second = importSeries(first, csv([[codes[0], "2026", "20"]]), {
    ...mapping,
    label: "A B",
    unit: "punten",
  });
  const one = second.variables.find((v) => v.label === "A-B");
  const two = second.variables.find((v) => v.label === "A B");
  assert.ok(one && two);
  assert.notEqual(one.id, two.id);
  assert.equal(getValue(second, codes[0], 2026, one.id), 10);
  assert.equal(getValue(second, codes[0], 2026, two.id), 20);
});

test("workspaces round-trip without aliasing the imported object", () => {
  const input = valid();
  input.selected = [codes[0]];
  const output = parse(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(output, input);
  output.blocks[0].title = "Anders";
  assert.notEqual(output.blocks[0].title, input.blocks[0].title);
  assert.equal(parse({ ...valid(), blocks: [] }).blocks.length, 0);
});

test("workspace validation rejects unsupported schema, period and year bounds", () => {
  const input = valid();
  for (const changes of [
    { version: 2 },
    { name: "" },
    { name: "x".repeat(121) },
    { start: 2027 },
    { end: 2016 },
    { year: 2015 },
    { year: 2027 },
    { selectionOnly: "true" },
    { selected: ["AA01"] },
    { selected: [codes[0], codes[0]] },
  ])
    assert.throws(() => parse({ ...input, ...changes }));
});

test("workspace validation rejects inherited object names as block kinds", () => {
  for (const kind of [
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
  ]) {
    const input = valid();
    input.blocks[0] = {
      ...input.blocks[0],
      kind,
    } as (typeof input.blocks)[number];
    assert.throws(() => parse(input), `Rejected inherited kind ${kind}`);
  }
});

test("workspace validation rejects unavailable variable ids and duplicate block ids", () => {
  const input = valid();
  assert.throws(() => parseWorkspace(input, ["year", "woz"], years, codes));
  assert.throws(() =>
    parse({ ...input, blocks: [input.blocks[0], input.blocks[0]] }),
  );
  assert.throws(() =>
    parse({
      ...input,
      blocks: Array.from({ length: 31 }, () => createBlock("map")),
    }),
  );
});

test("all block Y axes require numeric fields and regression cannot use the year dimension", () => {
  for (const kind of [
    "map",
    "timeseries",
    "ranking",
    "table",
    "stat",
    "regression",
  ] as const) {
    const block = { ...createBlock(kind), y: "year" };
    assert.throws(() => parse({ ...valid(), blocks: [block] }));
  }
  assert.throws(() =>
    parse({
      ...valid(),
      blocks: [{ ...createBlock("regression"), x: "year" }],
    }),
  );
  assert.throws(() =>
    parse({
      ...valid(),
      blocks: [{ ...createBlock("timeseries"), x: "homes" }],
    }),
  );
  assert.throws(() =>
    parse({ ...valid(), blocks: [{ ...createBlock("map"), y: "area" }] }),
  );
});

test("reordering is immutable and handles invalid source or target ids safely", () => {
  const input = valid().blocks;
  const ids = input.map((b) => b.id);
  const result = reorderBlocks(input, ids[0], ids[2]);
  assert.deepEqual(
    result.map((b) => b.id),
    [ids[1], ids[2], ids[0], ids[3]],
  );
  assert.deepEqual(
    input.map((b) => b.id),
    ids,
  );
  assert.equal(reorderBlocks(input, "absent", ids[1]), input);
  assert.equal(reorderBlocks(input, ids[0], "absent"), input);
  assert.equal(reorderBlocks(input, ids[0], ids[0]), input);
});
