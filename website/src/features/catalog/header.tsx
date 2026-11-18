import Link from "next/link";
import { WorkspaceHeader } from "@/components/workspaces/header";

export function CatalogHeader() {
  return (
    <WorkspaceHeader
      current="/data/"
      tagline="Data & inzicht"
      className="db-header"
      brandClassName="db-brand"
    >
      <div className="workspace-header-actions">
        <nav aria-label="Databanknavigatie" className="workspace-optional">
          <Link href="/data/" prefetch={false}>
            Databank
          </Link>
          <Link href="/guides/open-data-amsterdam/" prefetch={false}>
            Bronnen & methode
          </Link>
        </nav>
      </div>
    </WorkspaceHeader>
  );
}
