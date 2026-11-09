import type { Metadata } from "next";
import { HousingDashboard } from "@/features/housing/dashboard";
export const metadata: Metadata = { title: "Wonen in Amsterdam · waarde, buurt & leefomgeving", description: "Verken 25 echte CBS-buurtkenmerken: WOZ-ontwikkeling, nieuwbouw, opleiding, energie en voorzieningen. Combineer filters en bekijk BAG-adressen, erfpachtcontext en gemeentelijke belastingen." };
export default function HousingPage() { return <HousingDashboard />; }
