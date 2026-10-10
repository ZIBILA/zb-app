export const getPaymentApiBaseUrl = () => 'https://zicabella.com';
export const useAuthStore = { getState: () => ({ token: 't' }) };
export const checkOrderStatus = async () => ({ status: 'attempted' });
export const getSnapDeviceContext = async () => ({ platform: 'ios' });
