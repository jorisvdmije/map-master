import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { QueryProvider } from "@/providers/query-provider";
import { assetPath } from "@/lib/paths";
import "../style.css";
import "../components.css";
import "maplibre-gl/dist/maplibre-gl.css";

export const metadata: Metadata = {
  title: { default: "Map Master — Geometry editing for MapLibre and Mapbox", template: "%s · Map Master" },
  description: "Draw, edit and manage geometry on MapLibre and Mapbox maps. Get started with Map Master, an open-source TypeScript geometry editor.",
  icons: { icon: { url: assetPath("/favicon.svg"), type: "image/svg+xml" } },
};
export const viewport: Viewport = { themeColor: "#153b32" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>
    <noscript><style>{`.docs-island .docs-code-collapsed{max-height:none;overflow:auto}.docs-code-footer,[data-slot=code-block-actions],[data-slot=tabs-list],.search-trigger,.menu-button,.demo-map,.demo-caption{display:none}@media(max-width:700px){.sidebar{display:none}}`}</style></noscript>
    <QueryProvider>{children}</QueryProvider>
  </body></html>;
}
