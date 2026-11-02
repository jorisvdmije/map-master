"use client";

import { useEffect, useRef, useState } from "react";
import type { Heading } from "@/content/types";
import { github } from "@/lib/paths";

export function TableOfContents({ headings, sourcePath }: { headings: Heading[]; sourcePath: string }) {
  const ref = useRef<HTMLElement>(null);
  const [active, setActive] = useState("");
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      const visible = entries.find(entry => entry.isIntersecting);
      if (visible) setActive(visible.target.id);
    }, { rootMargin: "-90px 0px -65% 0px" });
    for (const heading of headings) {
      const node = document.getElementById(heading.id);
      if (node && heading.depth === 2) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [headings]);
  if (!headings.some(heading => heading.depth === 2)) return null;
  return <aside ref={ref} className="toc" aria-label="On this page"><h2>On this page</h2>
    {headings.filter(heading => heading.depth === 2).map(heading =>
      <a href={`#${heading.id}`} key={heading.id} className={active === heading.id ? "active" : undefined}>{heading.text}</a>,
    )}
    <a className="toc-source" href={`${github}/blob/main/${sourcePath}`} target="_blank" rel="noreferrer">View source ↗</a>
  </aside>;
}
