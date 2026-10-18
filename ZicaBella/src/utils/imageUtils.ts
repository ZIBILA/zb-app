import { config } from '../constants/config';

/**
 * Robust image URL resolver to handle various data structures
 * coming from Shopify, Prisma, or manual inputs.
 */
export function resolveImageUrl(source: any): string | null {
  if (!source) return null;

  // 1. If it's already a string, return it (clean up if needed)
  if (typeof source === 'string') {
    if (source.startsWith('//')) return `https:${source}`;
    if (source.startsWith('/') && !source.startsWith('//')) {
      return `${config.appUrl}${source}`;
    }
    return source;
  }

  // 2. Shopify Image Object: { url: string } or { src: string }
  if (typeof source === 'object') {
    const url = source.url || source.src || source.imageUrl || source.image;
    if (url && typeof url === 'string') {
      if (url.startsWith('//')) return `https:${url}`;
      return url;
    }
    
    // 3. Recursive check if 'image' field is itself an object
    if (source.image && typeof source.image === 'object') {
      return resolveImageUrl(source.image);
    }

    // 4. Handle Shopify node structure: { node: { url: string } }
    if (source.node) {
      return resolveImageUrl(source.node);
    }

    // 5. Handle Shopify list structure (edges/nodes)
    if (source.edges && Array.isArray(source.edges) && source.edges.length > 0) {
      return resolveImageUrl(source.edges[0]);
    }
    if (source.nodes && Array.isArray(source.nodes) && source.nodes.length > 0) {
      return resolveImageUrl(source.nodes[0]);
    }
  }

  return null;
}

/**
 * Resolves an array of images or a single image into a validated string array.
 */
export function resolveImageArray(source: any): string[] {
  if (!source) return [];
  
  if (Array.isArray(source)) {
    return source.map(resolveImageUrl).filter(Boolean) as string[];
  }
  
  const single = resolveImageUrl(source);
  return single ? [single] : [];
}
