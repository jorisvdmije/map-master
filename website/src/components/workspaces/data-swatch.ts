import type { CSSProperties } from "react";

/** Passes a data-scale colour to the `[data-swatch]` marker in primitives.css. */
export const dataSwatch = (color: string) =>
  ({ "--mm-data": color }) as CSSProperties;
