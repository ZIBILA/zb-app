import { redirect } from "next/navigation";

/** The homepage picker now lives in the unified "Products & Order" screen. */
export default function HomepageProductsRedirect() {
  redirect("/dashboard/webstore/merchandising");
}
