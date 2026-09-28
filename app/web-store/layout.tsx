import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/options";
import { redirect } from "next/navigation";
import DashboardClientLayout from "../dashboard/DashboardClientLayout";

/** Auth-gated admin store tools — skip static generation to reduce build memory. */
export const dynamic = "force-dynamic";

export default async function ServerWebStoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  // Secure redirect if not authenticated
  if (!session || !session.user) {
    redirect("/dashboard/login");
  }

  const role = (session.user as any).role;
  const permissions = (session.user as any).permissions || [];
  
  if (role !== "SUPER_ADMIN" && !permissions.some((p: any) => p.module === "STOREFRONT" && p.canView)) {
    redirect("/unauthorized");
  }

  return <DashboardClientLayout>{children}</DashboardClientLayout>;
}
