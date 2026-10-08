// Minimal single-render React stand-in for driving a hook's async callbacks in Node.
export const calls: { status: string[]; successData: any[]; error: any[] } = { status: [], successData: [], error: [] };
let stateIdx = 0;
const names = ['status', 'error', 'successData'];
export function useState<T>(init: T): [T, (v: T) => void] {
  const name = names[stateIdx++] || `s${stateIdx}`;
  return [init, (v: T) => { (calls as any)[name]?.push(v); }];
}
export const useRef = <T,>(v: T) => ({ current: v });
export const useCallback = <F,>(fn: F) => fn;
export const useEffect = () => {};
export function resetHookState() { stateIdx = 0; calls.status.length = 0; calls.successData.length = 0; calls.error.length = 0; }
export default { useState, useRef, useCallback, useEffect };
