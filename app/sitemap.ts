import { MetadataRoute } from 'next';
import { fetchProducts, fetchCollections } from '@/lib/shopify-admin';

export const revalidate = 3600; // ISR: regenerate every 1 hour

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://zicabella.com';
  const now = new Date();

  const parseDate = (val: any): Date => {
    if (!val) return now;
    const d = new Date(val);
    return isNaN(d.getTime()) ? now : d;
  };

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/collections`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/collections/graphic-tees`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.95,
    },
    {
      url: `${baseUrl}/collections/tshirts-under-5000`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.95,
    },
    {
      url: `${baseUrl}/collections/oversized-tees`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/collections/new-arrivals`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.95,
    },
    {
      url: `${baseUrl}/collections/best-sellers`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.95,
    },
    {
      url: `${baseUrl}/collections/sale`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/chat`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/search`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/story`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/support`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${baseUrl}/blogs`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/faq`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ];

  try {
    let policies: any[] = [];
    try {
      const { default: prisma } = await import('@/lib/db');
      const dbPolicies = await prisma.policy.findMany({ select: { handle: true, updatedAt: true } });
      if (Array.isArray(dbPolicies)) {
        policies = dbPolicies;
      }
    } catch (err) {
      console.warn('[sitemap] Failed to load DB or fetch policies:', err);
    }

    const [rawProducts, rawCollections] = await Promise.all([
      fetchProducts(250).catch((err) => {
        console.warn('[sitemap] fetchProducts warning:', err);
        return [];
      }),
      fetchCollections(250).catch((err) => {
        console.warn('[sitemap] fetchCollections warning:', err);
        return [];
      }),
    ]);

    const products = Array.isArray(rawProducts) ? rawProducts.filter((p: any) => p && typeof p.handle === 'string' && p.handle.trim().length > 0) : [];
    const collections = Array.isArray(rawCollections) ? rawCollections.filter((c: any) => c && typeof c.handle === 'string' && c.handle.trim().length > 0) : [];

    const productPages: MetadataRoute.Sitemap = products.map((p: any) => ({
      url: `${baseUrl}/products/${p.handle}`,
      lastModified: parseDate(p.updated_at),
      changeFrequency: 'weekly' as const,
      priority: 0.85,
    }));

    const collectionPages: MetadataRoute.Sitemap = collections.map((c: any) => ({
      url: `${baseUrl}/collections/${c.handle}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.9,
    }));

    const policyPages: MetadataRoute.Sitemap = policies
      .filter((policy: any) => policy && typeof policy.handle === 'string' && policy.handle.trim().length > 0)
      .map((policy: any) => ({
        url: `${baseUrl}/policies/${policy.handle}`,
        lastModified: parseDate(policy.updatedAt),
        changeFrequency: 'monthly' as const,
        priority: 0.4,
      }));

    return [...staticPages, ...productPages, ...collectionPages, ...policyPages];
  } catch (err) {
    console.error('[sitemap] Unexpected error during sitemap generation; falling back to static pages:', err);
    return staticPages;
  }
}
