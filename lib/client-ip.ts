/** Shared with Edge middleware. Never substitute a cookie or server IP for a visitor. */
export function publicClientIp(value: string | null | undefined): string | undefined {
  const ip = value?.trim().toLowerCase().replace(/^::ffff:/, '');
  if (!ip) return undefined;
  if (ip.includes(':')) {
    try { new URL(`https://[${ip}]/`); } catch { return undefined; }
    // Global unicast only; exclude documentation, local, multicast and mapped addresses.
    if (!/^[23]/.test(ip) || /^2001:db8:/.test(ip) || ip.includes('.')) return undefined;
    return ip;
  }
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return undefined;
  const [a, b, c] = parts.map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 192 && b === 2) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)) return undefined;
  return parts.map(Number).join('.');
}

export function requestClientIp(request: Request): string | undefined {
  // The ingress must overwrite these headers and prevent direct access to the origin.
  const configured = process.env.TRUSTED_CLIENT_IP_HEADER;
  const headers = configured ? [configured] : ['do-connecting-ip', 'cf-connecting-ip', 'x-vercel-forwarded-for', 'x-forwarded-for', 'x-real-ip'];
  for (const name of headers) {
    const value = publicClientIp(request.headers.get(name)?.split(',')[0]);
    if (value) return value;
  }
  return undefined;
}
