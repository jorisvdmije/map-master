"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { association, countAssociation, associationLabel, labels, metrics, scoreColor, formatValue, units, type Metric, type Observation } from "./model";
const fmt = (v: number | null) => v === null ? "—" : v.toLocaleString("nl-NL", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
export function Scatter({ rows, x, y, method, select }: { rows: Observation[]; x: Metric; y: Metric; method: "pearson" | "spearman"; select: (id: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), holder = useRef<HTMLDivElement>(null);
  const points = useRef<{ row: Observation; x: number; y: number }[]>([]);
  const [hover, setHover] = useState<Observation | null>(null), [log, setLog] = useState(true);
  const result = useMemo(() => association(rows, x, y, method), [rows, x, y, method]);
  useEffect(() => {
    const element = canvas.current!, host = holder.current!;
    const draw = () => {
      const width = host.clientWidth, height = 238, ratio = window.devicePixelRatio || 1;
      element.width = width * ratio; element.height = height * ratio; element.style.width = `${width}px`; element.style.height = `${height}px`;
      const ctx = element.getContext("2d")!; ctx.scale(ratio, ratio); ctx.clearRect(0, 0, width, height);
      const left = 34, right = width - 12, top = 14, bottom = height - 30;
      const maxX = Math.max(1, ...result.pairs.map(r => r[x]!)) * 1.03, maxY = Math.max(1, ...result.pairs.map(r => r[y]!)) * 1.03;
      const scale = (value: number, maximum: number) => log ? Math.log1p(Math.max(0, value)) / Math.log1p(maximum) : value / maximum;
      const tickValue = (part: number, maximum: number) => log ? Math.expm1(part * Math.log1p(maximum)) : part * maximum;
      const px = (v: number) => left + scale(v, maxX) * (right - left), py = (v: number) => bottom - scale(v, maxY) * (bottom - top);
      ctx.fillStyle = "#fafbf8"; ctx.fillRect(left, top, right - left, bottom - top);
      ctx.font = '10px "DM Sans Variable", sans-serif'; ctx.lineWidth = 1;
      for (let step = 0; step <= 4; step++) {
        const a = tickValue(step / 4, maxX), b = tickValue(step / 4, maxY);
        ctx.strokeStyle = "#e6ebe5"; ctx.beginPath(); ctx.moveTo(px(a), top); ctx.lineTo(px(a), bottom); ctx.moveTo(left, py(b)); ctx.lineTo(right, py(b)); ctx.stroke(); ctx.fillStyle = "#86938c"; ctx.textAlign = "center"; ctx.fillText(a.toLocaleString("nl-NL", { maximumFractionDigits: 1 }), px(a), bottom + 17); ctx.textAlign = "right"; ctx.fillText(b.toLocaleString("nl-NL", { maximumFractionDigits: 1 }), left - 6, py(b) + 3);
      }
      ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
      points.current = result.pairs.map(row => ({ row, x: px(row[x]!), y: py(row[y]!) }));
      for (const p of points.current) { ctx.globalAlpha = rows.length > 1000 ? .24 : .55; ctx.fillStyle = scoreColor(p.row[y], y); ctx.beginPath(); ctx.arc(p.x, p.y, rows.length > 1000 ? 2.1 : 3.2, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      if (method === "pearson" && !log && result.slope !== null && result.intercept !== null) { ctx.strokeStyle = "#243f49"; ctx.lineWidth = 1.7; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(px(0), py(result.intercept)); ctx.lineTo(px(maxX), py(result.intercept + result.slope * maxX)); ctx.stroke(); }
      ctx.restore();
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(host); return () => observer.disconnect();
  }, [rows, x, y, method, log, result.pairs, result.slope, result.intercept]);
  const hit = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect(), x = event.clientX - bounds.left, y = event.clientY - bounds.top;
    return points.current.reduce<{ row: Observation; distance: number } | null>((best, point) => {
      const distance = Math.hypot(point.x - x, point.y - y);
      return distance < 10 && (!best || distance < best.distance) ? { row: point.row, distance } : best;
    }, null)?.row ?? null;
  };
  const activeHover = hover ? result.pairs.find(row => row.id === hover.id) : null;
  return <div className="st-scatter" ref={holder}>
    <label className="st-check st-log-toggle"><input type="checkbox" checked={log} onChange={e => setLog(e.target.checked)} />Logaritmische assen (incl. nul)</label>
    <span className="st-axis-y">{labels[y]} ({units[y]}) ↑</span>
    <canvas ref={canvas} role="img" aria-label={`Spreidingsdiagram: ${labels[x]} versus ${labels[y]}; ${result.n} meetparen; correlatie ${fmt(result.r)}. De straatgegevens zijn ook beschikbaar in de tabel.`} onMouseMove={event => setHover(hit(event))} onMouseLeave={() => setHover(null)} onClick={event => { const row = hit(event); if (row) select(row.id); }} />
    <span className="st-axis-x">{labels[x]} ({units[x]}) →</span><p className="st-scatter-note">{activeHover ? `${activeHover.name} · ${formatValue(activeHover[x], x)} / ${formatValue(activeHover[y], y)} · klik voor details` : `${result.n.toLocaleString("nl-NL")} meetparen · ${log ? "logaritmische assen: log(1+x)" : method === "pearson" ? "stippellijn = lineaire trend" : "Spearman gebruikt rangordes"}`}</p>
  </div>;
}
export function CorrelationPanel({ rows, x, y, setX, setY, method, setMethod, level, setLevel, select, minimumLength, setMinimumLength, excludedShort }: { rows: Observation[]; x: Metric; y: Metric; setX: (value: Metric) => void; setY: (value: Metric) => void; method: "pearson" | "spearman"; setMethod: (value: "pearson" | "spearman") => void; level: "street" | "ward"; setLevel: (value: "street" | "ward") => void; select: (id: string) => void; minimumLength: number; setMinimumLength: (n: number) => void; excludedShort: number }) {
  const result = useMemo(() => association(rows, x, y, method), [rows, x, y, method]);
  const rawResult = useMemo(() => countAssociation(rows, x, y, method), [rows, x, y, method]);
  return <>
    <div className="st-card-heading"><span className="st-kicker">VAN PATRONEN NAAR VRAGEN</span><h2>Welke registraties hangen samen?</h2><p>Vergelijk echte registraties binnen je selectie. De eenheden en bronperioden kunnen verschillen.</p></div>
    <div className="st-fields"><label>X-as<select aria-label="Indicator X" value={x} onChange={e => setX(e.target.value as Metric)}>{metrics.map(m => <option key={m} value={m}>{labels[m]}</option>)}</select></label><label>Y-as<select aria-label="Indicator Y" value={y} onChange={e => setY(e.target.value as Metric)}>{metrics.map(m => <option key={m} value={m}>{labels[m]}</option>)}</select></label></div>
    <div className="st-fields"><label>Rekenen per<select aria-label="Analyseniveau" value={level} onChange={e => setLevel(e.target.value as "street" | "ward")}><option value="street">Straatnaam</option><option value="ward">Wijk</option></select></label><label>Methode<select aria-label="Correlatiemethode" value={method} onChange={e => setMethod(e.target.value as "pearson" | "spearman")}><option value="pearson">Pearson · lineair</option><option value="spearman">Spearman · rangorde</option></select></label></div>
    <label className="st-field">Minimale bronlengte<select aria-label="Minimale bronlengte" value={minimumLength} onChange={e => setMinimumLength(+e.target.value)}>{[0, 100, 250, 500].map(n => <option key={n} value={n}>{n ? `${n} m NWB` : "Alle lengtes"}</option>)}</select></label><p className="st-side-explanation">{excludedShort} objecten onder deze grens uitgesloten. Zeer korte wegvakken kunnen extreme dichtheden opleveren.</p>
    <div className="st-correlation"><div><span>{method === "pearson" ? "Pearson r" : "Spearman ρ"}</span><strong data-st-correlation>{fmt(result.r)}</strong></div><div><b>{associationLabel(result.r)}</b><span>{result.n.toLocaleString("nl-NL")} {level === "street" ? "straten" : "gebieden"} · {result.excluded} zonder meetpaar</span>{method === "pearson" && result.r !== null && <span>r² = {Math.round(result.r ** 2 * 100)}% · lineaire samenhang</span>}</div></div>
    {x === y && <p className="st-shift-warning">Dezelfde indicator staat op beide assen. Het verband is daardoor rekenkundig; kies twee verschillende indicatoren om samenhang te onderzoeken.</p>}
    <Scatter rows={rows} x={x} y={y} method={method} select={select} />
    {rawResult && <details className="st-shift-method"><summary>Controleer de invloed van straatlengte</summary><p>Het verband tussen de dichtheden is <b>{fmt(result.r)}</b>. Voor dezelfde {rawResult.n} meetparen is het verband tussen de ruwe aantallen <b data-st-raw-correlation>{fmt(rawResult.r)}</b> ({method === "pearson" ? "Pearson" : "Spearman"}). Ruwe aantallen worden mede bepaald door straatlengte. Dichtheden delen juist die lengtenoemer. Een verschil tussen deze uitkomsten is reden om beide uitkomsten en de context te onderzoeken; geen van beide corrigeert voor drukte of oorzaken.</p></details>}
    <h3 className="st-small-heading">Alle verbanden <small>klik een cel om te verkennen</small></h3>
    <div className="st-matrix" role="group" aria-label="Correlatiematrix"><span />{metrics.map((m, i) => <span key={m} title={labels[m]}>{i + 1}</span>)}{metrics.map((a, i) => <div className="st-matrix-row" key={a}><span title={labels[a]}>{i + 1}</span>{metrics.map(b => { const r = association(rows, a, b, method).r; return <button key={b} title={`${labels[a]} × ${labels[b]}: ${fmt(r)}`} aria-label={`${labels[a]} en ${labels[b]}`} aria-pressed={a === x && b === y} style={{ background: r === null ? "#eef0ed" : r < 0 ? `rgba(177, 118, 81,${.12 + Math.abs(r) * .65})` : `rgba(54, 130, 131,${.12 + Math.abs(r) * .65})` }} onClick={() => { setX(a); setY(b); }}>{fmt(r)}</button>; })}</div>)}</div>
    <p className="st-matrix-key">{metrics.map((m, i) => <span key={m}>{i + 1} {labels[m]}</span>)}</p>
    <div className="st-caution"><b>Samenhang is geen oorzaak.</b> Meldingen hangen ook af van drukte en meldingsbereidheid. Bomen en lampstatus zijn een actuele download; meldingen beslaan de gekozen afgelopen maanden. Dichtheden delen dezelfde lengtenoemer, wat zelf samenhang kan veroorzaken. Overlastmeldingen zijn een subset van alle meldingen: hun onderlinge verband is deels rekenkundig. Straten in dezelfde buurt zijn afhankelijk. Kleur- en profielfilters selecteren op de gemeten indicatoren en kunnen het verband daardoor veranderen. Geen effectschatting of significantietoets.</div>
  </>;
}
