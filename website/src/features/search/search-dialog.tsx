"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon } from "@/components/layout/search-icon";
import { searchIndexQuery, searchPages } from "./queries";

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(-1);
  const { data, isError, refetch } = useQuery({ ...searchIndexQuery, enabled: open });
  const matches = useMemo(() => searchPages(data ?? [], query), [data, query]);
  const activeIndex = isError ? -1 : Math.min(selected, matches.length - 1);

  useEffect(() => {
    const element = dialog.current!;
    if (open && !element.open) { element.showModal(); input.current?.focus(); }
    else if (!open && element.open) element.close();
  }, [open]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.target === input.current && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      if (!matches.length || isError) return;
      const next = activeIndex < 0 ? event.key === "ArrowDown" ? 0 : matches.length - 1
        : Math.max(0, Math.min(matches.length - 1, activeIndex + (event.key === "ArrowDown" ? 1 : -1)));
      setSelected(next);
      results.current?.querySelectorAll("a")[next]?.scrollIntoView({ block: "nearest" });
    }
    if (event.key === "Enter" && matches.length && event.target === input.current) {
      event.preventDefault();
      results.current?.querySelectorAll("a")[Math.max(0, activeIndex)]?.click();
    }
  }

  return <dialog ref={dialog} className="search-dialog" aria-labelledby="search-title"
    onClose={() => { if (!dialog.current?.open) onClose(); }}
    onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={onKeyDown}
    onClick={event => {
      if (event.target !== dialog.current) return;
      const r = dialog.current.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose();
    }}>
    <div className="search-top">
      <label id="search-title" htmlFor="search-input"><SearchIcon /><span className="sr-only">Search documentation</span></label>
      <input ref={input} id="search-input" type="search" placeholder="Search guides, methods, examples…" autoComplete="off"
        value={query} onChange={event => { setQuery(event.target.value); setSelected(-1); }} aria-controls="search-results"
        role="combobox" aria-autocomplete="list" aria-expanded={open}
        aria-activedescendant={activeIndex >= 0 ? `search-result-${activeIndex}` : undefined} />
      <button className="search-close" aria-label="Close search" onClick={onClose}>Esc</button>
    </div>
    <div ref={results} id="search-results" role="listbox" aria-label="Documentation search results" aria-live="polite">
      {isError ? <p className="search-empty">Search is unavailable. You can still browse every guide in the navigation. <button onClick={() => void refetch()}>Try again</button></p>
        : !data ? "Loading the documentation index…"
        : !matches.length ? <p className="search-empty">No results for “{query}”. Try “snapping”, “undo” or “GeoJSON”.</p>
        : matches.map((page, index) => <Link href={page.href} key={page.href} prefetch={false} onClick={onClose}
          id={`search-result-${index}`} role="option" aria-selected={index === activeIndex} tabIndex={-1}
          className={`search-result${index === activeIndex ? " active" : ""}`}>
          <strong>{page.title}</strong><span>{page.description}</span>
        </Link>)}
    </div>
    <div className="search-footer"><span><kbd>↑</kbd><kbd>↓</kbd> navigate <kbd>↵</kbd> open</span><span>Searches all guides</span></div>
  </dialog>;
}
