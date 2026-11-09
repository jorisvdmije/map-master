"use client";
import { useEffect, useState } from "react";

export type ViewData = Record<string, unknown>;
export type ViewRule = (value: unknown) => boolean;
export const text = (value: unknown) =>
  typeof value === "string" && value.length <= 300;
export const flag = (value: unknown) => typeof value === "boolean";
export const oneOf =
  (values: readonly unknown[]): ViewRule =>
  (value) =>
    values.includes(value);
export const recordOf =
  (rules: Record<string, ViewRule>): ViewRule =>
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const record = value as Record<string, unknown>;
    return Object.entries(rules).every(([key, rule]) => rule(record[key]));
  };
export const bounded =
  (min: number, max: number): ViewRule =>
  (value) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max;

export function readView(
  search: string,
  app: string,
  defaults: ViewData,
  rules: Record<string, ViewRule>,
): ViewData {
  try {
    const raw = new URLSearchParams(search).get("view");
    if (!raw || raw.length > 8000) return defaults;
    const envelope = JSON.parse(raw);
    if (
      envelope.version !== 1 ||
      envelope.app !== app ||
      !envelope.data ||
      typeof envelope.data !== "object" ||
      Array.isArray(envelope.data)
    )
      return defaults;
    return Object.fromEntries(
      Object.entries(defaults).map(([key, fallback]) => [
        key,
        rules[key]?.(envelope.data[key]) ? envelope.data[key] : fallback,
      ]),
    );
  } catch {
    return defaults;
  }
}

/** Only explicit, public research settings enter the URL. Files and addresses stay local. */
export function ShareView({
  app,
  data,
  defaults,
  rules,
  apply,
}: {
  app: string;
  data: ViewData;
  defaults: ViewData;
  rules: Record<string, ViewRule>;
  apply: (value: ViewData) => void;
}) {
  const [status, setStatus] = useState("");
  useEffect(() => {
    const restore = () =>
      apply(readView(window.location.search, app, defaults, rules));
    // Restoring external history is intentional, including an empty URL on Back.
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
    // Configuration is supplied by the owning dashboard; handlers capture only setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app]);
  const share = async () => {
    if (Object.keys(defaults).some((key) => !rules[key]?.(data[key]))) {
      setStatus(
        "Controleer eerst de instellingen; een ongeldige weergave kan niet worden gedeeld.",
      );
      return;
    }
    const encoded = JSON.stringify({ version: 1, app, data });
    if (encoded.length > 8000) {
      setStatus("Deze weergave is te groot voor een deelbare link.");
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("view", encoded);
    if (url.href !== window.location.href)
      window.history.pushState(null, "", url);
    try {
      await navigator.clipboard.writeText(url.href);
      setStatus("Link gekopieerd");
    } catch {
      setStatus("Link staat in de adresbalk");
    }
  };
  return (
    <div className="research-share">
      <button className="an-button" onClick={() => void share()}>
        Deel weergave
      </button>
      <span role="status">{status}</span>
    </div>
  );
}
