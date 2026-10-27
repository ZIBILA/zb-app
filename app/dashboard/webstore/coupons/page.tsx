"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";

export default function WebStoreCouponsRedirect() {
  const router = useRouter();

  useEffect(() => {
    // Redirect webstore coupons directly to the unified marketing discounts manager
    router.replace("/dashboard/marketing/discounts");
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 opacity-50 p-6 text-center">
      <Clock className="w-10 h-10 animate-spin text-foreground" />
      <h3 className="text-sm font-bold uppercase tracking-widest text-foreground">
        Redirecting to Unified Promo Manager...
      </h3>
      <p className="text-xs text-foreground/60 max-w-md">
        The Webstore Coupons list has been consolidated under the marketing module. Redirecting you to Marketing &gt; Discounts...
      </p>
    </div>
  );
}
