import { assetPath, github } from "@/lib/paths";

export function PageFooter() {
  return <footer className="page-footer">
    <span>Map Master <span className="muted">/</span> MapLibre &amp; Mapbox · <a href={assetPath("/licenses.txt")}>Licenses</a></span>
    <a href={`${github}/issues`} target="_blank" rel="noreferrer">Suggest an improvement ↗</a>
  </footer>;
}
