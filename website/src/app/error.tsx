"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="page guide"><main id="main" tabIndex={-1}>
    <article className="article"><h1>This page could not load</h1>
      <p>Try loading the page again, or browse another guide in the navigation.</p>
      <button className="button" onClick={reset}>Try again</button> <Link href="/">Return to the overview</Link>
    </article>
  </main></div>;
}
