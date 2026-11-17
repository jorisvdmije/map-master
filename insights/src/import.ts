import type { Dataset, Variable } from "./data/model";

export type Csv = { headers: string[]; rows: string[][] };
export function parseCsv(text: string): Csv {
  if (text.length > 10 * 1024 * 1024)
    throw new Error("Het bestand is groter dan 10 MB.");
  text = text.replace(/^\uFEFF/, "");
  let headerQuoted = false,
    commas = 0,
    semicolons = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (headerQuoted && text[i + 1] === '"') i++;
      else headerQuoted = !headerQuoted;
    } else if (!headerQuoted) {
      if (c === "\n" || c === "\r") break;
      if (c === ",") commas++;
      if (c === ";") semicolons++;
    }
  }
  const separator = semicolons > commas ? ";" : ",";
  const records: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!quoted && cell.length)
        throw new Error("Onverwacht aanhalingsteken in CSV.");
      else {
        quoted = !quoted;
        if (!quoted) closed = true;
      }
    } else if (!quoted && (c === separator || c === "\n" || c === "\r")) {
      row.push(cell.trim());
      cell = "";
      closed = false;
      if (c !== separator) {
        if (row.some(Boolean)) records.push(row);
        row = [];
        if (c === "\r" && text[i + 1] === "\n") i++;
      }
    } else {
      if (closed && c.trim())
        throw new Error("Onverwachte tekst na een aangehaald veld.");
      cell += c;
    }
  }
  if (quoted) throw new Error("Een aangehaald veld is niet afgesloten.");
  row.push(cell.trim());
  if (row.some(Boolean)) records.push(row);
  const headers = records.shift();
  if (
    !headers ||
    headers.length < 3 ||
    new Set(headers).size !== headers.length
  )
    throw new Error(
      "Gebruik unieke kolomnamen voor buurtcode, jaar en waarde.",
    );
  if (
    !records.length ||
    records.length > 20000 ||
    records.some((r) => r.length !== headers.length)
  )
    throw new Error(
      "Gebruik 1–20.000 rijen met evenveel velden als de kolomkoppen.",
    );
  return { headers, rows: records };
}
export type Mapping = {
  code: string;
  year: string;
  value: string;
  label: string;
  unit: string;
};
export function importIdentity(mapping: Mapping): string {
  const labelKey = mapping.label
    .trim()
    .normalize("NFC")
    .toLocaleLowerCase("nl-NL");
  let labelHash = 2166136261;
  for (const character of labelKey)
    labelHash = Math.imul(labelHash ^ character.charCodeAt(0), 16777619);
  return mapping.unit.trim() === "€/m²"
    ? "priceM2"
    : `import_${labelKey.replace(/[^a-z0-9]+/g, "_").slice(0, 32)}_${(labelHash >>> 0).toString(36)}`;
}
export function importSeries(
  dataset: Dataset,
  csv: Csv,
  mapping: Mapping,
): Dataset {
  if (
    !csv ||
    !Array.isArray(csv.headers) ||
    csv.headers.length < 3 ||
    !csv.headers.every((h) => typeof h === "string" && h.trim()) ||
    new Set(csv.headers).size !== csv.headers.length ||
    !Array.isArray(csv.rows) ||
    !csv.rows.length ||
    csv.rows.length > 20000 ||
    !csv.rows.every(
      (r) =>
        Array.isArray(r) &&
        r.length === csv.headers.length &&
        r.every((c) => typeof c === "string"),
    ) ||
    !mapping ||
    !["code", "year", "value", "label", "unit"].every(
      (k) => typeof mapping[k as keyof Mapping] === "string",
    )
  )
    throw new Error("De CSV bevat geen geldige kolommen of gegevensrijen.");
  const ci = csv.headers.indexOf(mapping.code),
    yi = csv.headers.indexOf(mapping.year),
    vi = csv.headers.indexOf(mapping.value);
  if (
    Math.min(ci, yi, vi) < 0 ||
    new Set([ci, yi, vi]).size !== 3 ||
    !mapping.label.trim() ||
    mapping.label.length > 80 ||
    mapping.unit.length > 30
  )
    throw new Error(
      "Kies drie verschillende kolommen, een naam en een korte eenheid.",
    );
  const id = importIdentity(mapping);
  const seen = new Set<string>();
  const values = new Map<string, Record<string, number | null>>();
  const codes = new Set(dataset.areas.map((a) => a.code));
  for (const [index, row] of csv.rows.entries()) {
    const code = row[ci],
      year = Number(row[yi]),
      raw = row[vi].trim();
    if (!codes.has(code))
      throw new Error(
        `Rij ${index + 2}: onbekende buurtcode ‘${code}’. Gebruik de BU0363-code uit de voorbeeld-CSV.`,
      );
    if (!dataset.years.includes(year))
      throw new Error(
        `Rij ${index + 2}: het jaar valt buiten ${dataset.years[0]}–${dataset.years.at(-1)}.`,
      );
    if (seen.has(`${code}:${year}`))
      throw new Error(
        `Rij ${index + 2}: dubbele combinatie van buurt en jaar.`,
      );
    seen.add(`${code}:${year}`);
    const n = raw === "" ? null : Number(raw.replace(",", "."));
    if (n !== null && !Number.isFinite(n))
      throw new Error(
        `Rij ${index + 2}: ‘${raw}’ is geen geldig getal. Gebruik geen duizendtalscheiding.`,
      );
    if (id === "priceM2" && n !== null && n < 0)
      throw new Error(
        `Rij ${index + 2}: een prijs per m² mag niet negatief zijn.`,
      );
    if (!values.has(code)) values.set(code, {});
    values.get(code)![year] = n;
  }
  const variable: Variable = {
    id,
    label: mapping.label.trim(),
    unit: mapping.unit.trim(),
    description:
      "Eigen CSV. Alleen exact gekoppelde buurtcodes en jaren; lege waarden blijven onbekend. Controleer zelf definitie en geografische vergelijkbaarheid.",
    source: "Eigen CSV-import",
    kind: "number",
    available: true,
    years: [
      ...new Set(
        csv.rows
          .filter((row) => row[vi].trim() !== "")
          .map((row) => Number(row[yi])),
      ),
    ].sort((a, b) => a - b),
  };
  return {
    ...dataset,
    areas: dataset.areas.map((area) => ({
      ...area,
      series: { ...area.series, [id]: values.get(area.code) ?? {} },
    })),
    variables: [...dataset.variables.filter((v) => v.id !== id), variable],
  };
}
