import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/options";
import { redirect } from "next/navigation";

/** Auth-gated admin store tools — skip static generation to reduce build memory. */
export const dynamic = "force-dynamic";

/**
 * Permission check only. Do NOT wrap DashboardClientLayout again —
 * app/dashboard/layout.tsx already provides the shell. Nesting it doubled
 * sidebars, Polaris, and polling on every webstore page.
 */
export default async function ServerWebStoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user) {
    redirect("/dashboard/login");
  }

  const role = (session.user as any).role;
  const permissions = (session.user as any).permissions || [];

  if (role !== "SUPER_ADMIN" && !permissions.some((p: any) => p.module === "STOREFRONT" && p.canView)) {
    redirect("/unauthorized");
  }

  return <>{children}</>;
}
