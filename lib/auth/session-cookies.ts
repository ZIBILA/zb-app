/**
 * NextAuth cookies are host-only: no `domain` attribute, ever.
 *
 * The dashboard is served on app.zicabella.com and the storefront on zicabella.com
 * (lib/tracking/host.ts). With host-only cookies the admin session lives on the app
 * host and a shopper's session on zicabella.com, independently — an admin signing in
 * to the dashboard never replaces the customer session (and so the ad-event identity)
 * in the same browser. A `domain=zicabella.com` cookie would be sent to both hosts.
 *
 * Names and attributes are NextAuth v4's own defaults for a secure deployment (the
 * `__Host-` csrf prefix is itself rejected by browsers if a Domain is ever added), so
 * existing sessions keep working; they are spelled out here so the rule is visible and
 * checked (scripts/verify-dashboard-host.ts).
 */
export interface AuthCookie {
  name: string;
  options: { httpOnly: boolean; sameSite: 'lax'; path: string; secure: boolean };
}

export function authCookies(nodeEnv: string | undefined = process.env.NODE_ENV): {
  sessionToken: AuthCookie;
  callbackUrl: AuthCookie;
  csrfToken: AuthCookie;
} {
  const secure = nodeEnv === 'production';
  const prefix = secure ? '__Secure-' : '';
  const options = () => ({ httpOnly: true, sameSite: 'lax' as const, path: '/', secure });
  return {
    sessionToken: { name: `${prefix}next-auth.session-token`, options: options() },
    callbackUrl: { name: `${prefix}next-auth.callback-url`, options: options() },
    csrfToken: { name: `${secure ? '__Host-' : ''}next-auth.csrf-token`, options: options() },
  };
}
