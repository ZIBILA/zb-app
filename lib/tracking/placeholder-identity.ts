/**
 * Synthetic placeholder emails created by the order/customer code when a real
 * email is missing. They are not customer identities and must never be hashed
 * and sent to ad platforms as em (they collide across thousands of customers).
 *
 * Explicit patterns only — a real person can have a legitimate @zicabella.com
 * address, so the domain itself is NOT blocked.
 *
 * Sources (keep in sync when adding a new fallback email):
 *   guest@zicabella.com       app/api/app/orders/route.ts, app/api/app/orders/create/route.ts,
 *                             app/api/app/payment/create-order/route.ts
 *   customer@zicabella.com    app/api/app/payment/process/route.ts (Razorpay request only)
 *   guest_<ts>@zicabella.com  lib/services/customerService.ts
 *   guest_<ts>@zicabella.in   app/api/pay/[cartId]/route.ts
 *   recovered_<ts>@zicabella.com  lib/services/razorpayRecoveryService.ts
 *   unresolved@zicabella.com  lib/services/razorpayRecoveryService.ts (WebStoreOrder)
 *
 * Also: placeholder names ('Customer', 'Valued Customer', 'Guest User' …) and dummy
 * phone numbers (see below).
 *
 * Isomorphic (browser + server), no crypto import.
 */

const PLACEHOLDER_EMAIL_RE =
  /^(?:(?:guest|customer|unresolved|demo)@zicabella\.(?:com|in)|(?:guest|recovered)_\d+@zicabella\.(?:com|in)|demo@example\.com)$/;

/** True for a raw (unhashed) synthetic placeholder email. */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return PLACEHOLDER_EMAIL_RE.test(email.trim().toLowerCase());
}

/**
 * SHA-256 of the fixed placeholders above (timestamped ones cannot be listed),
 * for values that arrive already hashed from the zb_guest_email cookie.
 */
export const PLACEHOLDER_EMAIL_HASHES: readonly string[] = [
  '8b4e6c3672085cb08bd46f0e1f1682454467bead491ea70e97095f3aee147ebc', // guest@zicabella.com
  'd934c0111fd4890bccb72ed3db382fb4343bed9118bd6a476462d20d7c95c3f2', // customer@zicabella.com
  '0ff0f5da52e3d6cd0bc54eb9859ef06eac5d3451bb5889f71f002d802ee59b61', // guest@zicabella.in
  '8f06fa63024521a199f7d194d5e78816d5c58ffae40265fe4594fcc3b9cc6955', // customer@zicabella.in
  'fb2612a3ef880f50bd71ea8b7585921ac98a11598a43a93ba934a93d16712b24', // unresolved@zicabella.com
  // demo login accounts
  '0816700ca2bdcad72bb405f3f9d7e0e0a7636d4e415453c655547657abd6af00', // demo@zicabella.com
  '5502e7885c76776c4e973374f9d1c6b40932bc9cfe57e578fae390ee637b583e', // demo@zicabella.in
  '7462108984f629db2ced1aeb2dc3e747e53a2e1c607059f72955ab864c724335', // demo@example.com
];

export function isPlaceholderEmailHash(hash: string | null | undefined): boolean {
  if (!hash) return false;
  return PLACEHOLDER_EMAIL_HASHES.includes(hash.trim().toLowerCase());
}

// ── Placeholder names and phones ────────────────────────────────────────────
// Fallback names written by the order/customer code when the shopper gave none
// ('Customer', 'Valued Customer', 'Guest User', …) and dummy phone numbers. As
// fn/ln/ph they are the same value for thousands of different people, which
// teaches the ad platforms wrong matches. Never sent.

/**
 * Normalized (letters/digits only, lower-case) values that are never a real name
 * part on their own. Deliberately narrow: 'Guest', 'Na', 'User', 'Test', 'Valued'
 * can be real first or last names ("Christopher Guest", "Na Yeon Kim"), so they
 * are only treated as placeholders as part of a whole placeholder name below.
 */
const PLACEHOLDER_NAME_PARTS = new Set([
  'customer', 'valued', 'valuedcustomer', 'guestuser', 'testuser', 'demouser', 'unknown',
  'null', 'undefined', 'zicabella', 'zicabellacustomer',
]);
/** Words that make a WHOLE name a placeholder when every word is one of them ("Valued Customer", "Guest User", "Guest"). */
const PLACEHOLDER_WHOLE_NAME_WORDS = new Set([
  ...PLACEHOLDER_NAME_PARTS, 'guest', 'user', 'test', 'demo', 'na', 'none',
]);

const nameKey = (v: string) => v.trim().toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Whole name ("Valued Customer", "Guest User", "Customer"): true when it is an
 * unambiguous placeholder, or 2+ words that are all placeholder words.
 */
export function isPlaceholderName(name: string | null | undefined): boolean {
  if (!name || !name.trim()) return false;
  if (PLACEHOLDER_NAME_PARTS.has(nameKey(name))) return true;
  const words = name.trim().split(/\s+/).map(nameKey).filter(Boolean);
  // A single word is judged by the narrow list only ("Guest" / "Na" may be a real
  // first or last name); two or more words that are all placeholder words are not.
  return words.length >= 2 && words.every(w => PLACEHOLDER_WHOLE_NAME_WORDS.has(w));
}

/** Single first / last name value (fn / ln): only unambiguous placeholders. */
export function isPlaceholderNamePart(part: string | null | undefined): boolean {
  if (!part || !part.trim()) return false;
  return PLACEHOLDER_NAME_PARTS.has(nameKey(part));
}

/** SHA-256 of the unambiguous placeholder name parts (for already-hashed fn/ln cookies). */
export const PLACEHOLDER_NAME_HASHES: readonly string[] = [
  "614b732cdd729bdbb84c3112f2934e2930e084c3b95a5dca5e96225a3628fcf1", // valued
  "b6c45863875e34487ca3c155ed145efe12a74581e27befec5aa661b8ee8ca6dd", // customer
  "8dae20436d9dbd1b0f12170b526cedd6dbf1b8dcf62c5aa076f642fcb2153151", // valuedcustomer
  "b1e71212ad6d76a848d147361e248f3759458137c8ce9c0f7125d7d303fa9dc1", // guestuser
  "ae5deb822e0d71992900471a7199d0d95b8e7c9d05c40a8245a281fd2c1d6684", // testuser
  "46c3f68d7c2da6db9268509d24b79e21c4ba6b7f1420017b6d031d5b22e6a3d3", // demouser
  "b23a6a8439c0dde5515893e7c90c1e3233b8616e634470f20dc4928bcf3609bc", // unknown
  "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b", // null
  "eb045d78d273107348b0300c01d29b7552d622abbc6faf81b3ec55359aa9950c", // undefined
  "604ea50b493a791e40d14e5f4a61ceb2e0c1fd155f250f1ee452ea8921ae8aff", // zicabella
  "d7853f94164fafb399d8ae69efc4739c544485881e8f339aa5506535f7d51a01", // zicabellacustomer
];

export function isPlaceholderNameHash(hash: string | null | undefined): boolean {
  if (!hash) return false;
  return PLACEHOLDER_NAME_HASHES.includes(hash.trim().toLowerCase());
}

/**
 * True for a dummy phone number: fewer than 7 digits, one digit repeated
 * (0000000000, 9999999999) or a keyboard sequence (1234567890, 9876543210),
 * with or without a country code in front.
 */
export function isPlaceholderPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return false;
  if (digits.length < 7) return true;
  const tail = digits.slice(-10);
  if (/^(\d)\1+$/.test(tail)) return true;
  return ['1234567890', '0123456789', '9876543210', '0987654321'].includes(tail);
}

/** SHA-256 of dummy Indian numbers as stored in the hashed zb_guest_phone cookie (91 + 10 digits). */
export const PLACEHOLDER_PHONE_HASHES: readonly string[] = [
  "041303ecbd115d1bc59ac7b555d82a8379ec768fa708abe5591fcc31507998c3", // 910000000000
  "86c450deed295c37f5e5c976eaedc8b97286c57fe955687dcb7603b29cdcb3a7", // 911111111111
  "7fe05bdfda5bfc7c7737cedfbbd71ab00cc221b65beeb9ad9c745d3be7113fe6", // 912222222222
  "7f69f03b2f3137e612022f67e1158e16e7ca7eca41f276a34ea44777178573df", // 913333333333
  "cb70e9e73e77ddc437dc40c3ff49b8f8b8e9332cdb584cfd025ab52fd2f47a7c", // 914444444444
  "3a21d07369a0e0dd49ae6a934c4bcd6b555fcde9e5cd6a2a91b7c40505f5eead", // 915555555555
  "4dccc1c4efed55f7a1610fbd2e2fe89e355f12a0c25ca56366c771bae2b24e54", // 916666666666
  "084d9d85b1bdccc91bb6867ad3e98787c82aad5427390f52a419a3ae63c20e55", // 917777777777
  "632817b96a9d64b3b6ad3b99980fd947da2f25b23b7297b3b9d220a0fc15e9b6", // 918888888888
  "5a15bf8887c41bb21f3b33a5bf1a06064711a6495cbbd97ddb92995d5df8b1b5", // 919999999999
  "aaf122ac0e10c72092c1d364b5897fd3d87aa19c585cf0c0480eb9fe79b3abfa", // 911234567890
  "9dd515fe4124ad44d2f3e28500f60f8a56f1150f29a22ceaa78afbe70d5d0b2a", // 910123456789
  "92b5072176e723878b5e06ff3ca61898e4eb74e8c46642a0f2db800b17364ab0", // 919876543210
  "c259e2f9c714a2c7df055b6a92264dd7dcf14ae9e9d70b1473e5cbac2103fc94", // 910987654321
  "0c51170fac80743b5bf3a7065765199214c23429e0c1b17ab3e41d2e1ced2a59", // 91123456789 (0123456789 / 0987654321 as normalized on main)
  "3547dadc46a26e0400ab6e49956c62aca1cca5a2a9837869418c7690ce7295b0", // 91987654321 (0123456789 / 0987654321 as normalized on main)
];

export function isPlaceholderPhoneHash(hash: string | null | undefined): boolean {
  if (!hash) return false;
  return PLACEHOLDER_PHONE_HASHES.includes(hash.trim().toLowerCase());
}

/** SHA-256 of placeholder postcodes an old zb_guest_zp cookie may hold. */
export const PLACEHOLDER_ZIP_HASHES: readonly string[] = [
  "e7042ac7d09c7bc41c8cfa5749e41858f6980643bc0db1a83cc793d3e24d3f77", // 00000
  "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9", // 0
  "91b4d142823f7d20c5f08df69122de43f35f057a988d9619f6d3138485c9a203", // 000000
  "9af15b336e6a9619928537df30b2e6a2376569fcf9d7e773eccede65606529a0", // 0000
  "3d9fc4bde7ceef058d65b00186e79c1f14b42687b491644c303065135b644e18", // na
  "140bedbf9c3f6d56a9846d2ba7088798683f4da0c248231336e6a05679e4fdfe", // none
];

export function isPlaceholderZipHash(hash: string | null | undefined): boolean {
  if (!hash) return false;
  return PLACEHOLDER_ZIP_HASHES.includes(hash.trim().toLowerCase());
}

/** First candidate that is a real (non-placeholder) email. */
export function pickRealEmail(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() && c.includes('@') && !isPlaceholderEmail(c)) return c.trim();
  }
  return undefined;
}

/** First candidate that is a real (non-placeholder) full name. */
export function pickRealName(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() && !isPlaceholderName(c)) return c.trim();
  }
  return undefined;
}

/** First candidate that is a real (non-dummy) phone number. */
export function pickRealPhone(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() && !isPlaceholderPhone(c)) return c.trim();
  }
  return undefined;
}
