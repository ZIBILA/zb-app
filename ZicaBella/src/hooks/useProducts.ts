import { useState, useCallback, useEffect, useRef } from 'react';
import { apiGet } from '../api/shopify';
import { ENDPOINTS } from '../api/queries';
import {
  FlatProduct,
  FlatCollection,
  flattenCollection,
  flattenProduct,
  Collection,
  Product,
} from '../api/types';
import { fallbackCollections, fallbackProducts } from '../constants/fallbackCatalog';
import { getCacheService } from '../services/cacheService';

const LIST_FIELDS = 'id,title,handle,priceRange,featuredImage';
const FULL_FIELDS = 'id,title,handle,description,descriptionHtml,availableForSale,featuredImage,images,priceRange,variants,media,details,care,sizeChart,productVideo';

// Manual cache functions replaced by cacheService
const apiCache = new Map<string, { data: any; timestamp: number }>();

async function cachedFetch<T>(key: string, fetchFn: () => Promise<T>, ttl = 300000): Promise<T> {
  const cached = apiCache.get(key);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data;
  }
  const data = await fetchFn();
  apiCache.set(key, { data, timestamp: Date.now() });
  return data;
}

function isShopifyProduct(product: any): product is Product {
  return Boolean(product?.variants?.edges && product?.images?.edges);
}

function isShopifyCollection(collection: any): collection is Collection {
  return Boolean(collection?.handle && (collection?.image?.url !== undefined || collection?.products?.edges));
}

function normalizeProduct(product: any): FlatProduct | null {
  if (!product) {
    return null;
  }

  if (isShopifyProduct(product)) {
    return flattenProduct(product);
  }

  if (product?.node) {
    return normalizeProduct(product.node);
  }

  const variants = Array.isArray(product.variants)
    ? product.variants.map((variant: any) => ({
        id: variant?.id || '',
        title: variant?.title || '',
        availableForSale: Boolean(variant?.availableForSale ?? true),
        quantityAvailable: variant?.quantityAvailable ?? null,
        price: String(variant?.price?.amount || variant?.price || '0'),
        compareAtPrice: variant?.compareAtPrice?.amount || variant?.compareAtPrice || null,
          size:
            variant?.size ||
            variant?.selectedOptions?.find((option: any) => String(option?.name || '').toLowerCase() === 'size')?.value ||
            null,
          color:
            variant?.color ||
            variant?.selectedOptions?.find((option: any) => {
              const name = String(option?.name || '').toLowerCase();
              return name === 'color' || name === 'colour';
            })?.value ||
            null,
        }))
    : [];

  const rawImages = Array.isArray(product.images) ? product.images : [];
  const normalizedImages = rawImages
    .map((image: any) => (typeof image === 'string' ? image : image?.url || image?.src || image?.image?.url))
    .filter(Boolean);

  const normalizedMedia = Array.isArray(product.allMedia)
    ? product.allMedia
    : normalizedImages.map((url: string) => ({
        mediaContentType: 'IMAGE' as const,
        image: { url, altText: null },
        alt: null,
      }));

  const normalizedProductVideo =
    typeof product.productVideo === 'string'
      ? product.productVideo
      : (product.productVideo as any)?.url || undefined;

  const hasVideoMedia = normalizedMedia.some(
    (media: any) =>
      media?.mediaContentType === 'VIDEO'
      || media?.mediaContentType === 'EXTERNAL_VIDEO'
  );
  if (normalizedProductVideo && !hasVideoMedia) {
    normalizedMedia.push({
      mediaContentType: 'VIDEO',
      alt: null,
      sources: [{ url: normalizedProductVideo, mimeType: 'video/mp4' }],
    } as any);
  }

  return {
    id: String(product.id || ''),
    title: String(product.title || ''),
    handle: String(product.handle || ''),
    productType: String(product.productType || ''),
    description: String(product.description || ''),
    descriptionHtml: product.descriptionHtml,
    availableForSale: Boolean(product.availableForSale ?? true),
    featuredImage:
      typeof product.featuredImage === 'string'
        ? product.featuredImage
        : product.featuredImage?.url || normalizedImages[0] || '',
    images: normalizedImages,
    price: String(product.price?.amount || product.price || variants[0]?.price || '0'),
    compareAtPrice:
      product.compareAtPrice?.amount || product.compareAtPrice || variants[0]?.compareAtPrice || null,
    variants,
    isSoldOut:
      typeof product.isSoldOut === 'boolean'
        ? product.isSoldOut
        : variants.length > 0
          ? !variants.some((variant: any) => variant.availableForSale)
          : !Boolean(product.availableForSale ?? true),
    isOnSale:
      typeof product.isOnSale === 'boolean'
        ? product.isOnSale
        : Boolean(product.compareAtPrice || variants[0]?.compareAtPrice),
    video: product.video,
    allMedia: normalizedMedia,
    details: product.details,
    care: product.care,
    sizeChart: product.sizeChart,
    productVideo: normalizedProductVideo,
  };
}

function normalizeCollection(collection: any): FlatCollection | null {
  if (!collection) {
    return null;
  }

  if (isShopifyCollection(collection)) {
    return flattenCollection(collection);
  }

  if (collection?.node) {
    return normalizeCollection(collection.node);
  }

  return {
    id: String(collection.id || ''),
    title: String(collection.title || ''),
    handle: String(collection.handle || ''),
    description: String(collection.description || ''),
    image:
      typeof collection.image === 'string'
        ? collection.image
        : collection.image?.url || null,
  };
}

function extractProducts(payload: any): FlatProduct[] {
  const candidates = payload?.products
    || payload?.data?.products
    || payload?.data?.items
    || payload?.items
    || payload;

  const rawProducts = Array.isArray(candidates)
    ? candidates
    : Array.isArray(candidates?.edges)
      ? candidates.edges
      : [];

  return rawProducts
    .map(normalizeProduct)
    .filter((product: FlatProduct | null): product is FlatProduct => Boolean(product?.id));
}

function extractProduct(payload: any): FlatProduct | null {
  return normalizeProduct(
    payload?.product
    || payload?.data?.product
    || payload?.data?.item
    || payload?.item
    || payload
  );
}

function extractCollections(payload: any): FlatCollection[] {
  const candidates = payload?.collections
    || payload?.data?.collections
    || payload?.items
    || payload;

  const rawCollections = Array.isArray(candidates)
    ? candidates
    : Array.isArray(candidates?.edges)
      ? candidates.edges
      : [];

  return rawCollections
    .map(normalizeCollection)
    .filter((collection: FlatCollection | null): collection is FlatCollection => Boolean(collection?.id));
}

export function useProducts(count = 24) {
  const [products, setProducts] = useState<FlatProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const fetchProducts = useCallback(async (isRefresh = false) => {
    const cacheKey = `products_list_${count}`;
    
    try {
      if (isMounted.current) {
        setIsError(false);
        setError(null);
      }

      if (!isRefresh) {
        const cached = await getCacheService().get<FlatProduct[]>(cacheKey);
        if (cached && cached.length > 0 && isMounted.current) {
          setProducts(cached.slice(0, count));
          setLoading(false);
        }
      }

      const data = await cachedFetch(cacheKey, () => apiGet<{ products: FlatProduct[] }>(
        ENDPOINTS.products,
        { 
          limit: String(Math.max(count, 50)),
          fields: LIST_FIELDS
        }
      ));

      if (!isMounted.current) return;

      const normalizedProducts = extractProducts(data);

      if (normalizedProducts.length > 0) {
        setProducts(normalizedProducts);
        await getCacheService().set(cacheKey, normalizedProducts, 5);
        return;
      }

      throw new Error('Empty product response');
    } catch (err: any) {
      if (!isMounted.current) return;
      
      setIsError(true);
      if (products.length === 0) {
        setProducts(fallbackProducts.slice(0, count));
        setError('Showing bundled products while the catalog reconnects.');
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [count, products.length]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  return { products, loading, error, isError, refetch: () => fetchProducts(true) };
}

export function useProductByHandle(handle: string) {
  const [product, setProduct] = useState<FlatProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasDataRef = useRef(false);

  useEffect(() => {
    if (!handle) return;
    // Reset state when handle changes
    hasDataRef.current = false;
    setProduct(null);
    setLoading(true);
    setError(null);

    let cancelled = false;

    (async () => {
      const cacheKey = `product_detail_${handle}`;
      try {
        // Try cache first for instant display
        const cached = await getCacheService().get<FlatProduct>(cacheKey);
        if (cached && !cancelled) {
          setProduct(cached);
          hasDataRef.current = true;
          setLoading(false);
        }

        const data = await cachedFetch(cacheKey, () => apiGet<{ product: FlatProduct | null }>(
          ENDPOINTS.productByHandle(handle),
          { fields: FULL_FIELDS }
        ));

        if (cancelled) return;

        const normalizedProduct = extractProduct(data);

        if (normalizedProduct) {
          setProduct(normalizedProduct);
          hasDataRef.current = true;
          await getCacheService().set(cacheKey, normalizedProduct, 10);
          return;
        }

        throw new Error('Product not found');
      } catch (err: any) {
        if (cancelled) return;
        if (!hasDataRef.current) {
          const fallbackProduct = fallbackProducts.find((item) => item.handle === handle) || null;
          setProduct(fallbackProduct);
          setError(err.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [handle]);

  return { product, loading, error };
}

/**
 * Score a product's relevancy to a search query (client-side).
 * Higher score = more relevant. 0 = no match.
 */
function relevancyScore(product: FlatProduct, lq: string): number {
  let score = 0;
  const title = (product.title || '').toLowerCase();
  const handle = (product.handle || '').toLowerCase();
  const type = (product.productType || '').toLowerCase();

  if (title === lq) score += 100;
  else if (title.startsWith(lq)) score += 80;
  else if (title.includes(lq)) score += 60;

  if (handle.includes(lq)) score += 30;

  if (type === lq) score += 40;
  else if (type.includes(lq)) score += 25;

  return score;
}

export function useSearchProducts() {
  const [results, setResults] = useState<FlatProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const search = useCallback(async (query: string) => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const normalizedQuery = query.trim().toLowerCase();
    const cacheKey = `search_${normalizedQuery}`;

    try {
      setLoading(true);
      
      const cached = await getCacheService().get<FlatProduct[]>(cacheKey);
      if (cached && isMounted.current) {
        setResults(cached);
        setLoading(false);
      }

      const data = await cachedFetch(cacheKey, () => apiGet<{ products: FlatProduct[] }>(
          ENDPOINTS.search,
          { 
            q: query, 
            limit: '48',
            fields: LIST_FIELDS 
          }
      ));

      if (!isMounted.current) return;

      const normalizedProducts = extractProducts(data);

      if (normalizedProducts.length > 0) {
        const sorted = [...normalizedProducts].sort(
          (a, b) => relevancyScore(b, normalizedQuery) - relevancyScore(a, normalizedQuery)
        );
        setResults(sorted);
        await getCacheService().set(cacheKey, sorted, 5);
        return;
      }

      throw new Error('Search unavailable');
    } catch (err) {
      if (!isMounted.current) return;
      const source = fallbackProducts;
      const filtered = source
        .filter((product) =>
          product.title.toLowerCase().includes(normalizedQuery)
          || product.handle.toLowerCase().includes(normalizedQuery)
          || product.productType.toLowerCase().includes(normalizedQuery)
        )
        .sort((a, b) => relevancyScore(b, normalizedQuery) - relevancyScore(a, normalizedQuery));

      setResults(filtered);
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, []);

  return { results, loading, search };
}

export function useCollections(count = 20, location?: 'header' | 'page' | 'menu') {
  const [collections, setCollections] = useState<FlatCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const fetchCollections = useCallback(async (isRefresh = false) => {
    const cacheKey = `collections_${count}_${location || 'default'}`;

    try {
      if (!isRefresh) {
        const cached = await getCacheService().get<FlatCollection[]>(cacheKey);
        if (cached && !isMounted.current) {
          setCollections(cached);
          setLoading(false);
        }
      }

      const params: any = { limit: String(count) };
      if (location) params.location = location;
      const data = await cachedFetch(cacheKey, () => apiGet<{ collections: FlatCollection[] }>(
        ENDPOINTS.collections,
        params
      ));

      if (!isMounted.current) return;

      const normalizedCollections = extractCollections(data);

      if (normalizedCollections.length > 0) {
        setCollections(normalizedCollections);
        await getCacheService().set(cacheKey, normalizedCollections, 10);
        return;
      }

      throw new Error('Empty collection response');
    } catch (err) {
      if (!isMounted.current) return;
      if (collections.length === 0) {
        setCollections(fallbackCollections);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [count, location, collections.length]);

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  return { collections, loading, refetch: () => fetchCollections(true) };
}

export function useCollectionByHandle(handle: string) {
  const [collection, setCollection] = useState<FlatCollection | null>(null);
  const [products, setProducts] = useState<FlatProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const fetchCollection = useCallback(async (isRefresh = false) => {
    const cacheKey = `collection_products_${handle}`;

    try {
      if (!isRefresh) {
        const cached = await getCacheService().get<{ collection: FlatCollection | null, products: FlatProduct[] }>(cacheKey);
        if (cached && isMounted.current) {
          setCollection(cached.collection);
          setProducts(cached.products);
          setLoading(false);
        }
      }
      
      // If handle is 'all', we fetch all products instead of a specific collection
      if (handle === 'all') {
        const data = await cachedFetch(`${cacheKey}_all`, () => apiGet<any>(ENDPOINTS.products, { limit: '80', fields: LIST_FIELDS }));
        
        if (!isMounted.current) return;

        const normalizedProducts = extractProducts(data);
        
        if (normalizedProducts.length > 0) {
          const allCollection = {
            id: 'all',
            title: 'All Products',
            handle: 'all',
            description: 'Explore the entire Zica Bella archive.',
            image: normalizedProducts[0]?.featuredImage || null
          };
          setCollection(allCollection);
          setProducts(normalizedProducts);
          await getCacheService().set(cacheKey, { collection: allCollection, products: normalizedProducts }, 5);
        }
        return;
      }

      const data = await cachedFetch(cacheKey, () => apiGet<any>(
        ENDPOINTS.collectionByHandle(handle),
        { limit: '50', fields: LIST_FIELDS }
      ));

      if (!isMounted.current) return;

      const normalizedCollection = normalizeCollection(data?.collection || data?.data?.collection || data) || null;
      const normalizedProducts = extractProducts(data);

      if (normalizedCollection || normalizedProducts.length > 0) {
        setCollection(normalizedCollection);
        setProducts(normalizedProducts);
        await getCacheService().set(cacheKey, { collection: normalizedCollection, products: normalizedProducts }, 5);
        return;
      }

      throw new Error('Collection unavailable');
    } catch (err) {
      if (!isMounted.current) return;
      if (products.length === 0) {
        setCollection(fallbackCollections.find((c) => c.handle === handle) || null);
        setProducts(handle === 'accessories' ? fallbackProducts : []);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [handle, products.length]);

  useEffect(() => {
    fetchCollection();
  }, [fetchCollection]);

  return { collection, products, loading, refetch: () => fetchCollection(true) };
}
