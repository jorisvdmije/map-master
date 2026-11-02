"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** A readiness marker lets browser checks wait for actual React hydration. */
export function InteractiveCode({ id, children }: { id: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.dataset.hydrated = "true"; }, []);
  return <div ref={ref} className="docs-island" data-ui-root id={id}>{children}</div>;
}
