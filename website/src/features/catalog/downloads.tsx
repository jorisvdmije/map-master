import { Download } from "lucide-react";
import { assetPath } from "@/lib/paths";
import type { Download as FileDownload } from "./types";
export const fileSize = (bytes: number) =>
  bytes < 1_000_000
    ? `${(bytes / 1000).toLocaleString("nl-NL", { maximumFractionDigits: 0 })} kB`
    : `${(bytes / 1_000_000).toLocaleString("nl-NL", { maximumFractionDigits: 1 })} MB`;
export function DatasetDownloads({ files }: { files: FileDownload[] }) {
  return (
    <ul className="db-downloads">
      {files.map((file) => (
        <li key={file.path}>
          <a href={assetPath(file.path)} download data-dataset-download>
            <Download size={17} aria-hidden="true" />
            <span>
              {file.label}
              <small>
                {file.format} · {fileSize(file.bytes)}
              </small>
            </span>
          </a>
          <details>
            <summary>Bestandscontrole</summary>
            <code>SHA-256: {file.sha256}</code>
          </details>
        </li>
      ))}
    </ul>
  );
}
