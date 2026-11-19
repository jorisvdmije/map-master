import type { Metadata } from "next";
import { Suspense } from "react";
import { AreaReport } from "@/features/area-report/report";
import Link from "next/link";
import { WorkspaceHeader } from "@/components/workspaces/header";
export const metadata: Metadata = {
  title: "Gebiedsrapport Amsterdam",
  description:
    "Kies een Amsterdamse buurt of adres. Bekijk wonen, bewoners, energie, voorzieningen, bomen, geluid en bereikbaarheid met bronjaren en een downloadbaar rapport.",
};
export default function AreaReportPage() {
  return (
    <Suspense
      fallback={
        <main lang="nl" className="db-root gr-root" data-area-report>
          <WorkspaceHeader
            current="/area-report/"
            tagline="Van bron naar buurt"
            className="db-header"
            brandClassName="db-brand"
          />
          <section className="gr-intro">
            <h1>Gebiedsrapport Amsterdam</h1>
            <p>Buurtkeuze laden…</p>
            <noscript>
              <p>
                Gebiedsrapporten vragen JavaScript. De{" "}
                <Link href="/data/cbs-buurten/">
                  CBS-bestanden in de databank
                </Link>{" "}
                blijven rechtstreeks beschikbaar.
              </p>
            </noscript>
          </section>
        </main>
      }
    >
      <AreaReport />
    </Suspense>
  );
}
