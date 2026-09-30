import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from '../constants/config';

export interface CartItem {
  id: string;
  productId: string;
  handle: string;
  variantId: string;
  title: string;
  size: string | null;
  price: string;
  image: string;
  quantity: number;
}

interface CartStore {
  items: CartItem[];
  buyNowItem: CartItem | null;
  cartId: string | null;
  shippingAddress: any | null;

  addItem: (item: Omit<CartItem, 'id' | 'quantity'>) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  setBuyNowItem: (item: CartItem | null) => void;
  setShippingAddress: (address: any) => void;
  syncWithBackend: () => Promise<void>;

  // Computed (via get())
  total: () => number;
  itemCount: () => number;
}

// Helper to sync cart with backend
const syncCart = async (items: CartItem[]) => {
  try {
    // Avoid importing useAuthStore at top level to prevent circular dependencies
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useAuthStore } = require('./authStore');
    const state = useAuthStore.getState();
    const token = state.token;
    
    const user = state.user;
    
    // Identify by userId if authenticated, else by deviceId for guest carts
    const { Platform } = require('react-native');
    const Constants = require('expo-constants').default;
    const deviceId = Constants.sessionId || `dev_${Platform.OS}_${Date.now()}`;
    const guestId = `guest_${Platform.OS}_${deviceId}`;

    console.log(`[Cart Sync] Transmitting ${items.length} units to cloud (ID: ${guestId})...`);

    const response = await fetch(`${config.appUrl}/api/cart/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({ 
        items, 
        guestId,
        name: user?.name,
        email: user?.email,
        phone: user?.phone
      })
    });

    const resData = await response.json().catch(() => ({}));
    if (response.ok) {
      console.log(`[Cart Sync] Success: ${resData.count || 0} items at ${new Date().toLocaleTimeString()}`);
    } else {
      console.warn(`[Cart Sync] Server Rejected (${response.status}):`, resData.error || 'Unknown Error');
      if (resData.details) console.warn(`[Cart Sync] Reason: ${resData.details}`);
    }
  } catch (error) {
    console.error('[Cart Sync] Critical network failure:', error);
  }
};

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      buyNowItem: null,
      cartId: null,
      shippingAddress: null,

      addItem: (item) => {
        const id = `${item.productId}_${item.variantId}_${item.size || 'one-size'}`;
        set((state) => {
          const existing = state.items.find((i) => i.id === id);
          let newItems;
          if (existing) {
            newItems = state.items.map((i) =>
              i.id === id ? { ...i, quantity: i.quantity + 1 } : i
            );
          } else {
            newItems = [...state.items, { ...item, id, quantity: 1 }];
          }
          
          // Trigger sync
          syncCart(newItems);
          
          return { items: newItems };
        });
      },

      removeItem: (id) => {
        set((state) => {
          const newItems = state.items.filter((i) => i.id !== id);
          syncCart(newItems);
          return { items: newItems };
        });
      },

      updateQuantity: (id, quantity) => {
        set((state) => {
          const newItems = quantity === 0
            ? state.items.filter((i) => i.id !== id)
            : state.items.map((i) => (i.id === id ? { ...i, quantity } : i));
          
          syncCart(newItems);
          return { items: newItems };
        });
      },

      clearCart: () => {
        set({ items: [], buyNowItem: null, cartId: null });
        syncCart([]);
      },

      setBuyNowItem: (item) => set({ buyNowItem: item }),

      setShippingAddress: (address) => set({ shippingAddress: address }),

      syncWithBackend: async () => {
        await syncCart(get().items);
      },

      total: () =>
        get().items.reduce((sum, i) => sum + parseFloat(i.price) * i.quantity, 0),

      itemCount: () =>
        get().items.reduce((sum, i) => sum + i.quantity, 0),
    }),
    {
      name: 'zicabella-cart',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
