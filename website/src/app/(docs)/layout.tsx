import type { ReactNode } from "react";
import { DocsShell } from "@/components/layout/docs-shell";
import { getManifest } from "@/lib/content";

/** Documentation opts into its chrome structurally; workspaces never render it. */
export default async function DocumentationLayout({ children }: { children: ReactNode }) {
  const { version } = await getManifest();
  return <DocsShell version={version}>{children}</DocsShell>;
}
