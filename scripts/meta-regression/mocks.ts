/** Test-only mocks for Meta regression runs (next/navigation, next-auth). */
export const state: { pathname: string; status: 'loading' | 'authenticated' | 'unauthenticated'; session: any } =
  { pathname: '/', status: 'unauthenticated', session: null };
export function usePathname() { return state.pathname; }
export function useRouter() { return { push() {}, replace() {}, refresh() {} }; }
export function useSearchParams() { return new URLSearchParams(''); }
export function useSession() { return { data: state.session, status: state.status }; }
export async function getServerSession() { return state.session; }
export const authOptions = {};
export default {};
