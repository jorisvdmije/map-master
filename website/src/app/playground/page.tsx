import type { Metadata } from "next";
import { Playground } from "@/features/playground/playground";
import { getManifest } from "@/lib/content";

export const metadata: Metadata = {
  title: "Geodata playground",
  description: "Import, draw and edit GeoJSON in your browser. Manage layers, edit attributes, style features and export your work with Map Master.",
};

export default async function PlaygroundPage() {
  const { version } = await getManifest();
  return <Playground version={version} />;
}
