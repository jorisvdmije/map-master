import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
  type ReactNode,
  type DragEvent,
} from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Database,
  Download,
  Expand,
  FileJson,
  Filter,
  GripVertical,
  Hash,
  Layers3,
  LayoutDashboard,
  Link2,
  Map,
  MapPin,
  MoreHorizontal,
  MousePointer2,
  Pause,
  Play,
  Plus,
  Redo2,
  Search,
  Table2,
  Trash2,
  TrendingUp,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import {
  loadDataset,
  getValue,
  timeSeries,
  pairedPoints,
  regress,
  formatValue,
  numericVariables,
  percentChange,
  crossesBreak,
  type Dataset,
  type Variable,
} from "./data/model";
import { GeoMap, TimePlot, RegressionPlot } from "./plots";
import {
  initialWorkspace,
  createBlock,
  blockInfo,
  reorderBlocks,
  download,
  csvCell,
  type Block,
  type BlockKind,
  type Workspace,
} from "./workspace";
import {
  parseCsv,
  importSeries,
  importIdentity,
  type Csv,
  type Mapping,
} from "./import";

import {
  sourceCatalog,
  getSource,
  type SourceDefinition,
} from "./data/catalog";
import {
  mergeSource,
  removeSource,
  type SourceBundle,
} from "./data/source-loader";
import { requestSource } from "./data/source-cache";
import { SourceLibrary } from "./source-library";
import {
  STORAGE,
  createSession,
  serializeSession,
  restoreSession,
  type ImportEntry,
} from "./session";

const MarketExample = lazy(() => import("./market/example"));

const icons = {
  map: Map,
  timeseries: TrendingUp,
  regression: Activity,
  ranking: BarChart3,
  table: Table2,
  stat: Hash,
};
type ModalKind =
  | "commands"
  | "blocks"
  | "import"
  | "sources"
  | "library"
  | "help"
  | null;
const num = (v: number) =>
  v.toLocaleString("nl-NL", { maximumFractionDigits: 1 });
function Modal({
  title,
  subtitle,
  children,
  close,
  wide = false,
  library = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
  library?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const root = ref.current!;
    (
      (root.querySelector("input") as HTMLElement | null) ??
      root.querySelector("button")
    )?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
      if (e.key === "Tab") {
        const items = [
          ...root.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]',
          ),
        ].filter((el) => el.getClientRects().length);
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = oldOverflow;
      previous.current?.focus();
    };
  }, [close]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`modal ${wide ? "modal-wide" : ""} ${library ? "modal-library" : ""}`}
      >
        <header>
          <div>
            <h2 id="modal-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Venster sluiten"
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<"workspace" | "market">(() =>
    location.hash.startsWith("#woningmarkt") ? "market" : "workspace",
  );
  useEffect(() => {
    const sync = () =>
      setView(
        location.hash.startsWith("#woningmarkt") ? "market" : "workspace",
      );
    addEventListener("hashchange", sync);
    return () => removeEventListener("hashchange", sync);
  }, []);
  const openMarket = () => {
    setModal(null);
    setPlaying(false);
    setView("market");
    if (!location.hash.startsWith("#woningmarkt"))
      location.hash = "woningmarkt";
    window.scrollTo({ top: 0 });
  };
  const openWorkspace = () => {
    setView("workspace");
    location.hash = "workspace";
    window.scrollTo({ top: 0 });
  };
  const [dataset, setDataset] = useState<Dataset | null>(null),
    [loadError, setLoadError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const [workspace, setWorkspace] = useState<Workspace>(initialWorkspace);
  const [imports, setImports] = useState<ImportEntry[]>([]),
    [ready, setReady] = useState(false);
  const [persistencePaused, setPersistencePaused] = useState(false);
  const [sources, setSources] = useState<SourceBundle[]>([]);
  const [sourceStatuses, setSourceStatuses] = useState<
    Record<string, { phase: "loading" | "error"; message?: string }>
  >({});
  const sourceControllers = useRef(
    new globalThis.Map<string, AbortController>(),
  );
  const datasetRef = useRef(dataset);
  datasetRef.current = dataset;
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const importsRef = useRef(imports);
  importsRef.current = imports;
  useEffect(
    () => () => {
      for (const controller of sourceControllers.current.values())
        controller.abort();
      sourceControllers.current.clear();
    },
    [],
  );
  const [active, setActive] = useState<string | null>(null),
    [sidebar, setSidebar] = useState<"data" | "blocks" | "areas">("data");
  const [query, setQuery] = useState(""),
    [modal, setModal] = useState<ModalKind>(null),
    [notice, setNotice] = useState(""),
    [storageStatus, setStorageStatus] = useState("Laden…");
  const [playing, setPlaying] = useState(false),
    [hint, setHint] = useState(true),
    [dragging, setDragging] = useState<string | null>(null);
  const [csv, setCsv] = useState<Csv | null>(null),
    [mapping, setMapping] = useState<Mapping>({
      code: "",
      year: "",
      value: "",
      label: "Vierkantemeterprijs",
      unit: "€/m²",
    }),
    [importError, setImportError] = useState("");
  const [history, setHistory] = useState<{
    past: Workspace[];
    future: Workspace[];
  }>({ past: [], future: [] });
  const fileInput = useRef<HTMLInputElement>(null);
  const liveWorkspace = useRef(workspace);
  liveWorkspace.current = workspace;
  const close = useCallback(() => {
    setModal(null);
    setImportError("");
  }, []);
  const announce = useCallback((message: string) => setNotice(message), []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    const controller = new AbortController();
    setLoadError("");
    loadDataset(controller.signal)
      .then((base) => {
        let next = base;
        let w = initialWorkspace();
        let ii: ImportEntry[] = [];
        let ss: SourceBundle[] = [];
        try {
          const stored = localStorage.getItem(STORAGE);
          if (stored) {
            const r = restoreSession(JSON.parse(stored), base);
            next = r.dataset;
            w = r.workspace;
            ii = r.imports;
            ss = r.sources;
          }
        } catch {
          setPersistencePaused(true);
          setNotice(
            "De vorige sessie kon niet worden hersteld en blijft bewaard. Download je huidige werk om het veilig te bewaren.",
          );
        }
        setDataset(next);
        setWorkspace(w);
        setImports(ii);
        setSources(ss);
        setActive(w.blocks[0]?.id ?? null);
        setReady(true);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setLoadError(e.message || "De dataset kon niet worden geladen.");
      });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    if (!ready) return;
    if (persistencePaused) {
      setStorageStatus("Herstel mislukt · bewaar je werk via download");
      return;
    }
    setStorageStatus("Opslaan…");
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE,
          serializeSession(createSession(workspace, imports, sources)),
        );
        setStorageStatus("Lokaal opgeslagen");
      } catch {
        setStorageStatus("Opslaan niet gelukt · download je werk");
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [workspace, imports, sources, ready, persistencePaused]);
  const update = useCallback(
    (fn: (w: Workspace) => Workspace, record = true) => {
      const current = liveWorkspace.current;
      const next = fn(current);
      if (record)
        setHistory((h) => ({
          past: [...h.past.slice(-39), current],
          future: [],
        }));
      liveWorkspace.current = next;
      setWorkspace(next);
    },
    [],
  );
  const undo = useCallback(() => {
    if (!history.past.length) return;
    const previous = history.past.at(-1)!;
    setHistory({
      past: history.past.slice(0, -1),
      future: [workspace, ...history.future],
    });
    setWorkspace(previous);
    liveWorkspace.current = previous;
  }, [history, workspace]);
  const redo = useCallback(() => {
    if (!history.future.length) return;
    const next = history.future[0];
    setHistory({
      past: [...history.past, workspace],
      future: history.future.slice(1),
    });
    setWorkspace(next);
    liveWorkspace.current = next;
  }, [history, workspace]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      const typing = /INPUT|SELECT|TEXTAREA/.test(
        (e.target as HTMLElement)?.tagName,
      );
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setModal((m) => (m === "commands" ? null : "commands"));
      }
      if (
        !typing &&
        !modal &&
        view === "workspace" &&
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "z"
      ) {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [modal, undo, redo, view]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        update(
          (w) => ({ ...w, year: w.year >= w.end ? w.start : w.year + 1 }),
          false,
        ),
      1000,
    );
    return () => clearInterval(timer);
  }, [playing, update]);
  const changeBlock = (id: string, changes: Partial<Block>) =>
    update((w) => ({
      ...w,
      blocks: w.blocks.map((b) => (b.id === id ? { ...b, ...changes } : b)),
    }));
  const addBlock = (kind: BlockKind) => {
    if (workspace.blocks.length >= 30) {
      announce("Je kunt maximaal 30 blokken in één werkruimte plaatsen.");
      return;
    }
    const block = createBlock(kind);
    update((w) => ({ ...w, blocks: [...w.blocks, block] }));
    setActive(block.id);
    setModal(null);
    announce(`${blockInfo[kind].label} toegevoegd.`);
    requestAnimationFrame(() =>
      document
        .getElementById(block.id)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
    );
  };
  const selectArea = (code: string) =>
    update((w) => {
      const selected = w.selected.includes(code)
        ? w.selected.filter((c) => c !== code)
        : [...w.selected, code];
      return {
        ...w,
        selected,
        selectionOnly: w.selectionOnly && selected.length > 0,
      };
    });
  const changeYear = (year: number) => {
    setPlaying(false);
    update((w) => ({ ...w, year }), false);
  };
  const assign = (id: string, field: "x" | "y", variableId: string) => {
    const variable = dataset?.variables.find((v) => v.id === variableId),
      block = workspace.blocks.find((b) => b.id === id);
    if (
      !variable ||
      !block ||
      !variable.available ||
      (variable.kind !== "number" &&
        !(
          variableId === "year" &&
          field === "x" &&
          block.kind === "timeseries"
        ))
    ) {
      announce(
        "Kies een numerieke variabele voor deze as. De tijdreeks gebruikt jaar op de X-as.",
      );
      return;
    }
    const changed = {
      ...block,
      [field]: variableId,
      ...(variable.unit === "%" && block.kind === "ranking"
        ? { mode: "value" as const }
        : {}),
    };
    const measures = [
      changed.y,
      ...(changed.kind === "regression" ? [changed.x] : []),
    ].map((key) => dataset!.variables.find((v) => v.id === key)!);
    const compatibleYears = dataset!.years.filter(
      (year) =>
        year >= workspace.start &&
        year <= workspace.end &&
        measures.every((v) => !v.years || v.years.includes(year)),
    );
    const nextYear =
      compatibleYears.includes(workspace.year) || !compatibleYears.length
        ? workspace.year
        : compatibleYears.at(-1)!;
    update((w) => ({
      ...w,
      year: nextYear,
      blocks: w.blocks.map((b) => (b.id === id ? changed : b)),
    }));
    if (nextYear !== workspace.year) {
      setPlaying(false);
      announce(
        `Bronjaar ${nextYear} gekozen: de gebruikte variabelen zijn niet voor ${workspace.year} beschikbaar.`,
      );
    } else if (!compatibleYears.length)
      announce(
        "Deze combinatie heeft geen gezamenlijk bronjaar binnen de gekozen periode. Pas je periode of variabelen aan.",
      );
    setActive(id);
  };
  const activeBlock =
    workspace.blocks.find((b) => b.id === active) ?? workspace.blocks[0];
  const fieldDrag = (e: DragEvent, id: string) => {
    e.dataTransfer.setData("application/atlas-variable", id);
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "copy";
    setDragging(id);
  };
  const save = () => {
    try {
      download(
        `${workspace.name.replace(/[^\p{L}\p{N}]+/gu, "-")}.atlas.json`,
        serializeSession(createSession(workspace, imports, sources)),
      );
    } catch (e) {
      announce((e as Error).message);
    }
  };
  const readFile = async (file?: File) => {
    if (!file) return;
    setImportError("");
    if (file.size > 10 * 1024 * 1024) {
      setImportError("Gebruik een bestand van maximaal 10 MB.");
      setModal("import");
      return;
    }
    try {
      const text = await file.text();
      if (file.name.endsWith(".json")) {
        if (!dataset) return;
        // Reopen against the built-in dataset; imported series are included in the file.
        const base = await loadDataset();
        const result = restoreSession(JSON.parse(text), base);
        for (const controller of sourceControllers.current.values())
          controller.abort();
        sourceControllers.current.clear();
        setSourceStatuses({});
        datasetRef.current = result.dataset;
        sourcesRef.current = result.sources;
        setSources(result.sources);
        setPersistencePaused(false);
        update(() => result.workspace);
        setDataset(result.dataset);
        setImports(result.imports);
        setActive(result.workspace.blocks[0]?.id ?? null);
        setHistory({ past: [], future: [] });
        setModal(null);
        announce("Werkruimte geopend, inclusief eigen data.");
      } else {
        const parsed = parseCsv(text);
        setCsv(parsed);
        const find = (terms: RegExp, fallback: number) =>
          parsed.headers.find((h) => terms.test(h)) ??
          parsed.headers[fallback] ??
          "";
        setMapping({
          code: find(/code|buurt|area/i, 0),
          year: find(/jaar|year|date/i, 1),
          value: find(/prij|price|value|waarde|m2/i, 2),
          label: "Vierkantemeterprijs",
          unit: "€/m²",
        });
        setModal("import");
      }
    } catch (e) {
      setImportError((e as Error).message);
      setModal("import");
    }
  };
  const finishImport = () => {
    if (!dataset || !csv) return;
    try {
      const next = importSeries(dataset, csv, mapping);
      const nextImports = [
        ...imports.filter(
          (i) => importIdentity(i.mapping) !== importIdentity(mapping),
        ),
        { csv, mapping },
      ];
      if (nextImports.length > 20)
        throw new Error(
          "Een werkruimte ondersteunt maximaal 20 eigen variabelen. Open een nieuwe werkruimte voor meer data.",
        );
      serializeSession(createSession(workspace, nextImports, sources));
      datasetRef.current = next;
      setDataset(next);
      setImports(nextImports);
      setCsv(null);
      close();
      announce(
        `${mapping.label} is toegevoegd. Sleep de variabele naar een as.`,
      );
    } catch (e) {
      setImportError((e as Error).message);
    }
  };
  const cancelSource = (id: string) => {
    sourceControllers.current.get(id)?.abort();
    sourceControllers.current.delete(id);
    setSourceStatuses((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };
  const addSource = async (id: string, refresh = false) => {
    const def = getSource(id);
    if (!def || !datasetRef.current) {
      announce("Wacht tot de basisdata geladen zijn.");
      return;
    }
    if (
      sourceControllers.current.has(id) ||
      (!refresh && sourcesRef.current.some((s) => s.sourceId === id))
    )
      return;
    const controller = new AbortController();
    sourceControllers.current.set(id, controller);
    setSourceStatuses((current) => ({
      ...current,
      [id]: { phase: "loading" },
    }));
    try {
      const result = await requestSource(def, {
        signal: controller.signal,
        refresh,
      });
      if (
        controller.signal.aborted ||
        sourceControllers.current.get(id) !== controller
      )
        return;
      const previous = sourcesRef.current.find((s) => s.sourceId === id);
      if (refresh && previous && result.bundle.fallbackReason)
        throw new Error(
          "De live bron kon niet worden ververst. Je bestaande gegevens zijn behouden.",
        );
      const nextSources = [
        ...sourcesRef.current.filter((s) => s.sourceId !== id),
        result.bundle,
      ];
      serializeSession(
        createSession(liveWorkspace.current, importsRef.current, nextSources),
      );
      const next = mergeSource(datasetRef.current!, result.bundle);
      datasetRef.current = next;
      sourcesRef.current = nextSources;
      setDataset(next);
      setSources(nextSources);
      setSourceStatuses((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      announce(
        `${def.title} ${refresh ? "ververst" : "toegevoegd"}${result.cacheHit ? " uit de browsercache" : result.bundle.loadedFrom === "snapshot" ? " uit een gecontroleerde momentopname" : ""}. De variabelen staan in de zijbalk.`,
      );
    } catch (e) {
      if (
        !controller.signal.aborted &&
        sourceControllers.current.get(id) === controller
      )
        setSourceStatuses((current) => ({
          ...current,
          [id]: {
            phase: "error",
            message: (e as Error).message || "Laden mislukt. Probeer opnieuw.",
          },
        }));
    } finally {
      if (sourceControllers.current.get(id) === controller)
        sourceControllers.current.delete(id);
    }
  };
  const usedSourceIds = sources
    .filter((source) =>
      workspace.blocks.some((b) =>
        source.variables.some((v) => v.id === b.x || v.id === b.y),
      ),
    )
    .map((s) => s.sourceId);
  const removeLoadedSource = (id: string) => {
    const def = getSource(id);
    if (!def || !datasetRef.current) return;
    if (usedSourceIds.includes(id)) {
      announce(
        "Deze bron wordt gebruikt in een blok. Kies eerst een andere variabele.",
      );
      return;
    }
    cancelSource(id);
    const next = removeSource(datasetRef.current, def),
      nextSources = sourcesRef.current.filter((s) => s.sourceId !== id);
    datasetRef.current = next;
    sourcesRef.current = nextSources;
    setDataset(next);
    setSources(nextSources);
    setHistory({ past: [], future: [] });
    announce(
      `${def.title} uit de werkruimte verwijderd. De browsercache blijft beschikbaar.`,
    );
  };
  const visibleAreas = useMemo(
    () =>
      dataset?.areas.filter(
        (a) => !workspace.selectionOnly || workspace.selected.includes(a.code),
      ) ?? [],
    [dataset, workspace.selected, workspace.selectionOnly],
  );
  const filteredVariables =
    dataset?.variables.filter((v) =>
      `${v.label} ${v.description} ${v.unit}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];
  const variables = dataset ? numericVariables(dataset) : [];
  const variable = (id: string) => dataset!.variables.find((v) => v.id === id)!;
  const fmt = (id: string) => (value: number | null) =>
    formatValue(value, variable(id));
  const yearOptions = dataset?.years ?? [];

  function renderField(v: Variable) {
    return (
      <div
        className={`field-row ${!v.available ? "unavailable" : ""}`}
        key={v.id}
        title={`${v.description}${v.years?.length ? ` Beschikbaar: ${v.years.join(", ")}.` : ""}`}
      >
        <button
          draggable={v.available}
          onDragStart={(e) => fieldDrag(e, v.id)}
          onDragEnd={() => setDragging(null)}
          className="field-assign"
          aria-label={
            v.available
              ? `${v.label} toewijzen aan actief blok`
              : `${v.label} importeren`
          }
          onClick={() => {
            if (!v.available) {
              setCsv(null);
              setModal("import");
            } else if (activeBlock) assign(activeBlock.id, "y", v.id);
            else announce("Voeg eerst een blok toe.");
          }}
        >
          <GripVertical size={12} />
          <Hash size={14} />
          <span>{v.label}</span>
          <small>{v.unit}</small>
        </button>
      </div>
    );
  }
  function axis(block: Block, field: "x" | "y", label: string) {
    const locked = field === "x" && block.kind === "timeseries";
    return (
      <label
        className={`axis-drop ${dragging && !locked ? "drop-ready" : ""}`}
        onDragOver={(e) => {
          if (
            !locked &&
            e.dataTransfer.types.includes("application/atlas-variable")
          ) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          assign(
            block.id,
            field,
            e.dataTransfer.getData("application/atlas-variable"),
          );
          setDragging(null);
        }}
      >
        <span>{label}</span>
        <Hash size={12} />
        <select
          aria-label={`${label} · ${block.title}`}
          value={block[field]}
          onChange={(e) => assign(block.id, field, e.target.value)}
        >
          {locked ? (
            <option value="year">Jaar</option>
          ) : (
            variables.map((v) => (
              <option value={v.id} key={v.id}>
                {v.label}
              </option>
            ))
          )}
        </select>
        <ChevronDown size={11} />
      </label>
    );
  }
  function blockContent(block: Block) {
    if (!dataset) return null;
    const periodGrowth =
      block.kind === "ranking" &&
      block.mode === "growth" &&
      variable(block.y).unit !== "%";
    const vf = periodGrowth
      ? (value: number | null) => formatValue(value, "%")
      : fmt(block.y);
    const values = new globalThis.Map(
      dataset.areas.map((a) => [
        a.code,
        getValue(dataset, a.code, workspace.year, block.y),
      ]),
    );
    const rows = visibleAreas
      .map((a) => ({
        ...a,
        value: periodGrowth
          ? crossesBreak(a, workspace.start, workspace.year) ||
            (block.y === "homes" &&
              workspace.start < 2015 &&
              workspace.year >= 2015)
            ? null
            : percentChange(
                getValue(dataset, a.code, workspace.start, block.y),
                values.get(a.code) ?? null,
              )
          : (values.get(a.code) ?? null),
      }))
      .filter((a) => a.value !== null)
      .sort((a, b) => b.value! - a.value! || a.name.localeCompare(b.name));
    if (block.kind === "map")
      return (
        <>
          <div className="block-context">
            <span>
              <i className="status-dot" />
              Buurtgrenzen 2022
            </span>
            <span>
              {rows.length} met data · {workspace.year}
            </span>
          </div>
          <GeoMap
            geometry={dataset.geometry}
            values={values}
            selected={workspace.selected}
            onSelect={selectArea}
            format={vf}
          />
          <div className="block-foot">
            <MousePointer2 size={12} />
            <span>Klik op buurten om ze in alle blokken te selecteren</span>
          </div>
        </>
      );
    if (block.kind === "timeseries") {
      const selected = workspace.selected.length
        ? dataset.areas.filter((a) => workspace.selected.includes(a.code))
        : dataset.areas.filter((a) =>
            ["BU0363AA02", "BU0363AB03", "BU0363AA03"].includes(a.code),
          );
      const series = selected.slice(0, 8).map((a) => ({
        code: a.code,
        name: a.name,
        points: timeSeries(
          dataset,
          a.code,
          block.y,
          workspace.start,
          workspace.end,
          block.mode,
        ),
      }));
      const plotFormat =
        block.mode === "index"
          ? (n: number | null) => (n === null ? "—" : num(n))
          : block.mode === "growth"
            ? (n: number | null) => (n === null ? "—" : `${num(n)}%`)
            : vf;
      return (
        <>
          <div className="block-context">
            <span>
              {workspace.selected.length
                ? `${Math.min(8, selected.length)} geselecteerde buurten`
                : "3 voorbeeldbuurten · klik op de kaart om te vergelijken"}
              {selected.length > 8 ? " · eerste 8 getoond" : ""}
            </span>
            <div className="segment mini" aria-label="Weergave tijdreeks">
              {(["value", "index", "growth"] as const).map((mode, i) => (
                <button
                  aria-pressed={block.mode === mode}
                  key={mode}
                  onClick={() => changeBlock(block.id, { mode })}
                >
                  {["Waarde", "Index", "Δ %"][i]}
                </button>
              ))}
            </div>
          </div>
          {block.mode === "index" &&
          series.every((s) => s.points.every((p) => p.value === null)) ? (
            <div className="plot-empty">
              <p>
                Geen basiswaarde in {workspace.start}. Kies een beginjaar met
                gepubliceerde waarden om te indexeren.
              </p>
            </div>
          ) : (
            <TimePlot
              series={series}
              year={workspace.year}
              onYear={changeYear}
              format={plotFormat}
            />
          )}
          <div className="block-foot">
            <span>
              {block.mode === "index"
                ? `${workspace.start} = 100`
                : block.mode === "growth"
                  ? "Relatieve verandering t.o.v. vorig bronjaar"
                  : "Bronjaar op de X-as"}{" "}
              · gaten blijven onbekend
            </span>
            <span>
              {workspace.start} — {workspace.end}
            </span>
          </div>
        </>
      );
    }
    if (block.kind === "regression") {
      const points = pairedPoints(
        dataset,
        workspace.year,
        block.x,
        block.y,
        visibleAreas.map((a) => a.code),
      ).map((p) => ({ ...p, code: p.code!, name: p.name! }));
      const fit = regress(points);
      return (
        <>
          <div className="block-context">
            <span>
              <i className="status-dot purple" />
              {points.length} complete buurtparen · {workspace.year}
            </span>
            <span className="fit-tag">OLS · lineair</span>
          </div>
          <RegressionPlot
            points={points}
            selected={workspace.selected}
            onSelect={selectArea}
            fit={fit}
            formatX={fmt(block.x)}
            formatY={vf}
          />
          <div className="regression-stats">
            <div>
              <span>Verklaarde variantie</span>
              <strong>
                R²{" "}
                {fit?.r2 == null
                  ? "—"
                  : fit.r2.toLocaleString("nl-NL", {
                      maximumFractionDigits: 3,
                    })}
              </strong>
            </div>
            <div>
              <span>Steekproef</span>
              <strong>n = {points.length}</strong>
            </div>
            <p>
              {fit
                ? "Verband is geen oorzaak. Eén punt per buurt; geen samengevoegde tijdreeksen."
                : "Voor een regressie zijn minstens 3 complete buurtparen en variatie in X nodig."}
            </p>
          </div>
          {fit && (
            <div className="regression-equation">
              <span>Model</span>
              <code>
                ŷ = {num(fit.intercept)} {fit.slope < 0 ? "−" : "+"}{" "}
                {Math.abs(fit.slope).toLocaleString("nl-NL", {
                  maximumFractionDigits: 3,
                })}{" "}
                × x
              </code>
            </div>
          )}
        </>
      );
    }
    if (block.kind === "ranking")
      return (
        <>
          <div className="block-context">
            <span>
              {periodGrowth
                ? `Groei ${workspace.start}–${workspace.year}`
                : `Hoog naar laag · ${workspace.year}`}
            </span>
            <div className="segment mini">
              <button
                aria-pressed={!periodGrowth}
                onClick={() => changeBlock(block.id, { mode: "value" })}
              >
                Waarde
              </button>
              <button
                disabled={variable(block.y).unit === "%"}
                aria-pressed={periodGrowth}
                onClick={() => changeBlock(block.id, { mode: "growth" })}
              >
                Periodegroei
              </button>
            </div>
          </div>
          <div className="ranking-list">
            {rows.slice(0, 7).map((a, i) => (
              <button
                className={
                  workspace.selected.includes(a.code) ? "selected" : ""
                }
                key={a.code}
                onClick={() => selectArea(a.code)}
                aria-pressed={workspace.selected.includes(a.code)}
              >
                <span className="rank-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="rank-main">
                  <span>{a.name}</span>
                  <i
                    style={{
                      width: `${Math.max(2, (Math.abs(a.value!) / Math.max(...rows.map((r) => Math.abs(r.value!)), 1)) * 100)}%`,
                    }}
                  />
                </span>
                <strong>{vf(a.value)}</strong>
              </button>
            ))}
            {!rows.length && (
              <p className="empty-inline">
                Geen waarden voor deze selectie en dit jaar.
              </p>
            )}
          </div>
          <div className="block-foot">
            <span>
              {rows.length} buurten met data ·{" "}
              {periodGrowth
                ? "verandering van beginjaar tot actief jaar"
                : "kies Periodegroei om ontwikkelingen te vergelijken"}
            </span>
          </div>
        </>
      );
    if (block.kind === "table")
      return (
        <>
          <div className="block-context">
            <span>
              {rows.length} waarden · {visibleAreas.length - rows.length}{" "}
              ontbrekend
            </span>
            <span>{workspace.year}</span>
          </div>
          <div className="data-table">
            <table>
              <thead>
                <tr>
                  <th>Buurt</th>
                  <th>Code</th>
                  <th>{variable(block.y).label}</th>
                </tr>
              </thead>
              <tbody>
                {visibleAreas.map((a) => (
                  <tr
                    key={a.code}
                    className={
                      workspace.selected.includes(a.code) ? "selected" : ""
                    }
                  >
                    <td>
                      <button
                        onClick={() => selectArea(a.code)}
                        aria-pressed={workspace.selected.includes(a.code)}
                      >
                        {a.name}
                      </button>
                    </td>
                    <td>{a.code}</td>
                    <td>{vf(values.get(a.code) ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      );
    const sorted = rows.map((a) => a.value!).sort((a, b) => a - b);
    const n = sorted.length;
    const median = n
      ? n % 2
        ? sorted[Math.floor(n / 2)]
        : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : null;
    return (
      <div className="stat-display">
        <span>Mediaan over buurten · {workspace.year}</span>
        <strong>{vf(median)}</strong>
        <div className="stat-spark">
          <TrendingUp size={20} />
          <span>{n} buurten met gepubliceerde data</span>
        </div>
        <p>
          Iedere buurt telt even zwaar. Dit is geen gewogen stadsgemiddelde.
        </p>
      </div>
    );
  }
  function exportBlock(block: Block) {
    if (!dataset) return;
    const regression = block.kind === "regression";
    const growth =
      block.kind === "ranking" &&
      block.mode === "growth" &&
      variable(block.y).unit !== "%";
    const header = [
      "buurtcode",
      "buurt",
      "bronjaar",
      ...(regression ? [block.x] : []),
      block.y,
      ...(growth ? ["periode_van", "beginwaarde", "groei_pct"] : []),
      "eenheid",
      "bron",
      "gebiedsindeling",
      "opgehaald_op",
      ...(regression ? ["x_eenheid", "x_bron", "x_opgehaald_op"] : []),
    ];
    const years =
      block.kind === "timeseries"
        ? dataset.years.filter(
            (y) => y >= workspace.start && y <= workspace.end,
          )
        : [workspace.year];
    const rows = visibleAreas.flatMap((a) =>
      years.map((year) => [
        a.code,
        a.name,
        year,
        ...(regression ? [getValue(dataset, a.code, year, block.x)] : []),
        getValue(dataset, a.code, year, block.y),
        ...(growth
          ? [
              workspace.start,
              getValue(dataset, a.code, workspace.start, block.y),
              crossesBreak(a, workspace.start, year) ||
              (block.y === "homes" && workspace.start < 2015 && year >= 2015)
                ? null
                : percentChange(
                    getValue(dataset, a.code, workspace.start, block.y),
                    getValue(dataset, a.code, year, block.y),
                  ),
            ]
          : []),
        variable(block.y).unit,
        variable(block.y).source,
        dataset.meta.geometryVintage,
        variable(block.y).retrievedAt ??
          (variable(block.y).source === "Eigen CSV-import"
            ? ""
            : dataset.meta.retrievedAt),
        ...(regression
          ? [
              variable(block.x).unit,
              variable(block.x).source,
              variable(block.x).retrievedAt ??
                (variable(block.x).source === "Eigen CSV-import"
                  ? ""
                  : dataset.meta.retrievedAt),
            ]
          : []),
      ]),
    );
    download(
      `${block.kind}-${block.y}.csv`,
      "\uFEFF" +
        [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n"),
      "text/csv;charset=utf-8",
    );
  }

  return (
    <div className="app-shell" data-ready={ready}>
      <nav className="nav-rail" aria-label="Hoofdnavigatie">
        <a
          href="#workspace"
          className="brand-mark"
          aria-label="Atlas werkruimte"
        >
          <Layers3 size={22} />
        </a>
        <div className="rail-main">
          <button
            className={`rail-button ${view === "workspace" ? "current" : ""}`}
            title="Werkruimte"
            aria-label="Werkruimte"
            onClick={() => {
              openWorkspace();
              setSidebar("data");
              document.getElementById("workspace")?.scrollIntoView();
            }}
          >
            <LayoutDashboard size={20} />
          </button>
          <button
            className={`rail-button ${view === "market" ? "current" : ""}`}
            title="Woningmarkt tijdmachine"
            aria-label="Woningmarkt tijdmachine"
            onClick={openMarket}
          >
            <Activity size={20} />
          </button>
          <button
            className="rail-button"
            title="Databronnen"
            aria-label="Databronnen"
            onClick={() => setModal("library")}
          >
            <Database size={20} />
          </button>
          <button
            className="rail-button"
            title="Blok toevoegen"
            aria-label="Blok toevoegen"
            onClick={() => setModal("blocks")}
          >
            <Plus size={21} />
          </button>
        </div>
        <div className="rail-bottom">
          <button
            className="rail-button"
            aria-label="Uitleg en sneltoetsen"
            onClick={() => setModal("help")}
          >
            <CircleHelp size={20} />
          </button>
          <div className="avatar" title="Lokale werkruimte">
            JI
          </div>
        </div>
      </nav>
      <div className="app-body">
        <header className="topbar">
          <div className="brand-name">
            atlas<span>Ruimte voor inzicht</span>
          </div>
          <div className="breadcrumb">
            <span>Werkruimtes</span>
            <ChevronRight size={12} />
            <strong>Amsterdam</strong>
          </div>
          <button
            className="command-trigger"
            onClick={() => setModal("commands")}
          >
            <Search size={15} />
            <span>Zoek data, blokken, functies…</span>
            <kbd>⌘ K</kbd>
          </button>
          <button
            className="icon-button help-top"
            aria-label="Help"
            onClick={() => setModal("help")}
          >
            <CircleHelp size={17} />
          </button>
        </header>
        {view === "market" ? (
          <Suspense
            fallback={
              <div className="loading-state">
                <div className="loading-spinner" />
                <p>Voorbeeldanalyse laden…</p>
              </div>
            }
          >
            <MarketExample dataset={dataset} onBack={openWorkspace} />
          </Suspense>
        ) : (
          <div className="app-content">
            <aside className="sidebar">
              <div className="sidebar-heading">
                <div>
                  <span className="eyebrow">JE GEREEDSCHAP</span>
                  <h2>Verkennen</h2>
                </div>
                <button
                  className="icon-button"
                  aria-label="Data toevoegen"
                  onClick={() => setModal("library")}
                >
                  <Plus size={17} />
                </button>
              </div>
              <div
                className="sidebar-tabs"
                role="tablist"
                aria-label="Verkennen"
              >
                <button
                  role="tab"
                  aria-selected={sidebar === "data"}
                  onClick={() => setSidebar("data")}
                >
                  Data
                </button>
                <button
                  role="tab"
                  aria-selected={sidebar === "blocks"}
                  onClick={() => setSidebar("blocks")}
                >
                  Blokken
                </button>
                <button
                  role="tab"
                  aria-selected={sidebar === "areas"}
                  onClick={() => setSidebar("areas")}
                >
                  Buurten
                </button>
              </div>
              <div className="sidebar-search">
                <Search size={14} />
                <input
                  aria-label="Zoeken in zijbalk"
                  placeholder={
                    sidebar === "data"
                      ? "Zoek een variabele…"
                      : sidebar === "blocks"
                        ? "Zoek een blok…"
                        : "Zoek een buurt…"
                  }
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    className="icon-button"
                    aria-label="Zoekopdracht wissen"
                    onClick={() => setQuery("")}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <div className="sidebar-scroll">
                {sidebar === "data" ? (
                  <>
                    <button
                      className="browse-sources"
                      onClick={() => setModal("library")}
                    >
                      <Database size={15} />
                      <span>
                        Bronnenbibliotheek
                        <small>
                          {sources.length + 1} datasets in je werkruimte
                        </small>
                      </span>
                      <Plus size={14} />
                    </button>
                    <button className="market-launch" onClick={openMarket}>
                      <Activity size={17} />
                      <span>
                        Woningmarkt tijdmachine
                        <small>Voorspel · onthul · onderzoek</small>
                      </span>
                      <ArrowUpRight size={13} />
                    </button>
                    <div className="dataset-heading">
                      <div className="dataset-icon">
                        <Database size={16} />
                      </div>
                      <div>
                        <strong>Amsterdam</strong>
                        <span>Buurtdata · tijd en ruimte</span>
                      </div>
                      <ChevronDown size={13} />
                    </div>
                    <div className="dataset-meta">
                      <span>
                        <i className="status-dot" />
                        O&S Amsterdam
                      </span>
                      <span>2012–2026</span>
                    </div>
                    <p className="field-hint">
                      Sleep een variabele naar een as.
                      <br />
                      Of klik om het actieve blok te wijzigen.
                    </p>
                    <div className="field-group-label">
                      DIMENSIES <span>2</span>
                    </div>
                    {filteredVariables
                      .filter((v) => v.kind !== "number")
                      .map((v) => (
                        <div
                          className="field-row dimension"
                          key={v.id}
                          draggable
                          onDragStart={(e) => fieldDrag(e, v.id)}
                          onDragEnd={() => setDragging(null)}
                        >
                          <GripVertical size={12} />
                          {v.kind === "time" ? (
                            <CalendarDays size={14} />
                          ) : (
                            <MapPin size={14} />
                          )}
                          <span>{v.label}</span>
                          <small>{v.kind === "time" ? "tijd" : "geo"}</small>
                        </div>
                      ))}
                    <div className="field-group-label">
                      VARIABELEN <span>{variables.length}</span>
                    </div>
                    {filteredVariables
                      .filter((v) => v.kind === "number" && !v.sourceId)
                      .map(renderField)}
                    {sources.map((source) => (
                      <div className="source-field-group" key={source.sourceId}>
                        <button
                          className="field-source-heading"
                          onClick={() => setModal("library")}
                        >
                          <Database size={11} />
                          <span>{getSource(source.sourceId)?.title}</span>
                          <small>
                            {source.years[0]}–{source.years.at(-1)}
                          </small>
                        </button>
                        {filteredVariables
                          .filter((v) => v.sourceId === source.sourceId)
                          .map(renderField)}
                      </div>
                    ))}
                    {!filteredVariables.length && (
                      <p className="empty-inline">Geen variabelen gevonden.</p>
                    )}
                    <button
                      className="add-data"
                      onClick={() => {
                        setCsv(null);
                        setModal("import");
                      }}
                    >
                      <Plus size={14} />
                      Eigen data toevoegen
                    </button>
                    <div className="source-card">
                      <div>
                        <CheckCircle2 size={14} />
                        <strong>Echte data, helder gedefinieerd</strong>
                      </div>
                      <p>
                        WOZ per woning. Geen verkoopprijs. Ontbrekende cijfers
                        blijven leeg.
                      </p>
                      <button onClick={() => setModal("sources")}>
                        Bekijk bronnen & definities <ArrowUpRight size={12} />
                      </button>
                    </div>
                  </>
                ) : sidebar === "blocks" ? (
                  <div className="sidebar-blocks">
                    {(Object.keys(blockInfo) as BlockKind[])
                      .filter((k) =>
                        (blockInfo[k].label + " " + blockInfo[k].description)
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                      )
                      .map((kind) => {
                        const Icon = icons[kind];
                        return (
                          <button
                            key={kind}
                            onClick={() => addBlock(kind)}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData(
                                "application/atlas-block-kind",
                                kind,
                              );
                              e.dataTransfer.effectAllowed = "copy";
                            }}
                          >
                            <div className={`block-type-icon ${kind}`}>
                              <Icon size={18} />
                            </div>
                            <div>
                              <strong>{blockInfo[kind].label}</strong>
                              <span>{blockInfo[kind].description}</span>
                            </div>
                            <Plus size={13} />
                          </button>
                        );
                      })}
                  </div>
                ) : (
                  <div className="area-list">
                    <p className="field-hint">
                      Een selectie is zichtbaar in alle blokken.
                    </p>
                    {dataset?.areas
                      .filter((a) =>
                        `${a.name} ${a.code}`
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                      )
                      .map((a) => (
                        <button
                          key={a.code}
                          aria-pressed={workspace.selected.includes(a.code)}
                          onClick={() => selectArea(a.code)}
                        >
                          <span className="check-box">
                            {workspace.selected.includes(a.code) && (
                              <Check size={12} />
                            )}
                          </span>
                          <span>
                            {a.name}
                            <small>{a.code}</small>
                          </span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
              <div className="sidebar-footer">
                <span className="local-dot" />
                Jouw data blijft in deze browser
                <button
                  className="icon-button"
                  aria-label="Over lokale opslag"
                  onClick={() => setModal("help")}
                >
                  <CircleHelp size={12} />
                </button>
              </div>
            </aside>
            <main id="workspace" className="workspace">
              <div className="workspace-heading">
                <div>
                  <div className="heading-overline">
                    <span className="project-badge">
                      <MapPin size={11} />
                      AMSTERDAM
                    </span>
                    <span className="divider-dot">/</span>
                    <span>Verkennende analyse</span>
                  </div>
                  <input
                    className="workspace-title"
                    aria-label="Naam werkruimte"
                    maxLength={120}
                    value={workspace.name}
                    onChange={(e) =>
                      update((w) => ({ ...w, name: e.target.value }), false)
                    }
                    onBlur={() => {
                      if (!workspace.name.trim())
                        update((w) => ({ ...w, name: "Naamloze werkruimte" }));
                    }}
                  />
                  <p>
                    Ontdek hoe je stad verandert. Verbind tijd, plaats en de
                    vraag die jij hebt.
                  </p>
                </div>
                <div className="workspace-actions">
                  <div className="history-buttons">
                    <button
                      className="icon-button"
                      aria-label="Ongedaan maken"
                      disabled={!history.past.length}
                      onClick={undo}
                    >
                      <Undo2 size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Opnieuw uitvoeren"
                      disabled={!history.future.length}
                      onClick={redo}
                    >
                      <Redo2 size={16} />
                    </button>
                  </div>
                  <button
                    className="button secondary"
                    onClick={save}
                    disabled={!ready}
                  >
                    <Download size={14} />
                    Bewaar werkruimte
                  </button>
                  <button
                    className="button primary"
                    onClick={() => setModal("blocks")}
                    disabled={!ready}
                  >
                    <Plus size={15} />
                    Blok toevoegen
                  </button>
                </div>
              </div>
              {!ready ? (
                <div className="loading-state">
                  {loadError ? (
                    <>
                      <Database size={32} />
                      <h2>De bron is even niet bereikbaar</h2>
                      <p>{loadError}</p>
                      <button
                        className="button primary"
                        onClick={() => setAttempt((a) => a + 1)}
                      >
                        Opnieuw proberen
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="loading-spinner" />
                      <h2>Amsterdam wordt klaargezet</h2>
                      <p>De buurtgrenzen en tijdreeksen worden geladen.</p>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <section
                    className="time-toolbar"
                    aria-label="Tijd en selectie"
                  >
                    <div className="time-period">
                      <CalendarDays size={16} />
                      <span>Periode</span>
                      <select
                        aria-label="Beginjaar"
                        value={workspace.start}
                        onChange={(e) => {
                          setPlaying(false);
                          update((w) => ({
                            ...w,
                            start: +e.target.value,
                            year: Math.max(+e.target.value, w.year),
                          }));
                        }}
                      >
                        {yearOptions
                          .filter((y) => y < workspace.end)
                          .map((y) => (
                            <option key={y}>{y}</option>
                          ))}
                      </select>
                      <ArrowRight size={12} />
                      <select
                        aria-label="Eindjaar"
                        value={workspace.end}
                        onChange={(e) => {
                          setPlaying(false);
                          update((w) => ({
                            ...w,
                            end: +e.target.value,
                            year: Math.min(+e.target.value, w.year),
                          }));
                        }}
                      >
                        {yearOptions
                          .filter((y) => y > workspace.start)
                          .map((y) => (
                            <option key={y}>{y}</option>
                          ))}
                      </select>
                    </div>
                    <div className="timeline-control">
                      <button
                        className={`play-button ${playing ? "playing" : ""}`}
                        aria-label={
                          playing ? "Tijdlijn pauzeren" : "Tijdlijn afspelen"
                        }
                        onClick={() => setPlaying((p) => !p)}
                      >
                        {playing ? <Pause size={12} /> : <Play size={12} />}
                      </button>
                      <input
                        aria-label="Actief bronjaar"
                        type="range"
                        min={workspace.start}
                        max={workspace.end}
                        value={workspace.year}
                        onChange={(e) => changeYear(+e.target.value)}
                        style={
                          {
                            "--progress": `${(100 * (workspace.year - workspace.start)) / (workspace.end - workspace.start)}%`,
                          } as React.CSSProperties
                        }
                      />
                      <span className="current-year">{workspace.year}</span>
                    </div>
                    <div className="selection-control">
                      <button
                        className={
                          workspace.selectionOnly
                            ? "filter-button selected"
                            : "filter-button"
                        }
                        aria-pressed={workspace.selectionOnly}
                        disabled={!workspace.selected.length}
                        onClick={() =>
                          update((w) => ({
                            ...w,
                            selectionOnly: !w.selectionOnly,
                          }))
                        }
                      >
                        <Filter size={13} />
                        {workspace.selectionOnly
                          ? "Alleen selectie"
                          : "Alle buurten"}
                        <span>
                          {workspace.selectionOnly
                            ? workspace.selected.length
                            : dataset!.areas.length}
                        </span>
                      </button>
                      {!!workspace.selected.length && (
                        <button
                          className="clear-selection"
                          title="Selectie wissen"
                          aria-label="Selectie wissen"
                          onClick={() =>
                            update((w) => ({
                              ...w,
                              selected: [],
                              selectionOnly: false,
                            }))
                          }
                        >
                          <X size={13} />
                          {workspace.selected.length}
                        </button>
                      )}
                    </div>
                  </section>
                  {hint && (
                    <div
                      className={`workspace-hint ${dragging ? "is-dragging" : ""}`}
                    >
                      <div className="hint-icon">
                        <MousePointer2 size={16} />
                      </div>
                      <p>
                        <strong>Een andere vraag? Een andere variabele.</strong>{" "}
                        Sleep een variabele uit de zijbalk naar een as in een
                        blok. Alle blokken delen dezelfde tijdlijn.
                      </p>
                      <button
                        className="icon-button"
                        aria-label="Tip sluiten"
                        onClick={() => setHint(false)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  <div className="canvas-heading">
                    <div>
                      <LayoutDashboard size={14} />
                      <span>Jouw inzichten</span>
                      <small>{workspace.blocks.length} blokken</small>
                    </div>
                    <span>
                      <Link2 size={12} />
                      Selecties zijn verbonden
                    </span>
                  </div>
                  <div
                    className="block-grid"
                    onDragOver={(e) => {
                      if (
                        e.dataTransfer.types.includes(
                          "application/atlas-block-kind",
                        )
                      )
                        e.preventDefault();
                    }}
                    onDrop={(e) => {
                      const kind = e.dataTransfer.getData(
                        "application/atlas-block-kind",
                      ) as BlockKind;
                      if (Object.hasOwn(blockInfo, kind)) {
                        e.preventDefault();
                        addBlock(kind);
                      }
                    }}
                  >
                    {workspace.blocks.map((block, index) => {
                      const Icon = icons[block.kind];
                      return (
                        <section
                          id={block.id}
                          key={block.id}
                          className={`insight-block ${block.wide ? "wide" : ""} ${activeBlock?.id === block.id ? "active" : ""}`}
                          data-kind={block.kind}
                          onClick={() => setActive(block.id)}
                          onDragOver={(e) => {
                            if (
                              e.dataTransfer.types.includes(
                                "application/atlas-reorder",
                              )
                            ) {
                              e.preventDefault();
                              e.currentTarget.classList.add("reorder-target");
                            } else if (
                              e.dataTransfer.types.includes(
                                "application/atlas-variable",
                              )
                            )
                              e.preventDefault();
                          }}
                          onDragLeave={(e) =>
                            e.currentTarget.classList.remove("reorder-target")
                          }
                          onDrop={(e) => {
                            e.currentTarget.classList.remove("reorder-target");
                            const source = e.dataTransfer.getData(
                              "application/atlas-reorder",
                            );
                            if (source) {
                              e.preventDefault();
                              e.stopPropagation();
                              update((w) => ({
                                ...w,
                                blocks: reorderBlocks(
                                  w.blocks,
                                  source,
                                  block.id,
                                ),
                              }));
                            } else {
                              const field = e.dataTransfer.getData(
                                "application/atlas-variable",
                              );
                              if (field) {
                                e.preventDefault();
                                e.stopPropagation();
                                assign(block.id, "y", field);
                                setDragging(null);
                              }
                            }
                          }}
                        >
                          <header className="block-header">
                            <button
                              className="block-grip"
                              draggable
                              aria-label={`${block.title} verplaatsen`}
                              title="Sleep om te verplaatsen; gebruik ook het blokmenu"
                              onDragStart={(e) => {
                                e.dataTransfer.setData(
                                  "application/atlas-reorder",
                                  block.id,
                                );
                                e.dataTransfer.effectAllowed = "move";
                              }}
                            >
                              <GripVertical size={15} />
                            </button>
                            <span className={`block-type-icon ${block.kind}`}>
                              <Icon size={15} />
                            </span>
                            <input
                              aria-label={`Titel blok ${index + 1}`}
                              value={block.title}
                              maxLength={120}
                              onChange={(e) =>
                                changeBlock(block.id, { title: e.target.value })
                              }
                            />
                            <details className="block-menu">
                              <summary aria-label={`Menu ${block.title}`}>
                                <MoreHorizontal size={18} />
                              </summary>
                              <div
                                onClick={(e) => {
                                  if (
                                    (e.target as HTMLElement).closest("button")
                                  )
                                    e.currentTarget
                                      .closest("details")
                                      ?.removeAttribute("open");
                                }}
                              >
                                <button onClick={() => exportBlock(block)}>
                                  <Download size={13} />
                                  Cijfers als CSV
                                </button>
                                <button
                                  onClick={() =>
                                    changeBlock(block.id, { wide: !block.wide })
                                  }
                                >
                                  <Expand size={13} />
                                  {block.wide
                                    ? "Halve breedte"
                                    : "Volledige breedte"}
                                </button>
                                <button
                                  onClick={() => {
                                    if (workspace.blocks.length >= 30) return;
                                    const copy = {
                                      ...block,
                                      id: crypto.randomUUID(),
                                      title: block.title + " · kopie",
                                    };
                                    update((w) => ({
                                      ...w,
                                      blocks: [
                                        ...w.blocks.slice(0, index + 1),
                                        copy,
                                        ...w.blocks.slice(index + 1),
                                      ],
                                    }));
                                    setActive(copy.id);
                                  }}
                                >
                                  <Copy size={13} />
                                  Dupliceren
                                </button>
                                <button
                                  disabled={index === 0}
                                  onClick={() =>
                                    update((w) => ({
                                      ...w,
                                      blocks: reorderBlocks(
                                        w.blocks,
                                        block.id,
                                        w.blocks[index - 1].id,
                                      ),
                                    }))
                                  }
                                >
                                  <ArrowUp size={13} />
                                  Omhoog
                                </button>
                                <button
                                  disabled={
                                    index === workspace.blocks.length - 1
                                  }
                                  onClick={() =>
                                    update((w) => ({
                                      ...w,
                                      blocks: reorderBlocks(
                                        w.blocks,
                                        block.id,
                                        w.blocks[index + 1].id,
                                      ),
                                    }))
                                  }
                                >
                                  <ArrowDown size={13} />
                                  Omlaag
                                </button>
                                <button
                                  className="danger"
                                  onClick={() => {
                                    update((w) => ({
                                      ...w,
                                      blocks: w.blocks.filter(
                                        (b) => b.id !== block.id,
                                      ),
                                    }));
                                    announce(
                                      "Blok verwijderd. Je kunt dit ongedaan maken.",
                                    );
                                  }}
                                >
                                  <Trash2 size={13} />
                                  Verwijderen
                                </button>
                              </div>
                            </details>
                          </header>
                          <div className="block-axes">
                            {["timeseries", "regression"].includes(
                              block.kind,
                            ) && axis(block, "x", "X-as")}
                            {axis(
                              block,
                              "y",
                              block.kind === "map"
                                ? "Kleur"
                                : ["ranking", "stat", "table"].includes(
                                      block.kind,
                                    )
                                  ? "Waarde"
                                  : "Y-as",
                            )}
                            <span className="axis-unit">
                              {block.kind === "timeseries" &&
                              block.mode === "index"
                                ? "index"
                                : block.kind === "timeseries" &&
                                    block.mode === "growth"
                                  ? "%"
                                  : block.kind === "ranking" &&
                                      block.mode === "growth" &&
                                      variable(block.y).unit !== "%"
                                    ? "%"
                                    : variable(block.y).unit}
                            </span>
                          </div>
                          <div className="block-body">
                            {blockContent(block)}
                          </div>
                        </section>
                      );
                    })}
                    <button
                      className={`add-block-tile ${!workspace.blocks.length ? "empty-canvas" : ""}`}
                      onClick={() => setModal("blocks")}
                    >
                      <span>
                        <Plus size={20} />
                      </span>
                      <strong>
                        {workspace.blocks.length
                          ? "Ruimte voor je volgende vraag"
                          : "Begin met je eerste inzicht"}
                      </strong>
                      <small>Voeg een kaart, tijdreeks of analyse toe</small>
                    </button>
                  </div>
                  <footer className="workspace-footer">
                    <span>
                      <i className="status-dot" />
                      {storageStatus}
                    </span>
                    <span>
                      O&S Amsterdam · {dataset!.areas.length} buurten ·{" "}
                      {dataset!.years.length} bronjaren
                      <button onClick={() => setModal("sources")}>
                        Bronnen & methode <ArrowUpRight size={11} />
                      </button>
                    </span>
                  </footer>
                </>
              )}
            </main>
          </div>
        )}
      </div>
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept=".csv,.json"
        aria-label="CSV of Atlas-werkruimte openen"
        onChange={(e) => {
          void readFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={16} />
          {notice}
          <button aria-label="Melding sluiten" onClick={() => setNotice("")}>
            <X size={13} />
          </button>
        </div>
      )}
      {modal === "commands" && (
        <CommandPalette
          dataset={dataset}
          availableSources={sourceCatalog.filter(
            (def) => !sources.some((s) => s.sourceId === def.id),
          )}
          addSource={(id) => {
            setModal("library");
            void addSource(id);
          }}
          addBlock={addBlock}
          assign={(v) => {
            if (activeBlock) assign(activeBlock.id, "y", v);
            else announce("Voeg eerst een blok toe.");
            close();
          }}
          actions={[
            {
              label: "Woningmarkt tijdmachine",
              description:
                "Voorbeeldanalyse: historische voorspellingen, rente, buurten en modellen",
              icon: Activity,
              run: openMarket,
            },
            {
              label: "Terug naar je werkruimte",
              description: "Verder werken met je eigen blokken en gegevens",
              icon: LayoutDashboard,
              run: () => {
                setModal(null);
                openWorkspace();
              },
            },
            {
              label: "Bronnenbibliotheek",
              description: "Zoek aanvullende datasets, thema’s en variabelen",
              icon: Database,
              run: () => setModal("library"),
            },
            {
              label: "Eigen data importeren",
              description: "CSV koppelen op buurtcode en jaar",
              icon: Upload,
              run: () => {
                setCsv(null);
                setModal("import");
              },
            },
            {
              label: "Werkruimte downloaden",
              description: "Blokken, instellingen en geïmporteerde data",
              icon: Download,
              run: () => {
                save();
                close();
              },
            },
            {
              label: "Werkruimte openen",
              description: "Verder werken vanuit een .atlas.json-bestand",
              icon: FileJson,
              run: () => fileInput.current?.click(),
            },
            {
              label: "Leeg canvas",
              description: "Alle blokken verwijderen · ongedaan maken mogelijk",
              icon: LayoutDashboard,
              run: () => {
                update((w) => ({ ...w, blocks: [] }));
                close();
              },
            },
            {
              label: "Selectie wissen",
              description: "Alle buurten weer in beeld",
              icon: Filter,
              run: () => {
                update((w) => ({ ...w, selected: [], selectionOnly: false }));
                close();
              },
            },
            {
              label: "Bronnen en definities",
              description: "Herkomst, waardepeildatum en grenzen",
              icon: Database,
              run: () => setModal("sources"),
            },
            {
              label: "Uitleg en sneltoetsen",
              description: "Maak je eerste analyse",
              icon: CircleHelp,
              run: () => setModal("help"),
            },
          ]}
          close={close}
        />
      )}
      {modal === "blocks" && (
        <Modal
          title="Welke vraag wil je onderzoeken?"
          subtitle="Voeg een blok toe. Variabelen en instellingen kun je altijd aanpassen."
          close={close}
        >
          <div className="block-picker">
            {(Object.keys(blockInfo) as BlockKind[]).map((kind) => {
              const Icon = icons[kind];
              return (
                <button key={kind} onClick={() => addBlock(kind)}>
                  <span className={`block-type-icon ${kind}`}>
                    <Icon size={23} />
                  </span>
                  <span>
                    <small>{blockInfo[kind].tag}</small>
                    <strong>{blockInfo[kind].label}</strong>
                    <p>{blockInfo[kind].description}</p>
                  </span>
                  <Plus size={16} />
                </button>
              );
            })}
          </div>
        </Modal>
      )}
      {modal === "import" && (
        <Modal
          title={
            csv
              ? "Geef je kolommen betekenis"
              : "Jouw data, dezelfde werkruimte"
          }
          subtitle="Koppel tijdreeksen aan Amsterdamse buurten. Je bestand blijft in je browser."
          close={close}
          wide
        >
          {!csv ? (
            <div className="import-body">
              <button
                className="upload-zone"
                onClick={() => fileInput.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void readFile(e.dataTransfer.files[0]);
                }}
              >
                <span>
                  <Upload size={26} />
                </span>
                <strong>Sleep je CSV of werkruimte hierheen</strong>
                <small>Of klik om een bestand te kiezen · maximaal 10 MB</small>
              </button>
              <div className="import-explainer">
                <h3>Een buurt, een jaar, een waarde.</h3>
                <p>
                  Gebruik exacte BU0363-buurtcodes, bronjaren 2012–2026 en een
                  numerieke waarde. Koppel je kolommen in de volgende stap. Lege
                  cellen blijven onbekend.
                </p>
                <code>
                  buurtcode,jaar,prijs_m2
                  <br />
                  BU0363AA02,2025,
                  <br />
                  BU0363AA02,2026,
                </code>
                <p>
                  De lege waarden zijn bewust: vul je eigen gemeten cijfers in.
                </p>
                <button
                  className="text-button"
                  onClick={() => {
                    if (!dataset) return;
                    download(
                      "atlas-importsjabloon.csv",
                      "\uFEFF" +
                        [
                          ["buurtcode", "buurt", "jaar", "prijs_m2"],
                          ...dataset.areas.flatMap((a) =>
                            [workspace.start, workspace.end].map((y) => [
                              a.code,
                              a.name,
                              y,
                              "",
                            ]),
                          ),
                        ]
                          .map((r) => r.map(csvCell).join(","))
                          .join("\r\n"),
                      "text/csv;charset=utf-8",
                    );
                  }}
                >
                  <Download size={13} />
                  Download sjabloon met echte buurtcodes
                </button>
              </div>
            </div>
          ) : (
            <div className="import-body">
              <div className="import-success">
                <CheckCircle2 size={16} />
                {num(csv.rows.length)} rijen · {csv.headers.length} kolommen
                gevonden
              </div>
              <div className="mapping-grid">
                {(["code", "year", "value"] as const).map((key, i) => (
                  <label key={key}>
                    {["Buurtcode", "Jaar", "Numerieke waarde"][i]}
                    <select
                      value={mapping[key]}
                      onChange={(e) =>
                        setMapping((m) => ({ ...m, [key]: e.target.value }))
                      }
                    >
                      {csv.headers.map((h) => (
                        <option key={h}>{h}</option>
                      ))}
                    </select>
                  </label>
                ))}
                <label>
                  Naam variabele
                  <input
                    value={mapping.label}
                    maxLength={80}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, label: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Eenheid
                  <input
                    list="unit-options"
                    maxLength={30}
                    value={mapping.unit}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, unit: e.target.value }))
                    }
                  />
                  <datalist id="unit-options">
                    {[
                      "€/m²",
                      "€",
                      "%",
                      "aantal",
                      "m²",
                      "index",
                      "°C",
                      "mm",
                    ].map((unit) => (
                      <option value={unit} key={unit} />
                    ))}
                  </datalist>
                </label>
              </div>
              <div className="import-preview">
                <table>
                  <thead>
                    <tr>
                      {csv.headers.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csv.rows.slice(0, 3).map((r, i) => (
                      <tr key={i}>
                        {r.map((c, j) => (
                          <td key={j}>{c || "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="import-note">
                Alleen unieke combinaties van buurt en jaar worden geaccepteerd.
                Een import vervangt de hele reeks van een variabele met dezelfde
                naam. Je blijft zelf verantwoordelijk voor een vergelijkbare
                gebiedsindeling en definitie.
              </p>
              <div className="modal-actions">
                <button
                  className="button secondary"
                  onClick={() => {
                    setCsv(null);
                    setImportError("");
                  }}
                >
                  Ander bestand
                </button>
                <button className="button primary" onClick={finishImport}>
                  <Plus size={14} />
                  Variabele toevoegen
                </button>
              </div>
            </div>
          )}
          {importError && (
            <p className="form-error" role="alert">
              {importError}
            </p>
          )}
        </Modal>
      )}
      {modal === "library" && (
        <Modal
          title="Bronnenbibliotheek"
          subtitle="Vind de data bij je vraag. Alleen wat je toevoegt wordt opgehaald."
          close={close}
          library
        >
          <SourceLibrary
            sources={sourceCatalog}
            loaded={sources}
            statuses={sourceStatuses}
            usedSourceIds={usedSourceIds}
            onAdd={(id) => void addSource(id)}
            onRefresh={(id) => void addSource(id, true)}
            onRemove={removeLoadedSource}
            onCancel={cancelSource}
          />
          <div className="library-bottom-actions">
            <button
              className="text-button"
              onClick={() => {
                setCsv(null);
                setModal("import");
              }}
            >
              <Upload size={14} />
              Liever een eigen CSV toevoegen?
            </button>
            <button className="text-button" onClick={() => setModal("sources")}>
              Gebruikte definities en methode <ArrowUpRight size={12} />
            </button>
          </div>
        </Modal>
      )}
      {modal === "sources" && (
        <Modal
          title="Inzicht begint bij de bron"
          subtitle="Heldere definities maken je analyse beter."
          close={close}
          wide
        >
          <div className="sources-body">
            <div className="source-summary">
              <Database size={22} />
              <div>
                <h3>Onderzoek en Statistiek Amsterdam</h3>
                <p>Statistiekhub · 518 buurten · 2012–2026</p>
              </div>
              <span className="source-badge">Gepubliceerde data</span>
            </div>
            <dl className="source-facts">
              <div>
                <dt>Basisdata opgehaald</dt>
                <dd>
                  {dataset
                    ? new Date(dataset.meta.retrievedAt).toLocaleDateString(
                        "nl-NL",
                      )
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Gebiedsindeling</dt>
                <dd>24 maart 2022 · vaste grenzen</dd>
              </div>
              <div>
                <dt>WOZ-peildatum</dt>
                <dd>
                  Bronjaar {workspace.year} → 1 januari {workspace.year - 1}
                </dd>
              </div>
            </dl>
            {dataset?.variables
              .filter((v) => v.kind === "number")
              .map((v) => (
                <div className="source-definition" key={v.id}>
                  <span className="type-chip">
                    <Hash size={12} />
                    {v.unit}
                  </span>
                  <div>
                    <h4>
                      {v.label}
                      {!v.available && <small> Eigen data nodig</small>}
                    </h4>
                    <p>{v.description}</p>
                    {v.years?.length && (
                      <p className="source-coverage">
                        Beschikbare bronjaren: {v.years.join(", ")}
                        {v.retrievedAt
                          ? ` · Opgehaald ${new Date(v.retrievedAt).toLocaleDateString("nl-NL")}`
                          : ""}
                      </p>
                    )}
                    {v.source.startsWith("https:") ? (
                      <a href={v.source} target="_blank" rel="noreferrer">
                        Bron bekijken <ArrowUpRight size={11} />
                      </a>
                    ) : (
                      <span className="import-source">{v.source}</span>
                    )}
                  </div>
                </div>
              ))}
            <div className="method-note">
              <strong>Zo lees je de analyses</strong>
              <p>
                Kaart, ranglijst en regressie gebruiken het actieve bronjaar. De
                tijdreeks gebruikt de gekozen periode. Selecties markeren
                buurten in alle blokken; ‘Alleen selectie’ filtert de analyses.
                Een tijdreeks toont maximaal 8 geselecteerde buurten.
                Ontbrekende waarden worden niet ingevuld. Regressie gebruikt
                complete buurtparen in hetzelfde jaar. Verband betekent geen
                causaliteit.
              </p>
              <p>
                Historie is waar mogelijk herberekend naar grenzen uit 2022.
                Weesp en Driemond bevatten bekende reeksbreuken. Indexen en
                groeicijfers worden daar onderbroken. Ook voorraad- en
                woningmixwijzigingen kunnen gemiddelden beïnvloeden.
              </p>
            </div>
          </div>
        </Modal>
      )}
      {modal === "help" && (
        <Modal
          title="Van vraag naar inzicht"
          subtitle="Je hoeft geen dashboard te bouwen om een nieuwe vraag te stellen."
          close={close}
        >
          <div className="help-body">
            {[
              {
                n: "01",
                title: "Begin met een vraag",
                text: "Voeg een kaart, tijdreeks, regressie, ranglijst, datatabel of kerncijfer toe.",
              },
              {
                n: "02",
                title: "Geef een variabele een plek",
                text: "Sleep een variabele naar Kleur, Waarde, X-as of Y-as. Op een touchscreen of met het toetsenbord kies je dezelfde variabele in het asmenu.",
              },
              {
                n: "03",
                title: "Verbind tijd en plaats",
                text: "Verander het bronjaar, speel de tijdlijn af of selecteer buurten op de kaart. Zet Alleen selectie aan om ook de andere analyses te filteren.",
              },
              {
                n: "04",
                title: "Maak het jouw werkruimte",
                text: "Versleep blokken via de greep. Het blokmenu biedt ook Omhoog en Omlaag, verbreden, dupliceren en verwijderen. Bewaar je werk als bestand.",
              },
            ].map((item) => (
              <div className="help-step" key={item.n}>
                <span>{item.n}</span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              </div>
            ))}
            <div className="shortcuts">
              <span>
                Zoek alles <kbd>⌘ / Ctrl K</kbd>
              </span>
              <span>
                Ongedaan maken <kbd>⌘ / Ctrl Z</kbd>
              </span>
              <span>
                Opnieuw <kbd>⇧ ⌘ / Ctrl Z</kbd>
              </span>
            </div>
            <p className="privacy-note">
              Automatisch opgeslagen in deze browser. Geen account of
              serveropslag. Download een werkruimte om hem te verplaatsen of als
              reservekopie te bewaren. CSV-export bevat ruwe bronwaarden;
              indexen en groeimodi zijn weergaven.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}

type Action = {
  label: string;
  description: string;
  icon: typeof Search;
  run: () => void;
};
function CommandPalette({
  dataset,
  availableSources,
  addSource,
  addBlock,
  assign,
  actions,
  close,
}: {
  dataset: Dataset | null;
  availableSources: SourceDefinition[];
  addSource: (id: string) => void;
  addBlock: (k: BlockKind) => void;
  assign: (id: string) => void;
  actions: Action[];
  close: () => void;
}) {
  const [query, setQuery] = useState(""),
    [cursor, setCursor] = useState(0);
  const entries = [
    ...(dataset
      ? numericVariables(dataset).map((v) => ({
          label: v.label,
          description: `${v.unit} · Toewijzen aan actief blok`,
          icon: Hash,
          run: () => assign(v.id),
          group: "Variabelen",
        }))
      : []),
    ...availableSources.map((source) => ({
      label: source.title,
      description: `Toevoegen · ${source.variables.map((v) => v.label).join(" · ")}`,
      icon: Database,
      run: () => addSource(source.id),
      group: "Databronnen",
    })),
    ...(Object.keys(blockInfo) as BlockKind[]).map((kind) => ({
      label: blockInfo[kind].label,
      description: blockInfo[kind].description,
      icon: icons[kind],
      run: () => addBlock(kind),
      group: "Blokken",
    })),
    ...actions.map((a) => ({ ...a, group: "Functies" })),
  ].filter((e) =>
    `${e.label} ${e.description} ${e.group}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const selected = Math.min(cursor, entries.length - 1);
  return (
    <Modal title="Wat wil je onderzoeken?" close={close}>
      <div className="command-search">
        <Search size={19} />
        <input
          role="combobox"
          aria-label="Zoek data, blokken en functies"
          aria-autocomplete="list"
          aria-controls="command-results"
          aria-expanded="true"
          aria-activedescendant={
            entries.length ? `command-${selected}` : undefined
          }
          placeholder="Zoek data, blokken, functies…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const next =
                (cursor + (e.key === "ArrowDown" ? 1 : -1) + entries.length) %
                Math.max(1, entries.length);
              setCursor(next);
              document
                .getElementById(`command-${next}`)
                ?.scrollIntoView({ block: "nearest" });
            }
            if (e.key === "Enter") {
              e.preventDefault();
              entries[selected]?.run();
            }
          }}
        />
        <kbd>esc</kbd>
      </div>
      <div
        className="command-results"
        role="listbox"
        id="command-results"
        aria-label="Zoekresultaten"
      >
        {entries.map((entry, index) => {
          const Icon = entry.icon;
          return (
            <button
              role="option"
              aria-selected={index === selected}
              id={`command-${index}`}
              key={entry.group + entry.label}
              className={index === selected ? "highlighted" : ""}
              onMouseMove={() => setCursor(index)}
              onClick={entry.run}
            >
              <span className="command-icon">
                <Icon size={17} />
              </span>
              <span>
                <strong>{entry.label}</strong>
                <small>{entry.description}</small>
              </span>
              <em>{entry.group}</em>
              <ArrowUpRight size={13} />
            </button>
          );
        })}
        {!entries.length && (
          <p className="empty-inline">
            Geen resultaten. Probeer ‘kaart’, ‘WOZ’ of ‘importeren’.
          </p>
        )}
      </div>
      <div className="command-footer">
        <span>↑ ↓ navigeren</span>
        <span>↵ kiezen</span>
        <span>esc sluiten</span>
      </div>
    </Modal>
  );
}
