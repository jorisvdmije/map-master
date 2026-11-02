import "server-only";
import Link from "next/link";
import parse, { Element, domToReact, attributesToProps, type DOMNode, type HTMLReactParserOptions } from "html-react-parser";
import type { Guide } from "@/content/types";
import { DocsCodeBlock } from "@/components/docs-code";
import { DocsAlert } from "./docs-alert";
import { LiveExample } from "@/features/examples/live-example";
import { InteractiveCode } from "./interactive-code";
import { ExampleGallery, WorkflowCards } from "./cards";

/** Only trusted repository Markdown reaches this server component. */
export function MarkdownContent({ guide }: { guide: Guide }) {
  const options: HTMLReactParserOptions = {
    replace(node) {
      if (!(node instanceof Element)) return;
      const children = () => domToReact(node.children as DOMNode[], options);
      const id = node.attribs["data-id"];
      switch (node.name) {
        case "docs-code": {
          const example = guide.codeBlocks[id];
          if (!example) throw new Error(`Missing code block ${guide.slug}/${id}`);
          return <InteractiveCode id={id}><DocsCodeBlock id={id} {...example} /></InteractiveCode>;
        }
        case "docs-demo": return <LiveExample id={id} />;
        case "docs-workflows": return <WorkflowCards />;
        case "docs-gallery": return <ExampleGallery />;
        case "docs-alert": return <DocsAlert kind={node.attribs["data-kind"]} title={node.attribs["data-title"]}>
          {children()}
        </DocsAlert>;
        case "table": return <div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable reference table">
          <table {...attributesToProps(node.attribs)}>{children()}</table>
        </div>;
        case "a": {
          const { href, ...attributes } = node.attribs;
          if (href?.startsWith("/")) return <Link {...attributesToProps(attributes)} href={href} prefetch={false}>{children()}</Link>;
        }
      }
    },
  };
  return parse(guide.html, options);
}
