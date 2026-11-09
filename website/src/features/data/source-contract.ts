/** Small source guards shared by adapters; source semantics remain in each adapter. */
export class SourceError extends Error {
  constructor(readonly code: "untrusted-url" | "incomplete" | "http", message: string) { super(message); this.name = "SourceError"; }
}
export function trustedUrl(value: string, origin: string, path: string, descendants = false): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new SourceError("untrusted-url", "Ongeldige bron-URL."); }
  if (url.origin !== origin || url.username || url.password || url.hash || !(url.pathname.replace(/\/$/, "") === path.replace(/\/$/, "") || descendants && url.pathname.startsWith(`${path.replace(/\/$/, "")}/`))) throw new SourceError("untrusted-url", "Onverwachte bron-vervolglink.");
  return url.href;
}
export function requestSignal(signal: AbortSignal, timeout: number): AbortSignal {
  signal.throwIfAborted();
  return AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
}
export function visitPage(visited: Set<string>, url: string, limit: number, message = "Onvolledige bronopvraag: herhaalde pagina of paginalimiet bereikt."): void {
  if (visited.has(url) || visited.size >= limit) throw new SourceError("incomplete", message);
  visited.add(url);
}
export function completeCount(expected: unknown, actual: number): void {
  if (expected !== undefined && (!Number.isSafeInteger(expected) || Number(expected) < 0 || expected !== actual)) throw new SourceError("incomplete", "De bronopvraag is onvolledig.");
}
