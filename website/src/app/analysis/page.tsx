import type { Metadata } from "next";
import { Analysis } from "@/features/analysis/analysis";

export const metadata: Metadata = {
  title: "Geodata analysis",
  description: "Explore GeoJSON and CSV on a map. Draw analysis areas, filter charts, calculate statistics and export your results locally with Map Master.",
};

export default function AnalysisPage() { return <Analysis />; }
