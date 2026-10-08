export const WALLET_APPS: any[] = [];
export const isRazorpayAvailable = () => true;
export const getRazorpayLoadError = () => null;
export const razorpayInit = async () => {};
export const razorpayGetAppsWhichSupportUPI = () => {};
export const razorpayOpen = async (opts: any) => ({ razorpay_payment_id: 'pay_HOOK1', razorpay_order_id: opts.order_id, razorpay_signature: 'sig' });
export type UPIApp = any;
