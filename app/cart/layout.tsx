import type { Metadata } from "next";

// /cart is a client page; robots.txt already disallows it, this adds the matching meta tag.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function CartLayout({ children }: { children: React.ReactNode }) {
  return children;
}
