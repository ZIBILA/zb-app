export const BACKEND_BASE_URL = 'https://app.zicabella.com';

/** Razorpay create-order/verify must hit a host the phone can reach. localhost/127.0.0.1 fails on device. */
export function getPaymentApiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_PAYMENT_API_URL?.replace(/\/$/, '');
  if (explicit) return explicit;

  const appUrl = process.env.EXPO_PUBLIC_APP_URL || BACKEND_BASE_URL;
  if (appUrl.includes('localhost') || appUrl.includes('127.0.0.1')) {
    return BACKEND_BASE_URL;
  }
  return appUrl;
}

export const config = {
  appUrl: process.env.EXPO_PUBLIC_APP_URL || BACKEND_BASE_URL,
  /** Canonical 3D footer logo — keep in sync with `components/StorefrontFooter.tsx` (model-viewer) */
  footerLogo3dGlb:
    'https://cdn.shopify.com/3d/models/e024b09e83a75c03/Zicabella-silver-logo.glb',
  /** Store / marketing contact page (matches web footer). */
  contactPage: 'https://zicabella.com/policies/contact-information',
  /** Fallback hero media when /api/app/config is slow or unreachable */
  heroVideoUrl:
    'https://cdn.shopify.com/videos/c/o/v/7f976d2c622a4a0b80c43f8fc0fddd7e.mp4',
  heroImageUrl:
    'https://cdn.shopify.com/s/files/1/0955/5394/5881/files/Zica-bella-luxury-streetwear-brand_f9d3cad3-ed6a-48d0-b90e-3a1bdd26df5e.jpg?v=1785846857',
  razorpay: {
    keyId: process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID || '',
  },
  policies: {
    privacy: 'https://zicabella.com/policies/privacy-policy',
    refund: 'https://zicabella.com/policies/refund-policy',
    shipping: 'https://zicabella.com/policies/shipping-policy',
    terms: 'https://zicabella.com/policies/terms-of-service',
  },
  trending: ['T-shirt', 'Jeans', 'Pants', 'Trousers', 'Jorts', 'Shirts', 'Acid Tees', 'Leather'],
};
