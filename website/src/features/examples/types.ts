import type { DataChangeEvent, EditorState, GeometryEditor } from "@jorisvdmije/map-master";
import type { Map } from "maplibre-gl";
import type { DemoConfig } from "./demos";

export interface DemoSnapshot {
  state: EditorState;
  events: readonly DataChangeEvent[];
  revision: number;
}

export interface DemoRuntime {
  editor: GeometryEditor;
  map: Map;
  config: DemoConfig;
  tall: boolean;
  reset: () => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => DemoSnapshot;
}

export interface ExampleControlsProps {
  runtime: DemoRuntime;
  snapshot: DemoSnapshot;
  hint: string;
}
