import { redirect } from "next/navigation";

/** Admin dashboard AI webhooks panel removed (Developer Brief item #26). */
export default function RemovedAdminAiWebhooksPage() {
  redirect("/dashboard");
}
