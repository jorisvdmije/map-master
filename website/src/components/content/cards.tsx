import Link from "next/link";
import { gallery } from "@/content/gallery";
import { guidePath } from "@/lib/paths";

const workflows = [
  { slug: "draw", number: "01 / DRAW", title: "From clicks to geometry", text: "Place a marker, trace a line or draw a polygon. Finish when you are ready.", action: "Try drawing →" },
  { slug: "edit", number: "02 / EDIT", title: "Make every change reversible", text: "Select a shape, move its corners and save. Undo brings the original back.", action: "Try editing →" },
  { slug: "geojson", number: "03 / EXCHANGE", title: "Your data, in and out", text: "Import a GeoJSON collection, edit it on the map and download the result.", action: "Try GeoJSON →" },
];

export function WorkflowCards() {
  return <div className="example-cards">{workflows.map(card =>
    <Link href={guidePath(card.slug)} key={card.slug} prefetch={false}>
      <span className="card-number">{card.number}</span>
      <h3>{card.title} <span>↗</span></h3><p>{card.text}</p><span className="card-link">{card.action}</span>
    </Link>,
  )}</div>;
}

export function ExampleGallery() {
  return <div className="gallery">{gallery.map(([slug, title, text]) =>
    <Link href={guidePath(slug)} key={slug} prefetch={false}>
      <strong>{title}</strong><span>{text}</span><span className="card-link">Open example →</span>
    </Link>,
  )}</div>;
}
