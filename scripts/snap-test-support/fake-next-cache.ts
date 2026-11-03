/** Test-only stand-in for 'next/cache' (revalidatePath needs a running Next server). */
export const revalidated: string[] = [];
export function revalidatePath(path: string) { revalidated.push(path); }
export function revalidateTag() {}
export function unstable_cache<T extends (...a: any[]) => any>(fn: T) { return fn; }
