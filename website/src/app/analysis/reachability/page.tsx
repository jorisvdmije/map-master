import { Suspense } from "react";
import type { Metadata } from "next";
import { ReachabilityDashboard } from "@/features/reachability/dashboard";
export const metadata: Metadata = { title: "Bereikbaarheid · netwerkcontouren en afstand meten", description: "Bereken loop-, fiets-, e-bike- en autoreistijdcontouren, tel eigen objecten binnen bereik en meet lijnen met lengte-labels." };
export default function ReachabilityPage() { return <Suspense fallback={<main data-reachability><p>Bereikbaarheidskaart laden…</p></main>}><ReachabilityDashboard /></Suspense>; }
