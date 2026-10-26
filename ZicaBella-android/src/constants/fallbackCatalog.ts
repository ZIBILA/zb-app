import { FlatCollection, FlatProduct } from '../api/types';

// Production safety: no mock or fallback products.
// If products exist in Shopify, they are loaded live; otherwise collections remain empty.
export const fallbackProducts: FlatProduct[] = [];
export const fallbackCollections: FlatCollection[] = [];
