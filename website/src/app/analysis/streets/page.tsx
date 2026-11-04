import type { Metadata } from "next";
import { StreetsDashboard } from "@/features/streets/dashboard";
export const metadata: Metadata = { title: "Straatmonitor Amsterdam · echte open data", description: "Verken echte gemeentelijke bomen, lichtpunten, storingen en meldingen op Amsterdamse straten, met concrete indicatoren, correlaties, profielen en bronverantwoording." };
export default function StreetsPage() { return <StreetsDashboard />; }
