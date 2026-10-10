/** Test-only stand-in for '@/lib/appAuth'. */
export type AppAuthTokenPayload = { customerId?: string; customerEmail?: string; type?: string };
const AUTH: AppAuthTokenPayload = { customerId: 'cust_app_1', customerEmail: 'aarav@example.com' };
export async function requireAppAuth(_req: Request) { return { auth: AUTH }; }
export function getAppAuthFromRequest(_req: Request) { return AUTH; }
export function handleAppAuthError(e: any) { throw e; }
