/**
 * Centralized navigation types to break circular dependencies.
 * All screen components should import types from here rather than from navigators.
 */

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPasswordFlow: undefined;
  PrivacyAndTerms: { type: 'privacy' | 'terms' };
};

export type TabParamList = {
  HomeTab: undefined;
  SearchTab: undefined;
  ChatTab: undefined;
  ProfileTab: undefined;
  ShopTab: undefined;
  OrdersTab: undefined;
};

export type CheckoutStackParamList = {
  DeliveryAddress: undefined;
  OrderReview: undefined;
  RazorpayPayment: {
    amount: number;
    orderId: string;
    razorpayKeyId: string;
    prefill: { name: string; email: string; contact: string };
    orderData: any;
  };
};

export type ServiceStackParamList = {
  ServiceHistory: undefined;
  ReturnWizard: { orderId: string; initialItems?: string[] };
  ExchangeWizard: { orderId: string; initialItems?: string[] };
  ServiceDetail: { type: 'RETURN' | 'EXCHANGE'; id: string };
};

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  ProductDetail: { handle: string };
  Collection: { handle: string; title?: string };
  CheckoutFlow: undefined;
  ServiceFlow: undefined;
  OrderConfirmation: { orderId: string; orderNumber?: string; paymentMethod?: 'COD' | 'PREPAID' | 'Store Credit'; estimatedDelivery?: string | null };
  OrderHistory: { openReturnFor?: string } | undefined;
  OrderDetails: { orderId: string };
  Policy: { handle?: string; url?: string; title?: string };
  Community: undefined;
  Story: undefined;
  FAQ: undefined;
  Blogs: undefined;
  Collaborations: undefined;
  Creator: undefined;
  Addresses: undefined;
  Wishlist: undefined;
  StoreCreditHistory: undefined;
  Legal: { tab: 'privacy' | 'terms' };
  About: undefined;
  Support: undefined;
  SupportDetail: { ticketId: string; subject: string };
  Returns: undefined;
};
