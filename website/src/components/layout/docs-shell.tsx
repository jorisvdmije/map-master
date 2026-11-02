"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { groups } from "@/content/navigation";
import { gallery } from "@/content/gallery";
import { assetPath, basePath, github, guidePath } from "@/lib/paths";
import { SearchDialog } from "@/features/search/search-dialog";
import { SearchIcon } from "./search-icon";
import { useMobileNavigation } from "@/lib/use-mobile-navigation";

type Overlay = { pathname: string; kind: "menu" | "search" | null };

export function DocsShell({ version, children }: { version: string; children: ReactNode }) {
  const pathname = usePathname();
  const [overlay, setOverlay] = useState<Overlay>({ pathname, kind: null });
  // Reset route-dependent UI during rendering, before committing the new page.
  if (overlay.pathname !== pathname) setOverlay({ pathname, kind: null });
  const menuOpen = overlay.pathname === pathname && overlay.kind === "menu";
  const searchOpen = overlay.pathname === pathname && overlay.kind === "search";
  const mobile = useMobileNavigation();
  const menu = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => {
    if (menu.current?.ariaExpanded === "true" && window.matchMedia("(max-width: 700px)").matches) menu.current.focus({ preventScroll: true });
    setOverlay(current => current.kind === "menu" ? { ...current, kind: null } : current);
  }, []);
  const closeSearch = useCallback(() => setOverlay(current => current.kind === "search" ? { ...current, kind: null } : current), []);
  const closeOverlays = useCallback(() => { closeMenu(); closeSearch(); }, [closeMenu, closeSearch]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    media.addEventListener("change", closeMenu);
    return () => media.removeEventListener("change", closeMenu);
  }, [closeMenu]);
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape") closeOverlays();
      const target = event.target;
      if ((event.key === "/" || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k"))
        && target instanceof HTMLElement && !target.closest("input, textarea, [contenteditable], canvas")) {
        event.preventDefault();
        closeMenu();
        setOverlay({ pathname, kind: "search" });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pathname, closeMenu, closeOverlays]);

  const currentPath = basePath && pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : pathname;
  return <div className={`docs-shell${menuOpen ? " menu-open" : ""}`}>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="topbar">
      <Link className="brand" href="/" onClick={closeOverlays} prefetch={false}>
        <Image src={assetPath("/logo.svg")} width={38} height={38} alt="" loading="eager" />
        <span>Map Master<span className="brand-label">DOCS</span></span>
      </Link>
      <button className="search-trigger" aria-haspopup="dialog" onClick={() => { closeMenu(); setOverlay({ pathname, kind: "search" }); }}>
        <SearchIcon /><span>Search documentation</span><kbd>/</kbd>
      </button>
      <noscript><a className="nojs-navigation" href={`${basePath}${guidePath("all-guides")}`}>All guides</a></noscript>
      <nav className="header-links" aria-label="Project links">
        <Link className="version" href={guidePath("changelog")} onClick={closeOverlays} prefetch={false}><span />{version}</Link>
        <a href={github} target="_blank" rel="noreferrer">GitHub ↗</a>
        <button ref={menu} className="menu-button" aria-expanded={menuOpen} aria-controls="sidebar" aria-label="Open navigation"
          onClick={() => setOverlay({ pathname, kind: menuOpen ? null : "menu" })}>☰</button>
      </nav>
    </header>
    <div className="sidebar-shade" hidden={!menuOpen} onClick={closeMenu} />
    <aside className="sidebar" id="sidebar" aria-label="Documentation navigation" inert={mobile && !menuOpen}>
      {groups.map(([name, links]) => <section className="nav-group" key={name}><h2>{name}</h2>
        {links.map(([id, label]) => <Link href={guidePath(id)} key={id} prefetch={false} onClick={closeOverlays}
          aria-current={currentPath === guidePath(id).split("#")[0] && id !== "snapping" ? "page" : undefined}>
          {label}{id === "examples" && <span className="nav-count">{gallery.length}</span>}
        </Link>)}
      </section>)}
      <div className="sidebar-footer"><span className="status-dot" /> Open source · MIT licensed</div>
    </aside>
    <div inert={menuOpen}>{children}</div>
    <SearchDialog open={searchOpen} onClose={closeSearch} />
  </div>;
}
