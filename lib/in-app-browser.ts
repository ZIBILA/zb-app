/**
 * In-app browser / WebView detection for the Razorpay checkout mode.
 *
 * Razorpay's Standard Checkout documents that in-app browsers (Instagram, Facebook,
 * Messenger, Snapchat, Opera Mini, UC …) and WebViews do not support the iframe
 * (modal + `handler`) flow and must use `callback_url` with `redirect: true`
 * instead. Detection is by user agent and intentionally errs on the side of the
 * documented redirect flow: a false positive only changes how the success page is
 * reached (server-side callback instead of the JS handler), never whether the
 * payment can be made.
 */

const IN_APP_PATTERNS: RegExp[] = [
  /\bInstagram\b/i,
  /\bFBAN\b|\bFBAV\b|\bFB_IAB\b|\bFBIOS\b|\bFB4A\b|\bFBSV\b/,
  /\bMessenger\b/i,
  /\bSnapchat\b/i,
  /\bLine\//,
  /\bTwitter\b|TwitterAndroid/i,
  /\bPinterest\b/i,
  /\bLinkedInApp\b/i,
  /\bBytedance\b|\bTikTok\b|musical_ly/i,
  /MicroMessenger/i,
  /\bOpera Mini\b|\bOPiOS\b.*Mini/i,
  /\bUCBrowser\b/i,
  /\bGSA\//, // Google app in-app browser (iOS)
  /; wv\)/, // Android System WebView
];

/** iOS WKWebView: iPhone/iPad + AppleWebKit without the "Safari/" token (and not a known browser). */
function isIosWebView(ua: string): boolean {
  if (!/(iPhone|iPod|iPad)/.test(ua)) return false;
  if (!/AppleWebKit/.test(ua)) return false;
  if (/Safari\//.test(ua)) return false;
  if (/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Brave/.test(ua)) return false;
  return true;
}

export function isInAppBrowserUA(ua: string | null | undefined): boolean {
  const s = String(ua || "");
  if (!s) return false;
  if (IN_APP_PATTERNS.some((re) => re.test(s))) return true;
  return isIosWebView(s);
}

/** Browser-side check. Always false during SSR. */
export function isInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return isInAppBrowserUA(navigator.userAgent);
}
