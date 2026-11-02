import Link from "next/link";
import { PageFooter } from "@/components/layout/page-footer";

export default function NotFound() {
  return <div className="page guide"><main id="main" tabIndex={-1}>
    <article className="article"><h1>Page not found</h1>
      <p>This documentation page could not be found.</p>
      <p><Link href="/">Return to the overview</Link> or <Link href="/guides/all-guides/">browse all documentation</Link>.</p>
    </article><PageFooter />
  </main></div>;
}
