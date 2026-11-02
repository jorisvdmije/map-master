"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { demoHints } from "@/content/demo-hints";
import { basemapQuery, fallbackStyle } from "./queries";
import type { DemoRuntime, ExampleControlsProps } from "./types";

const noSubscribe = () => () => {};
const emptySnapshot = () => null;

export function LiveExample({ id }: { id: string }) {
  const [attempt, setAttempt] = useState(0);
  return <ExampleSession key={`${id}:${attempt}`} id={id} onRetry={() => setAttempt(value => value + 1)} />;
}

function ExampleSession({ id, onRetry }: { id: string; onRetry: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const queryClient = useQueryClient();
  const [error, setError] = useState(false);
  const [session, setSession] = useState<{ runtime: DemoRuntime; Controls: ComponentType<ExampleControlsProps> } | null>(null);
  const snapshot = useSyncExternalStore(session?.runtime.subscribe ?? noSubscribe, session?.runtime.getSnapshot ?? emptySnapshot, emptySnapshot);
  const hint = demoHints[id as keyof typeof demoHints];
  if (!hint) throw new Error(`Unknown live example: ${id}`);

  useEffect(() => {
    const container = ref.current!;
    const lifetime = new AbortController();
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      // A plain background is a per-map fallback, never a successful cached style.
      const style = queryClient.fetchQuery(basemapQuery).catch(() => fallbackStyle);
      void Promise.all([import("./demo"), import("./example-controls"), style])
        .then(async ([{ mountDemo }, { ExampleControls }, style]) => {
          if (lifetime.signal.aborted) return;
          const runtime = await mountDemo(container, lifetime.signal, structuredClone(style));
          if (runtime && !lifetime.signal.aborted) setSession({ runtime, Controls: ExampleControls });
        })
        .catch(() => {
          if (lifetime.signal.aborted) return;
          // A structurally invalid cached style must be fetched again on retry.
          void queryClient.invalidateQueries({ queryKey: basemapQuery.queryKey, refetchType: "none" });
          setError(true);
          lifetime.abort();
        });
    }, { rootMargin: "300px" });
    observer.observe(container);
    return () => {
      lifetime.abort();
      observer.disconnect();
    };
  }, [id, queryClient]);

  const Controls = session?.Controls;
  return <figure ref={ref} className={`demo${session?.runtime.tall ? " demo--tall" : ""}`} data-demo={id}
    data-ready={session ? "true" : undefined} data-mode={snapshot?.state.mode} data-feature-count={snapshot?.state.featureCount}>
    <noscript><p className="demo-nojs">Interactive examples need JavaScript. You can still browse the guides and code.</p></noscript>
    <div className="demo-map" role="region" aria-label="Interactive map example" />
    {session && snapshot && Controls ? <Controls runtime={session.runtime} snapshot={snapshot} hint={hint} /> : <figcaption className="demo-caption">
      <p className="demo-hint"><span className="demo-badge">Try it</span>{hint}</p>
      <div className="demo-footer">
        <p className="demo-status" role="status">{error ? "The interactive example could not load. Check WebGL support and try again." : "Loading the map…"}</p>
        {error ? <button type="button" className="demo-reset" onClick={onRetry}>Retry example</button>
          : <button type="button" className="demo-reset" disabled>Reset</button>}
      </div>
    </figcaption>}
  </figure>;
}
