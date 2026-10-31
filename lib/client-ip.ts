/**
 * The shopper's IP as seen through the proxies in front of the app.
 *
 * zicabella.com is served through Cloudflare (`server: cloudflare` on the live
 * site), which sits in front of the DigitalOcean origin. In that chain the
 * DigitalOcean header (`do-connecting-ip`) names the Cloudflare edge that opened
 * the connection, NOT the shopper, so it was wrong for Conversions API
 * `client_ip_address`, IP-geo country fallbacks and per-IP rate limits (all
 * visitors behind one Cloudflare POP shared one bucket). Cloudflare always
 * overwrites `cf-connecting-ip` with the real client address, so it wins when
 * present; the hosting proxy's header is next, then the standard forwarding
 * headers (first hop), which only matter when no proxy header exists.
 *
 * Keep the origin reachable only through Cloudflare (DigitalOcean firewall /
 * Cloudflare IP allow-list): a request that reaches the origin directly can set
 * any of these headers itself.
 *
 * Pure and edge-safe (used by middleware): no Node imports.
 */
export type HeaderReader = { get(name: string): string | null | undefined };

export function clientIpFromHeaders(headers: HeaderReader): string | undefined {
  const first = (v: string | null | undefined) => (v || '').split(',')[0].trim();
  const cf = first(headers.get('cf-connecting-ip'));
  if (cf) return cf;
  const doIp = first(headers.get('do-connecting-ip'));
  if (doIp) return doIp;
  const fwd = first(headers.get('x-forwarded-for') || headers.get('x-vercel-forwarded-for'));
  if (fwd) return fwd;
  const real = first(
    headers.get('x-real-ip') || headers.get('x-client-ip') || headers.get('x-cluster-client-ip') || headers.get('fastly-client-ip'),
  );
  return real || undefined;
}
