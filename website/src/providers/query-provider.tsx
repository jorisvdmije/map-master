"use client";

import { QueryClientProvider, isServer, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { makeQueryClient } from "@/lib/queries/client";

let browserClient: QueryClient | undefined;

function getQueryClient() {
  if (isServer) return makeQueryClient();
  return browserClient ??= makeQueryClient();
}

export function QueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={getQueryClient()}>{children}</QueryClientProvider>;
}
