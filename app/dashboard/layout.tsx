import DashboardClientLayout from "./DashboardClientLayout";

/** Admin UI is auth-gated — never prerender; cuts Render build RAM significantly. */
export const dynamic = "force-dynamic";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardClientLayout>{children}</DashboardClientLayout>;
}
