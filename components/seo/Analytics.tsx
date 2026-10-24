export function Analytics() {
  return (
    <script
      id="google-analytics-init"
      dangerouslySetInnerHTML={{
        __html: `
          window.dataLayer = window.dataLayer || [];
          if (!window.gtag) {
            window.gtag = function(){(window.dataLayer = window.dataLayer || []).push(arguments);}
          }
        `,
      }}
    />
  );
}

