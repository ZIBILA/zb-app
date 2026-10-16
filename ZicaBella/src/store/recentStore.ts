import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlatProduct } from '../api/types';

function hasUsableImage(product: FlatProduct): boolean {
  const feat = product?.featuredImage;
  if (typeof feat === 'string' && feat.trim()) return true;
  if (feat && typeof feat === 'object' && ((feat as any).url || (feat as any).src)) return true;
  if (Array.isArray(product?.images) && product.images.some((img) => {
    if (typeof img === 'string') return Boolean(img.trim());
    return Boolean((img as any)?.url || (img as any)?.src);
  })) return true;
  return false;
}

/** Persist only cards that can render in Recently Viewed. */
function toRecentSnapshot(product: FlatProduct): FlatProduct | null {
  if (!product?.id || !product?.handle) return null;
  if (!String(product.title || '').trim()) return null;
  if (!hasUsableImage(product)) return null;

  const featuredImage =
    typeof product.featuredImage === 'string'
      ? product.featuredImage
      : (product.featuredImage as any)?.url
        || (Array.isArray(product.images) ? (typeof product.images[0] === 'string' ? product.images[0] : (product.images[0] as any)?.url) : '')
        || '';

  if (!featuredImage) return null;

  return {
    ...product,
    title: String(product.title).trim(),
    featuredImage,
    images: Array.isArray(product.images) && product.images.length > 0
      ? product.images
      : [featuredImage],
  };
}

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
        const snapshot = toRecentSnapshot(product);
        if (!snapshot) return state;
        const filtered = state.recentProducts.filter((p) => p.id !== snapshot.id);
        const newRecent = [snapshot, ...filtered].slice(0, 10);
        return { recentProducts: newRecent };
      }),
      clearRecent: () => set({ recentProducts: [] }),
    }),
    {
      name: 'recent-products-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // Drop corrupted legacy entries (empty image/title) on rehydrate
      merge: (persisted: any, current) => {
        const raw = Array.isArray(persisted?.recentProducts) ? persisted.recentProducts : [];
        const cleaned = raw
          .map((p: FlatProduct) => toRecentSnapshot(p))
          .filter(Boolean) as FlatProduct[];
        return { ...current, ...persisted, recentProducts: cleaned };
      },
    }
  )
);
