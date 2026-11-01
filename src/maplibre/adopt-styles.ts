const adopted = new WeakMap<Node, Set<string>>();

/**
 * Add a stylesheet to a document or shadow root once. Constructed style sheets also work
 * under a Content Security Policy without 'unsafe-inline'; older browsers get a style element.
 */
export function adoptStyles(root: Document | ShadowRoot, css: string): void {
  let sheets = adopted.get(root);
  if (!sheets) adopted.set(root, sheets = new Set());
  if (sheets.has(css)) return;
  sheets.add(css);
  const document = root instanceof Document ? root : root.ownerDocument;
  const view = document.defaultView;
  if (view && 'replaceSync' in view.CSSStyleSheet.prototype) {
    const sheet = new view.CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    return;
  }
  const style = document.createElement('style');
  style.textContent = css;
  (root instanceof Document ? root.head : root).append(style);
}

/** Style an element's document or shadow root once it is connected. */
export function adoptStylesFor(element: Element, css: string): void {
  const root = element.getRootNode();
  if (root instanceof Document || root instanceof ShadowRoot) adoptStyles(root, css);
}
