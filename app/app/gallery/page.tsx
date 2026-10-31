import type { Metadata } from "next";
import GalleryClient from "../../gallery/GalleryClient";

export const metadata: Metadata = {
  title: { absolute: "Gallery | Zica Bella® | Luxury Indian Streetwear Archive" },
  description:
    "Explore the visual archive and curated gallery of Zica Bella. Boxy silhouettes, acid-wash textures, heavyweight streetwear drops, and behind-the-scenes campaign visuals.",
  openGraph: {
    title: "Gallery | Zica Bella® | Visual Campaign & Lookbook Archive",
    description:
      "Curated gallery of Zica Bella luxury streetwear. View campaign looks, product drops, and exclusive visual archives.",
  },
};

export default function AppGalleryPage() {
  return <GalleryClient />;
}
