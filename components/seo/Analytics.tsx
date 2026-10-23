import Script from 'next/script';

export function Analytics() {
  return (
    <Script id="google-analytics-init" strategy="lazyOnload">
      {`
        window.dataLayer = window.dataLayer || [];
        if (!window.gtag) {
          window.gtag = function(){(window.dataLayer = window.dataLayer || []).push(arguments);}
        }
      `}
    </Script>
  );
}

