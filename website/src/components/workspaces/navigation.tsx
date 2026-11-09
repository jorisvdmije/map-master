import Link from "next/link";
import "./navigation.css";

export const workspaces = [
  { href: "/data/", en: "Data catalog", nl: "Databank" },
  { href: "/area-report/", en: "Area report", nl: "Gebiedsrapport" },
  { href: "/playground/", en: "Playground", nl: "Playground" },
  { href: "/analysis/", en: "Free analysis", nl: "Vrije analyse" },
  { href: "/analysis/bnb/", en: "B&B permits", nl: "B&B-vergunningen" },
  { href: "/analysis/streets/", en: "Street quality", nl: "Straatkwaliteit" },
  { href: "/analysis/housing/", en: "Housing", nl: "Wonen" },
  { href: "/analysis/reachability/", en: "Reachability", nl: "Bereikbaarheid" },
] as const;

/** Native disclosure keeps the complete workspace list usable without JavaScript. */
export function WorkspaceNavigation({
  current,
  language = "nl",
}: {
  current: string;
  language?: "nl" | "en";
}) {
  return (
    <details className="workspace-switcher">
      <summary>{language === "nl" ? "Toepassingen" : "Workspaces"}</summary>
      <nav
        aria-label={language === "nl" ? "Alle toepassingen" : "All workspaces"}
      >
        {workspaces.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            aria-current={current === item.href ? "page" : undefined}
          >
            {item[language]}
          </Link>
        ))}
        <Link href="/" prefetch={false}>
          {language === "nl" ? "Documentatie" : "Documentation"}
        </Link>
      </nav>
    </details>
  );
}
