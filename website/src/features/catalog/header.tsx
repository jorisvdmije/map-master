import Image from "next/image";
import Link from "next/link";
import { WorkspaceNavigation } from "@/components/workspaces/navigation";
import { assetPath } from "@/lib/paths";
export function CatalogHeader() {
  return (
    <header className="db-header">
      <Link className="db-brand" href="/" prefetch={false}>
        <Image src={assetPath("/logo.svg")} alt="" width={34} height={34} />
        <span>
          Map Master<small>DATA & INZICHT</small>
        </span>
      </Link>
      <nav aria-label="Databanknavigatie">
        <Link href="/data/" prefetch={false}>
          Databank
        </Link>
        <Link href="/guides/open-data-amsterdam/" prefetch={false}>
          Bronnen & methode
        </Link>
      </nav>
      <WorkspaceNavigation current="/data/" />
    </header>
  );
}
