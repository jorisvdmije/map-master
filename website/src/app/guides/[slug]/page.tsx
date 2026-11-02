import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkdownContent } from "@/components/content/markdown-content";
import { TableOfContents } from "@/components/content/table-of-contents";
import { PageFooter } from "@/components/layout/page-footer";
import { getGuide, getManifest } from "@/lib/content";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export async function generateStaticParams() {
  const { guides } = await getManifest();
  return guides.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const guide = await getGuide((await params).slug);
  if (!guide) notFound();
  return { title: guide.title, description: guide.description };
}

export default async function GuidePage({ params }: Props) {
  const guide = await getGuide((await params).slug);
  if (!guide) notFound();
  return <div className="page guide" key={guide.slug}>
    <main id="main" tabIndex={-1}>
      <div className="breadcrumbs"><Link href="/" prefetch={false}>Documentation</Link><span>/</span>{guide.title}</div>
      <article className="article"><MarkdownContent guide={guide} /></article>
      <PageFooter />
    </main>
    <TableOfContents headings={guide.headings} sourcePath={guide.sourcePath} />
  </div>;
}
