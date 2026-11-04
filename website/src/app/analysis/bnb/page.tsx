import type { Metadata } from "next";
import { BnbDashboard } from "@/features/bnb/dashboard";

export const metadata: Metadata = {
  title: "B&B-vergunningen · voorbeeldanalyse",
  description: "Verken een B&B-vergunningendashboard met 110 wijkpolygonen, vergunninglocaties, vrije ruimte en aanvragen in behandeling. Echte Amsterdamse vergunningswijken, fictieve vergunningdata.",
};

export default function BnbPage() { return <BnbDashboard />; }
