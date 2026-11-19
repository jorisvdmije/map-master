import type { Metadata } from "next";
import { DevelopmentDashboard } from "@/features/development/dashboard";

export const metadata: Metadata = {
  title: "Buurtontwikkeling Amsterdam · WOZ door de jaren",
  description:
    "Vergelijk de WOZ-ontwikkeling van Amsterdamse buurten van 2012 tot en met 2026, met tijdlijn, groeiranglijst en woningvoorraadfilter.",
};

export default function DevelopmentPage() {
  return <DevelopmentDashboard />;
}
