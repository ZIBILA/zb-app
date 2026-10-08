/** Test-only stand-in for '@/lib/appAuth'. */
export type AppAuthTokenPayload = { customerId?: string; customerEmail?: string; type?: string };
export async function requireAppAuth(_req: Request) { return { auth: { customerId: 'cust_app_1', customerEmail: 'aarav@example.com' } as AppAuthTokenPayload }; }
export function handleAppAuthError(e: any) { throw e; }
