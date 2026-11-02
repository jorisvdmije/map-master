import Link from "next/link";
import { gallery } from "@/content/gallery";
import { WorkflowCards } from "@/components/content/cards";
import { InteractiveCode } from "@/components/content/interactive-code";
import { InstallCommands } from "@/components/docs-code";
import { PageFooter } from "@/components/layout/page-footer";
import { LiveExample } from "@/features/examples/live-example";
import { getManifest } from "@/lib/content";
import { guidePath } from "@/lib/paths";

export default async function HomePage() {
  const { version } = await getManifest();
  return <div className="page home"><main id="main" tabIndex={-1}>
    <div className="home-intro">
      <span className="eyebrow"><span className="status-dot" /> GEOMETRY EDITING FOR MAPLIBRE &amp; MAPBOX</span>
      <div className="hero-grid"><div className="hero-copy">
        <h1>Your map.<br />Ready to <em>edit.</em></h1>
        <p>Draw, reshape and manage geometry with a TypeScript API. Built-in snapping, validation and Undo keep every edit under control.</p>
        <div className="hero-buttons">
          <Link className="button" href={guidePath("quickstart")} prefetch={false}>Start building <span>→</span></Link>
          <Link className="text-button" href={guidePath("examples")} prefetch={false}>Explore {gallery.length} examples ↗</Link>
        </div>
        <InteractiveCode id="docs-install"><InstallCommands /></InteractiveCode>
        <div className="renderer-note">Using Mapbox GL JS? <Link href={guidePath("mapbox")} prefetch={false}>Mapbox setup →</Link></div>
        <div className="hero-meta"><span>TypeScript</span><span>GeoJSON</span><span>MIT license</span></div>
      </div><LiveExample id="home" /></div>
    </div>
    <section className="home-workflows">
      <div className="section-heading"><div><span className="eyebrow">LEARN BY DOING</span><h2>Three paths to your first integration.</h2></div>
        <Link href={guidePath("geometry-editor")} prefetch={false}>Explore the API →</Link>
      </div><WorkflowCards />
    </section>
    <section className="home-bottom"><div>
      <span className="eyebrow">SMALL API. ROOM TO GROW.</span><h2>Start with a polygon.<br />Build a complete workflow.</h2>
      <p>Go from simple drawing to splitting, merging, shared boundaries and transactional updates. Add the tools your application needs.</p>
      <Link className="text-button" href={guidePath("geometry-editor")} prefetch={false}>Browse GeometryEditor →</Link>
    </div><div className="beta-note">
      <span className="version"><span /> {version.includes("-") ? "PUBLIC BETA" : "LATEST RELEASE"}</span>
      <h3>Clear about what is tested.</h3><p>Version {version}. MapLibre 6.15 is checked against browser, latency and memory budgets. Mapbox 3.34 runs shared adapter scenarios in Chromium.</p>
      <Link href={guidePath("compatibility")} prefetch={false}>Compatibility &amp; limits →</Link>
    </div></section>
    <PageFooter />
  </main></div>;
}
