"use client";

import { useSyncExternalStore } from "react";

const query = "(max-width: 700px)";
const subscribe = (listener: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};
const getSnapshot = () => window.matchMedia(query).matches;
const getServerSnapshot = () => false;

export function useMobileNavigation() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
