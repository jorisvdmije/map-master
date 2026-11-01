import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { DocsAlert, DocsIsland, type DocsIslandProps } from "./docs-code";

// Generate readable HTML at build time, then hydrate only these small islands.
export function renderDocsIsland(props: DocsIslandProps) {
  const markup = renderToString(<DocsIsland {...props} />, { identifierPrefix: `${props.id}-` });
  const json = JSON.stringify(props).replaceAll("<", "\\u003c");
  return `<div class="docs-island" data-ui-root id="${props.id}">${markup}</div><script type="application/json" data-ui-props>${json}</script>`;
}

export function renderDocsAlert(props: { kind: string; title: string; html: string }) {
  return renderToStaticMarkup(<DocsAlert {...props} />);
}
