/**
 * Browser-side guards shared by the Meta and Snap pixels and their relays.
 *
 *  - isInternalBrowser(): the zb_internal=1 cookie marks a staff / QA / demo
 *    browser. It is set by /api/meta/event when a signed-in customer is on the
 *    internal lists (META_INTERNAL_* / demo accounts) and by `?zb_internal=1`
 *    in a URL (for staff devices). Nothing is sent to Meta or Snap from it.
 *  - isAppWebView(): a page opened by the native app's WebView (?zb_app=1 → zb_app cookie).
 *  - isAutomatedBrowser(): a WebDriver-controlled browser on the live site
 *    (crawlers, QA automation, Lighthouse) — not a shopper.
 *
 * Both return false on localhost / preview hosts so local checks keep working.
 */
export function isInternalBrowser(): boolean {
  if (typeof document === 'undefined') return false;
  return /(?:^|;\s*)zb_internal=1(?:;|$)/.test(document.cookie);
}

/**
 * A storefront page opened inside the native app's WebView (`?zb_app=1` sets the
 * session cookie zb_app=1): not a website visit, so neither pixel nor relay fires;
 * the app reports its own events through the app pipeline.
 */
export function isAppWebView(): boolean {
  if (typeof document === 'undefined') return false;
  return /(?:^|;\s*)zb_app=1(?:;|$)/.test(document.cookie);
}

export function isAutomatedBrowser(): boolean {
  if (typeof navigator === 'undefined' || typeof location === 'undefined') return false;
  return navigator.webdriver === true && /(^|\.)zicabella\.com$/i.test(location.hostname);
}

export function isExcludedBrowser(): boolean {
  return isInternalBrowser() || isAppWebView() || isAutomatedBrowser();
}
