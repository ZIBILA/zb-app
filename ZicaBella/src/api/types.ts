// TypeScript types for Shopify Storefront API data

export interface Money {
  amount: string;
  currencyCode: string;
}

export interface ShopifyImage {
  url: string;
  altText: string | null;
}

export interface Media {
  alt: string | null;
  mediaContentType: 'IMAGE' | 'VIDEO' | 'EXTERNAL_VIDEO' | 'MODEL_3D';
  image?: ShopifyImage;
  sources?: { url: string; mimeType: string }[];
}

export interface SelectedOption {
  name: string;
  value: string;
}

export interface ProductVariant {
  id: string;
  title: string;
  availableForSale: boolean;
  quantityAvailable: number | null;
  price: Money;
  compareAtPrice: Money | null;
  selectedOptions: SelectedOption[];
}

export interface Product {
  id: string;
  title: string;
  handle: string;
  productType: string;
  description: string;
  descriptionHtml?: string;
  availableForSale: boolean;
  featuredImage: ShopifyImage | null;
  images: {
    edges: { node: ShopifyImage }[];
  };
  priceRange: {
    minVariantPrice: Money;
  };
  compareAtPriceRange?: {
    maxVariantPrice: Money;
  };
  variants: {
    edges: { node: ProductVariant }[];
  };
  media: {
    edges: { node: Media }[];
  };
  details?: { value: string };
  care?: { value: string };
  sizeChart?: { value: string };
  productVideo?: {
    reference?: {
      sources: { url: string; mimeType: string }[];
    };
  };
}

export interface Collection {
  id: string;
  title: string;
  handle: string;
  description: string;
  image: ShopifyImage | null;
  products?: {
    edges: { node: Product }[];
  };
}

export interface CartLine {
  id: string;
  quantity: number;
  merchandise: {
    id: string;
    title: string;
    price: Money;
    product?: {
      title: string;
      handle: string;
      featuredImage: ShopifyImage | null;
    };
  };
}

export interface Cart {
  id: string;
  checkoutUrl: string;
  lines: {
    edges: { node: CartLine }[];
  };
  cost: {
    totalAmount: Money;
    subtotalAmount: Money;
  };
}

// Flattened helper types for components
export interface FlatProduct {
  id: string;
  title: string;
  handle: string;
  productType: string;
  description: string;
  descriptionHtml?: string;
  availableForSale: boolean;
  featuredImage: string;
  images: string[];
  price: string;
  compareAtPrice: string | null;
  variants: FlatVariant[];
  isSoldOut: boolean;
  isOnSale: boolean;
  video?: string;
  allMedia: Media[];
  details?: string;
  care?: string;
  sizeChart?: string;
  productVideo?: string;
}

export interface FlatVariant {
  id: string;
  title: string;
  availableForSale: boolean;
  quantityAvailable: number | null;
  price: string;
  compareAtPrice: string | null;
  size: string | null;
  color: string | null;
}

export interface FlatCollection {
  id: string;
  title: string;
  handle: string;
  description: string;
  image: string | null;
}

// Helper to parse Shopify Rich Text JSON
export function parseRichText(jsonStr: string | undefined): string {
  if (!jsonStr) return '';
  try {
    const data = JSON.parse(jsonStr);
    let text = '';
    
    const extract = (node: any) => {
      if (node.type === 'text') {
        text += node.value;
      }
      if (node.children) {
        node.children.forEach(extract);
      }
      if (node.type === 'list-item') {
        text += '\n• ';
      }
      if (node.type === 'paragraph' || node.type === 'list') {
        text += '\n';
      }
    };
    
    extract(data);
    return text.trim();
  } catch (e) {
    return jsonStr; // Return as is if not JSON
  }
}

// Transform functions
export function flattenProduct(product: Product): FlatProduct {
  const variants = product.variants.edges.map(e => e.node);
  const firstVariant = variants[0];
  const price = firstVariant?.price.amount || '0';
  const compareAtPrice = firstVariant?.compareAtPrice?.amount || null;
  const isOnSale = compareAtPrice ? parseFloat(compareAtPrice) > parseFloat(price) : false;
  const isSoldOut = !variants.some(v => v.availableForSale);

  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    productType: product.productType,
    description: product.description,
    descriptionHtml: product.descriptionHtml,
    availableForSale: product.availableForSale,
    featuredImage: product.featuredImage?.url || '',
    images: product.images.edges.map(e => e.node.url),
    price,
    compareAtPrice,
    variants: variants.map(v => ({
      id: v.id,
      title: v.title,
      availableForSale: v.availableForSale,
      quantityAvailable: v.quantityAvailable,
      price: v.price.amount,
      compareAtPrice: v.compareAtPrice?.amount || null,
      size: v.selectedOptions.find(o => o.name.toLowerCase() === 'size')?.value || null,
      color: v.selectedOptions.find(o => o.name.toLowerCase() === 'color' || o.name.toLowerCase() === 'colour')?.value || null,
    })),
    isSoldOut,
    isOnSale,
    video: product.media?.edges.find(e => e.node.mediaContentType === 'VIDEO')?.node.sources?.[0]?.url,
    allMedia: product.media?.edges.length > 0 
      ? product.media.edges.map(e => e.node)
      : product.images.edges.map(e => ({
          mediaContentType: 'IMAGE',
          image: e.node,
          alt: e.node.altText
        } as Media)),
    details: parseRichText(product.details?.value),
    care: parseRichText(product.care?.value),
    sizeChart: product.sizeChart?.value,
    productVideo: product.productVideo?.reference?.sources?.[0]?.url,
  };
}

export function flattenCollection(collection: Collection): FlatCollection {
  return {
    id: collection.id,
    title: collection.title,
    handle: collection.handle,
    description: collection.description,
    image: collection.image?.url || null,
  };
}
