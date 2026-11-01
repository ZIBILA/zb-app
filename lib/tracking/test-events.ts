/**
 * Tester mode for Events Manager "Test Events" on the live site.
 *
 * Open any storefront URL with `?zb_test_events=TEST91711` (the test event code shown in
 * Meta Events Manager → Test Events) and that browser keeps the code in the `zb_test_events`
 * cookie for a day. While it is set, in that browser only:
 *   - the staff / QA exclusion (zb_internal, set for accounts on the META_INTERNAL_* lists and
 *     the demo accounts) is ignored, so the owner can test with their own account — without
 *     this, a staff browser sends nothing at all, browser or server;
 *   - every Meta server copy (the relay, and the Purchase of an order placed from that browser)
 *     carries `test_event_code`, so the browser and server halves of each event appear together
 *     in Test Events and none of them count as real conversions;
 *   - Snap is unchanged apart from the exclusion (Snap has no test code; its Test Events tab
 *     shows pixel and Conversions API events as they arrive).
 * `?zb_test_events=off` clears it. Real shoppers never have the cookie.
 *
 * Isomorphic, nothing secret.
 */
export const TEST_EVENTS_COOKIE = 'zb_test_events';

/** Meta test event codes look like TEST12345 (Events Manager generates them). */
export const TEST_EVENT_CODE_RE = /^TEST[A-Z0-9]{3,20}$/;

/** The code when `raw` is a well-formed test event code, else undefined. */
export function parseTestEventCode(raw: unknown): string | undefined {
  const v = String(raw ?? '').trim().toUpperCase();
  return TEST_EVENT_CODE_RE.test(v) ? v : undefined;
}

/** Browser only: the test event code stored in this browser, if any. */
export function browserTestEventCode(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + TEST_EVENTS_COOKIE + '=([^;]*)'));
  if (!m) return undefined;
  let v = m[1];
  try { v = decodeURIComponent(v); } catch { /* keep raw */ }
  return parseTestEventCode(v);
}
