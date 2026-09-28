import Script from "next/script";

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <link rel="dns-prefetch" href="https://checkout.razorpay.com" />
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="beforeInteractive"
      />
      {/* Keep Razorpay modal above checkout glass layers; avoid click-steal */}
      <style>{`
        .razorpay-container,
        .razorpay-backdrop,
        iframe.razorpay-checkout-frame {
          z-index: 2147483000 !important;
          pointer-events: auto !important;
        }
      `}</style>
      {children}
    </>
  );
}
