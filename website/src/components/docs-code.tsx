import * as React from "react";
import { FileCodeIcon, TerminalIcon, WrapTextIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "./ui/button";
import {
  CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton,
  CodeBlockFooter, CodeBlockHeader, CodeBlockLine, CodeBlockTitle,
} from "./ui/code-block";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";

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

export type DocsIslandProps = { id: string } & (
  | ({ kind: "code" } & CodeExample)
  | { kind: "install" }
);

export const installCommands = {
  npm: "npm i @jorisvdmije/map-master maplibre-gl",
  pnpm: "pnpm add @jorisvdmije/map-master maplibre-gl",
  yarn: "yarn add @jorisvdmije/map-master maplibre-gl",
  bun: "bun add @jorisvdmije/map-master maplibre-gl",
};

function DocsCodeBlock({ code, language, title, lines, id }: CodeExample & { id: string }) {
  const [wrap, setWrap] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const long = lines.length > 18;
  const numbered = lines.length > 2 && language !== "sh" && language !== "text";
  const contentId = `${id}-content`;

  return (
    <CodeBlock className="docs-code" data-language={language}>
      <CodeBlockHeader>
        <CodeBlockTitle>
          {language === "sh" ? <TerminalIcon aria-hidden="true" /> : <FileCodeIcon aria-hidden="true" />}
          {title}
        </CodeBlockTitle>
        <CodeBlockActions>
          <Button variant="ghost" size="icon-xs" aria-label="Wrap lines" title="Wrap lines" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
            <WrapTextIcon aria-hidden="true" />
          </Button>
          <CodeBlockCopyButton value={code} title="Copy code" />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent id={contentId} aria-label={`${title} code`} wrap={wrap} lineNumbers={numbered} className={long ? expanded ? "docs-code-expanded" : "docs-code-collapsed" : undefined}>
        {lines.map((tokens, index) => (
          <CodeBlockLine key={index}>
            {tokens.every(token => !token.content) ? null : tokens.map((token, tokenIndex) => (
              <span key={tokenIndex} style={{
                color: token.color,
                fontStyle: token.fontStyle && token.fontStyle & 1 ? "italic" : undefined,
                fontWeight: token.fontStyle && token.fontStyle & 2 ? 600 : undefined,
              }}>{token.content}</span>
            ))}
          </CodeBlockLine>
        ))}
      </CodeBlockContent>
      {long && <CodeBlockFooter className="justify-center docs-code-footer">
        <Button variant="ghost" size="xs" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show less" : "Show more"}
        </Button>
      </CodeBlockFooter>}
    </CodeBlock>
  );
}

function InstallCommands() {
  return <Tabs defaultValue="npm" className="install-tabs" aria-label="Install Map Master">
    <TabsList variant="line" aria-label="Package manager">
      {Object.keys(installCommands).map(manager => <TabsTrigger key={manager} value={manager}>{manager}</TabsTrigger>)}
    </TabsList>
    {Object.entries(installCommands).map(([manager, command]) => <TabsContent key={manager} value={manager}>
      <CodeBlock className="install-code" size="sm">
        <CodeBlockActions><CodeBlockCopyButton value={command} title="Copy install command" /></CodeBlockActions>
        <CodeBlockContent aria-label={`${manager} install command`}>{command}</CodeBlockContent>
      </CodeBlock>
    </TabsContent>)}
  </Tabs>;
}

export function DocsIsland(props: DocsIslandProps) {
  React.useEffect(() => {
    document.getElementById(props.id)!.dataset.hydrated = "true";
  }, [props.id]);
  return props.kind === "install" ? <InstallCommands /> : <DocsCodeBlock {...props} />;
}

export function DocsAlert({ kind, title, html }: { kind: string; title: string; html: string }) {
  const warning = kind === "WARNING" || kind === "IMPORTANT";
  return <Alert className="docs-alert" role="note" data-kind={warning ? "important" : "note"}>
    {warning ? <TriangleAlertIcon aria-hidden="true" /> : <InfoIcon aria-hidden="true" />}
    <AlertTitle>{title}</AlertTitle>
    <AlertDescription dangerouslySetInnerHTML={{ __html: html }} />
  </Alert>;
}
