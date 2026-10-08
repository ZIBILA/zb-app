/** Test-only stand-in for '@/lib/razorpay-credentials'. */
export async function resolveRazorpayCredentials() { return { key_id: 'rzp_test_x', key_secret: 'secret', source: 'environment' as const }; }
