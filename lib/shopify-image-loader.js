export default function shopifyImageLoader({ src, width, quality }) {
  if (!src) return '';
  
  if (src.startsWith('data:')) {
    return src;
  }

  if (src.startsWith('/')) {
    return src.includes('?') ? `${src}&w=${width}` : `${src}?w=${width}`;
  }

  try {
    const url = new URL(src);
    const host = url.hostname;

    if (host.includes('cdn.shopify.com') || host.includes('myshopify.com')) {
      url.searchParams.set('width', width.toString());
      url.searchParams.set('quality', (quality || 80).toString());
      return url.toString();
    }

    if (host.includes('images.unsplash.com')) {
      url.searchParams.set('w', width.toString());
      url.searchParams.set('q', (quality || 80).toString());
      url.searchParams.set('auto', 'format');
      url.searchParams.set('fit', 'crop');
      return url.toString();
    }

    if (host.includes('supabase.co')) {
      return src;
    }
  } catch (e) {
    // Return original src if parsing fails
  }

  return src;
}

