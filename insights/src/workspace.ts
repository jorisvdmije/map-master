export type BlockKind =
  | "map"
  | "timeseries"
  | "regression"
  | "ranking"
  | "table"
  | "stat";
export type Mode = "value" | "index" | "growth";
export type Block = {
  id: string;
  kind: BlockKind;
  title: string;
  x: string;
  y: string;
  wide: boolean;
  mode: Mode;
};
export type Workspace = {
  version: 1;
  name: string;
  start: number;
  end: number;
  year: number;
  selected: string[];
  selectionOnly: boolean;
  blocks: Block[];
};
export const blockInfo: Record<
  BlockKind,
  { label: string; description: string; tag: string }
> = {
  map: {
    label: "Kaart",
    description: "Ontdek waar verschillen ontstaan",
    tag: "Ruimte",
  },
  timeseries: {
    label: "Tijdreeks",
    description: "Vergelijk ontwikkelingen door de tijd",
    tag: "Tijd",
  },
  regression: {
    label: "Regressie",
    description: "Onderzoek het verband tussen variabelen",
    tag: "Verband",
  },
  ranking: {
    label: "Ranglijst",
    description: "Vind de koplopers en achterblijvers",
    tag: "Vergelijk",
  },
  table: {
    label: "Datatabel",
    description: "Bekijk de cijfers achter je inzichten",
    tag: "Details",
  },
  stat: {
    label: "Kerncijfer",
    description: "Zet één getal in de schijnwerpers",
    tag: "Overzicht",
  },
};
export function createBlock(kind: BlockKind, y = "woz"): Block {
  return {
    id: crypto.randomUUID(),
    kind,
    title: blockInfo[kind].label,
    x: kind === "regression" ? "homes" : "year",
    y,
    wide: false,
    mode: "value",
  };
}
export function initialWorkspace(): Workspace {
  return {
    version: 1,
    name: "Amsterdam in ontwikkeling",
    start: 2016,
    end: 2026,
    year: 2026,
    selected: [],
    selectionOnly: false,
    blocks: (["map", "timeseries", "regression", "ranking"] as BlockKind[]).map(
      (kind) => ({
        ...createBlock(kind),
        title: (
          {
            map: "Amsterdam in beeld",
            timeseries: "De ontwikkeling door de tijd",
            regression: "Welke variabelen hangen samen?",
            ranking: "Buurten vergeleken",
          } as Partial<Record<BlockKind, string>>
        )[kind]!,
      }),
    ),
  };
}
export function parseWorkspace(
  value: unknown,
  variables: string[],
  years: number[],
  codes: string[],
): Workspace {
  const fail = (): never => {
    throw new Error("Dit is geen geldige Atlas-werkruimte voor deze dataset.");
  };
  if (!value || typeof value !== "object") return fail();
  const w = value as Workspace;
  if (
    w.version !== 1 ||
    typeof w.name !== "string" ||
    w.name.length > 120 ||
    !w.name.trim() ||
    !years.includes(w.start) ||
    !years.includes(w.end) ||
    w.start >= w.end ||
    !years.includes(w.year) ||
    w.year < w.start ||
    w.year > w.end ||
    !Array.isArray(w.selected) ||
    w.selected.length > codes.length ||
    new Set(w.selected).size !== w.selected.length ||
    w.selected.some((c) => !codes.includes(c)) ||
    typeof w.selectionOnly !== "boolean" ||
    (w.selectionOnly && !w.selected.length) ||
    !Array.isArray(w.blocks) ||
    w.blocks.length > 30
  )
    return fail();
  const ids = new Set<string>();
  for (const b of w.blocks) {
    if (
      !b ||
      typeof b.id !== "string" ||
      !b.id ||
      ids.has(b.id) ||
      typeof b.kind !== "string" ||
      !Object.hasOwn(blockInfo, b.kind) ||
      typeof b.title !== "string" ||
      b.title.length > 120 ||
      !["value", "index", "growth"].includes(b.mode) ||
      typeof b.wide !== "boolean" ||
      !variables.includes(b.y) ||
      !variables.includes(b.x) ||
      b.y === "year" ||
      (b.kind === "timeseries" && b.x !== "year") ||
      (b.kind === "regression" && b.x === "year") ||
      [b.x, b.y].includes("area")
    )
      return fail();
    ids.add(b.id);
  }
  return structuredClone(w);
}
export function reorderBlocks(
  blocks: Block[],
  source: string,
  target: string,
): Block[] {
  const from = blocks.findIndex((b) => b.id === source),
    to = blocks.findIndex((b) => b.id === target);
  if (from < 0 || to < 0 || from === to) return blocks;
  const next = [...blocks];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}
export function download(
  name: string,
  content: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csvCell(value: unknown) {
  const text =
    typeof value === "string"
      ? value.replace(/^[=+@\-\t\r]/, "'$&")
      : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}
