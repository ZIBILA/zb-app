/** Test-only mocks (next/navigation, next-auth) for the Snap end-to-end suites. */
export const state: {
  params: Record<string, string>;
  status: 'loading' | 'authenticated' | 'unauthenticated';
  session: any;
  replaced: string[];
} = { params: { id: '' }, status: 'unauthenticated', session: null, replaced: [] };

export function useParams() { return state.params; }
export function usePathname() { return `/orders/${state.params.id}/confirmation`; }
// Stable object, like Next's own router (a new object per render would re-run every effect that depends on it).
const router = { push() {}, replace(url: string) { state.replaced.push(url); }, refresh() {}, prefetch() {}, back() {} };
export function useRouter() { return router; }
export function useSearchParams() { return new URLSearchParams(''); }
export function useSession() { return { data: state.session, status: state.status }; }
export async function getServerSession() { return state.session; }
export const authOptions = {};
export default {};
