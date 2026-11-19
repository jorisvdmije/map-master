import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import { makeDataset, getValue } from "../src/data/model.ts";
import { getSource, sourceCatalog } from "../src/data/catalog.ts";
import { type SourceBundle } from "../src/data/source-loader.ts";
import {
  CACHE_TTL,
  cacheSource,
  forgetCachedSource,
  getCachedSource,
  requestSource,
} from "../src/data/source-cache.ts";
import {
  MAX_SESSION_BYTES,
  createSession,
  restoreSession,
  serializeSession,
} from "../src/session.ts";
import { createBlock, initialWorkspace } from "../src/workspace.ts";
import { importIdentity, type Csv, type Mapping } from "../src/import.ts";

const json = async (path: string) =>
  JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const base = makeDataset(
  await json("../public/data/amsterdam-development.json"),
  await json("../public/data/amsterdam-development-geometry.json"),
);
const definition = getSource("population")!;
const source = (await json(
  `../public/${definition.snapshotPath}`,
)) as SourceBundle;
const metric = definition.variables[0].id;
const observation = source.areas
  .flatMap((a) =>
    Object.entries(a.series[metric] ?? {})
      .filter(([, v]) => v !== null)
      .map(([year, value]) => ({ code: a.code, year: +year, value })),
  )
  .at(-1)!;
assert.ok(
  observation,
  "The session tests use a real published source observation",
);
const workspace = () => ({
  ...initialWorkspace(),
  blocks: [createBlock("table", metric)],
  year: observation.year,
});

// A minimal asynchronous IDB adapter exercises cache policy. Browser tests exercise
// actual IndexedDB. This fixture contains the real source bundle, never fabricated
// application observations.
function installIdb(
  t: TestContext,
  entries: Map<string, unknown>,
  options: { failWrite?: boolean } = {},
) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const database = {
    objectStoreNames: { contains: () => true },
    close() {},
    transaction() {
      const transaction: Record<string, any> = {};
      const operation = (run: () => unknown, write = false) => {
        const request: Record<string, any> = {};
        queueMicrotask(() => {
          if (write && options.failWrite) {
            transaction.onerror?.();
            return;
          }
          request.result = run();
          request.onsuccess?.();
          queueMicrotask(() => transaction.oncomplete?.());
        });
        return request;
      };
      transaction.objectStore = () => ({
        get: (id: string) => operation(() => structuredClone(entries.get(id))),
        put: (entry: { id: string }) =>
          operation(() => {
            entries.set(entry.id, structuredClone(entry));
            return entry.id;
          }, true),
        delete: (id: string) =>
          operation(() => {
            entries.delete(id);
            return undefined;
          }, true),
      });
      return transaction;
    },
  };
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open: () => {
        const request: Record<string, any> = { result: database };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  });
}

test("legacy v1 workspaces without a sources field remain compatible", () => {
  const w = initialWorkspace();
  const legacy = { format: "atlas", version: 1, workspace: w, imports: [] };
  const restored = restoreSession(legacy, base);
  assert.equal(restored.workspace.name, w.name);
  assert.deepEqual(restored.sources, []);
  assert.deepEqual(restored.imports, []);
  assert.equal(
    getValue(restored.dataset, base.areas[0].code, 2026, "woz"),
    getValue(base, base.areas[0].code, 2026, "woz"),
  );
});

test("portable sessions restore official source values and provenance without a network fetch", (t) => {
  const network = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Restoring a saved source must not fetch");
  });
  const saved = createSession(workspace(), [], [source]);
  const restored = restoreSession(JSON.parse(serializeSession(saved)), base);
  assert.equal(restored.workspace.blocks[0].y, metric);
  assert.equal(restored.sources[0].sourceId, definition.id);
  assert.equal(restored.sources[0].retrievedAt, source.retrievedAt);
  assert.deepEqual(restored.sources[0].provenance, source.provenance);
  for (const area of source.areas)
    for (const variable of definition.variables)
      for (const [year, value] of Object.entries(
        area.series[variable.id] ?? {},
      )) {
        assert.equal(
          getValue(restored.dataset, area.code, +year, variable.id),
          value,
        );
      }
  assert.equal(network.mock.callCount(), 0);
});

test("a restored workspace does not alias the source or block input objects", () => {
  const saved = createSession(workspace(), [], [structuredClone(source)]);
  const restored = restoreSession(saved, base);
  const old = restored.workspace.blocks[0].title;
  saved.workspace.blocks[0].title = "Changed after restore";
  saved.sources![0].areas.find((a) => a.code === observation.code)!.series[
    metric
  ][observation.year] = Number(observation.value) + 1;
  assert.equal(restored.workspace.blocks[0].title, old);
  assert.equal(
    getValue(restored.dataset, observation.code, observation.year, metric),
    observation.value,
  );
});

test("unknown and duplicate catalog sources cannot enter a restored workspace", () => {
  const saved = createSession(workspace(), [], [source]);
  assert.throws(() =>
    restoreSession({ ...saved, sources: [source, source] }, base),
  );
  for (const sourceId of ["not-a-source", "__proto__", "constructor"]) {
    assert.throws(() =>
      restoreSession({ ...saved, sources: [{ ...source, sourceId }] }, base),
    );
  }
  assert.throws(() => restoreSession({ ...saved, sources: {} }, base));
  assert.throws(() => restoreSession({ ...saved, sources: [null] }, base));
});

test("saved source observations retain the exact geography and metric contract", () => {
  const saved = createSession(workspace(), [], [source]);
  assert.throws(() =>
    restoreSession(
      { ...saved, sources: [{ ...source, geometryVintage: "2025-01-01" }] },
      base,
    ),
  );
  const bad = structuredClone(source);
  bad.areas[0].code = "BU_UNKNOWN";
  assert.throws(() => restoreSession({ ...saved, sources: [bad] }, base));
});

test("an axis cannot refer to source fields omitted from the session", () => {
  assert.throws(() => restoreSession(createSession(workspace(), [], []), base));
  const w = initialWorkspace();
  w.blocks[0].y = "priceM2";
  assert.throws(() => restoreSession(createSession(w, [], []), base));
});

test("catalog sources and a custom CSV survive the same compact save", () => {
  const csv: Csv = {
    headers: ["buurtcode", "jaar", "waarde"],
    rows: [
      [observation.code, String(observation.year), String(observation.value)],
    ],
  };
  const mapping: Mapping = {
    code: "buurtcode",
    year: "jaar",
    value: "waarde",
    label: "Inwoners kopie (test)",
    unit: "personen",
  };
  const w = workspace();
  w.blocks.push(createBlock("table", importIdentity(mapping)));
  const saved = createSession(w, [{ csv, mapping }], [source]);
  const serialized = serializeSession(saved);
  const restored = restoreSession(JSON.parse(serialized), base);
  assert.equal(
    getValue(restored.dataset, observation.code, observation.year, metric),
    observation.value,
  );
  assert.equal(
    getValue(
      restored.dataset,
      observation.code,
      observation.year,
      importIdentity(mapping),
    ),
    observation.value,
  );
  assert.equal(restored.imports.length, 1);
  assert.equal(restored.sources.length, 1);
  assert.equal(
    serialized.includes("\n"),
    false,
    "Compact export does not expand beyond its validated byte limit",
  );
});

test("sessions reject malformed imports and unrecognized schemas atomically", () => {
  const w = initialWorkspace();
  const saved = createSession(w, [], []);
  for (const value of [
    null,
    [],
    {},
    { ...saved, version: 2 },
    { ...saved, format: "other" },
    { ...saved, imports: null },
    { ...saved, imports: [{}] },
  ])
    assert.throws(() => restoreSession(value, base));
  assert.equal(
    base.variables.some((v) => v.id === metric),
    false,
  );
});

test("save limits count UTF-8 bytes and normalize an unfinished title", () => {
  const w = initialWorkspace();
  w.name = "   ";
  const saved = createSession(w, [], []);
  assert.equal(saved.workspace.name, "Naamloze werkruimte");
  assert.equal(w.name, "   ");
  assert.throws(
    () =>
      serializeSession({
        ...saved,
        extra: "x".repeat(MAX_SESSION_BYTES),
      } as typeof saved),
    /te groot/,
  );
  assert.throws(
    () =>
      serializeSession({
        ...saved,
        extra: "é".repeat(Math.ceil(MAX_SESSION_BYTES / 2)),
      } as typeof saved),
    /te groot/,
  );
  assert.equal(
    restoreSession(JSON.parse(serializeSession(saved)), base).workspace.name,
    "Naamloze werkruimte",
  );
});

test("optional source caching degrades gracefully when IndexedDB is unavailable", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: undefined,
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  });
  assert.equal(await getCachedSource(definition), null);
  assert.equal(await cacheSource(source), false);
  await forgetCachedSource(definition.id);
});

test("cached sources are reused only within their lifetime and exact definition", async (t) => {
  const now = Date.now();
  const entries = new Map<string, unknown>();
  installIdb(t, entries);
  assert.equal(await cacheSource(source, now), true);
  const cached = await getCachedSource(definition, now + CACHE_TTL - 1);
  assert.equal(cached?.sourceId, definition.id);
  assert.equal(await getCachedSource(definition, now + CACHE_TTL + 1), null);
  assert.equal(await getCachedSource(definition, now - 1), null);
  entries.set(definition.id, {
    id: definition.id,
    cachedAt: now,
    bundle: { ...source, geometryVintage: "2025-01-01" },
  });
  assert.equal(await getCachedSource(definition, now), null);
  entries.set(definition.id, {
    id: definition.id,
    cachedAt: now,
    bundle: { ...source, sourceId: "not-a-source" },
  });
  assert.equal(await getCachedSource(definition, now), null);
});

test("a valid cache hit avoids all source requests and forgotten entries stay absent", async (t) => {
  const entries = new Map<string, unknown>();
  installIdb(t, entries);
  await cacheSource(source);
  const network = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("A fresh cache must not fetch");
  });
  const result = await requestSource(definition);
  assert.equal(result.cacheHit, true);
  assert.equal(result.cacheAvailable, true);
  assert.equal(result.bundle.sourceId, definition.id);
  assert.equal(network.mock.callCount(), 0);
  await forgetCachedSource(definition.id);
  assert.equal(await getCachedSource(definition), null);
});

test("cache write failure is nonfatal and aborted additions cannot return a bundle", async (t) => {
  installIdb(t, new Map(), { failWrite: true });
  assert.equal(await cacheSource(source), false);
  const controller = new AbortController();
  controller.abort();
  const network = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Already aborted additions must not fetch");
  });
  await assert.rejects(
    requestSource(definition, { signal: controller.signal }),
    (error) => (error as Error).name === "AbortError",
  );
  assert.equal(network.mock.callCount(), 0);
});

assert.ok(sourceCatalog.length >= 1);

test("all catalog groups fit a portable workspace without losing their metric identities", async () => {
  const sources = await Promise.all(
    sourceCatalog.map(
      async (definition) =>
        (await json(`../public/${definition.snapshotPath}`)) as SourceBundle,
    ),
  );
  const w = initialWorkspace();
  w.blocks = sourceCatalog.map((definition) =>
    createBlock("table", definition.variables[0].id),
  );
  const serialized = serializeSession(createSession(w, [], sources));
  assert.ok(new TextEncoder().encode(serialized).length < MAX_SESSION_BYTES);
  const restored = restoreSession(JSON.parse(serialized), base);
  assert.equal(restored.sources.length, sourceCatalog.length);
  assert.deepEqual(
    restored.workspace.blocks.map((block) => block.y),
    sourceCatalog.map((definition) => definition.variables[0].id),
  );
  for (const definition of sourceCatalog)
    for (const metric of definition.variables) {
      assert.equal(
        restored.dataset.variables.filter(
          (variable) => variable.id === metric.id,
        ).length,
        1,
      );
    }
});

test("a failed explicit refresh returns a dated snapshot while preserving the previous live cache", async (t) => {
  const entries = new Map<string, unknown>();
  installIdb(t, entries);
  const live = {
    ...structuredClone(source),
    loadedFrom: "live" as const,
    retrievedAt: new Date().toISOString(),
  };
  await cacheSource(live);
  const before = structuredClone(entries.get(definition.id));
  const network = t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://api.data.amsterdam.nl/"))
        return new Response("Unavailable", { status: 503 });
      assert.equal(url, `/${definition.snapshotPath}`);
      return new Response(JSON.stringify(source), { status: 200 });
    },
  );
  const result = await requestSource(definition, { refresh: true });
  assert.equal(result.cacheHit, false);
  assert.equal(result.cacheAvailable, false);
  assert.equal(result.bundle.loadedFrom, "snapshot");
  assert.match(result.bundle.fallbackReason ?? "", /503/);
  assert.equal(result.bundle.retrievedAt, source.retrievedAt);
  assert.deepEqual(entries.get(definition.id), before);
  assert.equal((await getCachedSource(definition))?.loadedFrom, "live");
  assert.ok(network.mock.callCount() >= 2);
});
