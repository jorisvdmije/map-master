export interface CodeToken {
  content: string;
  color?: string;
  fontStyle?: number;
}

export interface CodeExample {
  code: string;
  language: string;
  title: string;
  lines: CodeToken[][];
}

export interface Heading {
  text: string;
  depth: number;
  id: string;
}

export interface GuideSummary {
  slug: string;
  title: string;
  description: string;
  sourcePath: string;
}

export interface Guide extends GuideSummary {
  html: string;
  headings: Heading[];
  codeBlocks: Record<string, CodeExample>;
}

export interface ContentManifest {
  version: string;
  guides: GuideSummary[];
}

export interface SearchPage {
  title: string;
  href: string;
  description: string;
  text: string;
}
