import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Database, Info } from "lucide-react";
import { getCatalog } from "@/lib/content";
import { CatalogHeader } from "@/features/catalog/header";
import { DatasetDownloads } from "@/features/catalog/downloads";
import { themes, availability } from "@/features/catalog/types";
import { assetPath } from "@/lib/paths";
import "@/features/catalog/catalog.css";
type Props = { params: Promise<{ id: string }> };
export const dynamicParams = false;
export async function generateStaticParams() { return (await getCatalog()).datasets.map(entry => ({ id: entry.id })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = (await params).id;
  const dataset = (await getCatalog()).datasets.find(entry => entry.id === id);
  if (!dataset) notFound();
  return { title: `${dataset.title} · Databank`, description: dataset.summary };
}
export default async function DatasetPage({ params }: Props) {
  const catalog = await getCatalog(), id = (await params).id;
  const entry = catalog.datasets.find(entry => entry.id === id);
  if (!entry) notFound();
  return <main lang="nl" className="db-root" data-dataset-detail={entry.id}><a className="skip-link" href="#dataset-profile">Naar het bronprofiel</a><CatalogHeader />
    <div className="db-detail"><Link className="db-back" href="/data/" prefetch={false}><ArrowLeft size={16} />Alle datasets</Link>
      <div className="db-detail-heading"><div><span className="db-eyebrow">{themes[entry.theme]} · BRONPROFIEL</span><h1>{entry.title}</h1><p>{entry.summary}</p></div><span className="db-availability" data-availability={entry.availability}>{availability[entry.availability]}</span></div>
      <div className="db-detail-grid"><section id="dataset-profile"><h2>Wat staat er in deze bron?</h2><dl className="db-profile"><div><dt>Aanbieder</dt><dd>{entry.publisher}</dd></div><div><dt>Dekking</dt><dd>{entry.coverage === "amsterdam" ? "Amsterdam" : "Nederland; selecteer het gewenste gebied bij de bron"}</dd></div><div><dt>Detailniveau</dt><dd>{entry.level}</dd></div><div><dt>Bronperiode</dt><dd>{entry.time}</dd></div><div><dt>Formaten</dt><dd>{entry.formats.join(" · ")}</dd></div><div><dt>Toegang en hergebruik</dt><dd>{entry.access}</dd></div></dl><div className="db-meaning"><Info size={20} aria-hidden="true" /><div><h3>Zo lees je deze gegevens</h3><p>{entry.caveat}</p></div></div>
      <h2>Verder bij de bron</h2><p>De aanbieder beheert de oorspronkelijke gegevens. Bekijk daar de definities, licentie, toegangsrechten en actuele publicaties.</p><a className="db-button" href={entry.source.url} target="_blank" rel="noreferrer">Bekijk {entry.source.label}<ArrowUpRight size={15} /></a><p className="db-footnote">Bronlink bekeken op {new Date(catalog.checkedAt).toLocaleDateString("nl-NL", { timeZone: "UTC" })}. Dit is geen datum waarop alle brongegevens zijn vernieuwd of de API is getest.</p>
      <a href={assetPath(`/data/catalog/${entry.id}.json`)} download className="db-text-link">Download dit bronprofiel als JSON</a></section>
      <aside className="db-detail-actions"><div className="db-action-panel"><Database size={24} /><h2>{entry.downloads.length ? "Werk met deze bestanden" : entry.usedIn?.length ? "Verken deze gegevens" : "Ontdek deze bron"}</h2>
      {entry.snapshot && <p className="db-snapshot"><strong>{entry.snapshot.count.toLocaleString("nl-NL")} {entry.snapshot.unit}</strong><span>Snapshot opgehaald {new Date(entry.snapshot.retrievedAt).toLocaleDateString("nl-NL", { timeZone: "UTC" })}</span></p>}
      {entry.downloads.length > 0 && <><DatasetDownloads files={entry.downloads} /><p className="db-footnote">De bestanden worden pas geladen als je erop klikt. CSV: UTF-8, puntkomma als scheidingsteken en punt als decimaalteken. De metadata bevat herkomst en definities.</p></>}
      {entry.usedIn?.map(app => <Link key={app.href} className="db-button" href={app.href} prefetch={false}>{app.label}<ArrowUpRight size={15} /></Link>)}
      {entry.availability === "connected" && <p>Gegevens uit deze bron worden in de gekoppelde kaart gebruikt. Bekijk de toegang en bronperiode hierboven; hier staat geen volledige landelijke of gemeentelijke kopie.</p>}
      {entry.availability === "source" && <p>Dit bronprofiel helpt je de gegevens te vinden. Een koppeling voor deze bron is nog niet in deze databank gebouwd; volg de bronlink voor de beschikbare producten.</p>}
      {entry.downloads.some(file => file.format === "GeoJSON") && <div className="db-import-tip"><h3>Zelf verder analyseren</h3><p>Download het GeoJSON-bestand en importeer het in de vrije analyse of Playground. Grote of complexe bestanden kunnen de importlimieten overschrijden.</p><Link href="/analysis/" prefetch={false}>Open vrije analyse <ArrowUpRight size={14} /></Link></div>}
      </div></aside></div>
    </div><footer className="db-footer"><span>Een helder bronverhaal hoort bij ieder resultaat.</span><Link href="/data/" prefetch={false}>Terug naar de databank</Link></footer>
  </main>;
}
