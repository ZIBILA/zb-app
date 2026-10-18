import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlatProduct } from '../api/types';

interface RecentState {
  recentProducts: FlatProduct[];
  addProduct: (product: FlatProduct) => void;
  clearRecent: () => void;
}

export const useRecentStore = create<RecentState>()(
  persist(
    (set) => ({
      recentProducts: [],
      addProduct: (product: FlatProduct) => set((state) => {
        const filtered = state.recentProducts.filter((p) => p.id !== product.id);
        const newRecent = [product, ...filtered].slice(0, 10);
        return { recentProducts: newRecent };
      }),
      clearRecent: () => set({ recentProducts: [] }),
    }),
    {
      name: 'recent-products-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
