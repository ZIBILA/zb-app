import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/options";
import { redirect } from "next/navigation";
import DashboardLayout from "../dashboard/layout";

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

  return <DashboardLayout>{children}</DashboardLayout>;
}
