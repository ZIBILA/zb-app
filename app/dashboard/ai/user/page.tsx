import { redirect } from "next/navigation";

/** Admin dashboard AI user panel removed (Developer Brief item #26). */
export default function RemovedAdminAiUserPage() {
  redirect("/dashboard");
}
