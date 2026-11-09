import type { Metadata } from "next";
import { getCatalog } from "@/lib/content";
import { DataCatalog } from "@/features/catalog/catalog";
export const metadata: Metadata = { title: "Databank", description: "Doorzoek bronnen over wonen, groen, klimaat, verkeer en voorzieningen. Bewaar favorieten, bekijk bronprofielen en download beschikbare datasets." };
export default async function DataPage() { return <DataCatalog catalog={await getCatalog()} />; }
