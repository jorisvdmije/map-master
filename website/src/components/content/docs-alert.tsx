import type { ReactNode } from "react";
import { InfoIcon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

export function DocsAlert({ kind, title, children }: { kind: string; title: string; children: ReactNode }) {
  const warning = kind === "WARNING" || kind === "IMPORTANT";
  return <Alert className="docs-alert" role="note" data-kind={warning ? "important" : "note"}>
    {warning ? <TriangleAlertIcon aria-hidden="true" /> : <InfoIcon aria-hidden="true" />}
    <AlertTitle>{title}</AlertTitle><AlertDescription>{children}</AlertDescription>
  </Alert>;
}
