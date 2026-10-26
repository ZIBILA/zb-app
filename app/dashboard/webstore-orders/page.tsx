import { redirect } from "next/navigation";

/** Legacy path — orders live under /dashboard/webstore/orders. */
export default function DashboardWebStoreOrdersPage() {
  redirect("/dashboard/webstore/orders");
}
