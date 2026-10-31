import Script from "next/script";

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <link rel="dns-prefetch" href="https://checkout.razorpay.com" />
      {/* Loaded after the page is interactive: the SDK fetches ~70 of its own chunks
          (~0.8 MB) and used to compete with the checkout bundle and the address
          step's API calls on first load. lib/razorpay-checkout-client.ts waits for
          (or injects) the SDK when the shopper taps Pay. */}
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="lazyOnload"
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
