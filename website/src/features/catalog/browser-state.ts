import { useSyncExternalStore } from "react";
import { defaultFilters, type CatalogFilters } from "./model";
const event = "map-master-catalog-state";
const key = "map-master-catalog-saved-v1";
let memory = "[]";
let failedWrite = false;
const subscribe = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  window.addEventListener("storage", listener);
  window.addEventListener(event, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener("storage", listener);
    window.removeEventListener(event, listener);
  };
};
const getSearch = () => window.location.search;
const getSaved = () => {
  if (failedWrite) return memory;
  try {
    return localStorage.getItem(key) ?? memory;
  } catch {
    return memory;
  }
};
export const useCatalogReady = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
export const useCatalogSearch = () =>
  useSyncExternalStore(subscribe, getSearch, () => "");
export const useSavedDatasets = () =>
  useSyncExternalStore(subscribe, getSaved, () => "[]");
export function updateFilters(filters: CatalogFilters, replace = false) {
  const url = new URL(window.location.href);
  for (const key of Object.keys(defaultFilters) as (keyof CatalogFilters)[]) {
    if (filters[key] === defaultFilters[key]) url.searchParams.delete(key);
    else
      url.searchParams.set(key, key === "saved" ? "1" : String(filters[key]));
  }
  if (url.href !== window.location.href)
    window.history[replace ? "replaceState" : "pushState"](null, "", url);
  window.dispatchEvent(new Event(event));
}
export function saveDatasets(ids: string[]) {
  memory = JSON.stringify(ids);
  let stored = true;
  try {
    localStorage.setItem(key, memory);
    failedWrite = false;
  } catch {
    stored = false;
    failedWrite = true;
  }
  window.dispatchEvent(new Event(event));
  return stored;
}
