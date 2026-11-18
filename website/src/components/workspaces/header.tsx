import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { assetPath } from "@/lib/paths";
import { WorkspaceNavigation } from "./navigation";
import "./header.css";

/**
 * The one header for every workspace: brand, workspace switcher, then the
 * page's own actions. Wrap right-aligned actions in `workspace-header-actions`.
 */
export function WorkspaceHeader({
  current,
  tagline,
  language = "nl",
  className = "",
  brandClassName = "",
  children,
}: {
  current: string;
  tagline: string;
  language?: "nl" | "en";
  className?: string;
  brandClassName?: string;
  children?: ReactNode;
}) {
  return (
    <header className={`workspace-header ${className}`.trim()}>
      <Link
        className={`workspace-brand ${brandClassName}`.trim()}
        href="/"
        prefetch={false}
        aria-label={
          language === "nl"
            ? "Map Master, naar de documentatie"
            : "Map Master documentation"
        }
      >
        <Image
          src={assetPath("/logo.svg")}
          alt=""
          width={30}
          height={30}
          priority
        />
        <span>
          Map Master<small>{tagline}</small>
        </span>
      </Link>
      <WorkspaceNavigation current={current} language={language} />
      {children}
    </header>
  );
}
