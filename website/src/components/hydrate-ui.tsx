import { hydrateRoot } from "react-dom/client";
import { DocsIsland, type DocsIslandProps } from "./docs-code";

export function hydrateDocsComponents() {
  document.querySelectorAll<HTMLElement>("[data-ui-root]").forEach(root => {
    const payload = root.nextElementSibling;
    if (!(payload instanceof HTMLScriptElement) || !payload.hasAttribute("data-ui-props")) return;
    const props = JSON.parse(payload.textContent!) as DocsIslandProps;
    hydrateRoot(root, <DocsIsland {...props} />, { identifierPrefix: `${props.id}-` });
  });
}
