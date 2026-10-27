'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';

export default function ShopifyImagePicker({ onSelect, onClose }: { onSelect: (url: string, product?: any) => void, onClose: () => void }) {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'shopify' | 'manual'>('shopify');
  const [manualUrl, setManualUrl] = useState('');
  const [expandedProduct, setExpandedProduct] = useState<any>(null);

  useEffect(() => {
    if (tab === 'shopify') {
      fetchProducts();
    }
  }, [tab]);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      // Using existing /api/shopify/products route if possible, or fallback to mock
      const res = await fetch('/api/shopify/products?limit=50');
      const data = await res.json();
      if (data.products) {
        setProducts(data.products);
      } else {
        throw new Error();
      }
    } catch (error) {
      toast.error('Failed to load products from Shopify');
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter(p => p.title?.toLowerCase().includes(search.toLowerCase()));

  const handleManualApply = () => {
    if (!manualUrl.startsWith('http')) {
      return toast.error('Please enter a valid URL');
    }
    onSelect(manualUrl);
  };

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/80 z-[70] flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white dark:bg-[#111] border border-black/10 dark:border-white/10 rounded-2xl w-full max-w-4xl h-[85vh] flex flex-col shadow-2xl">
        <div className="p-4 border-b border-black/10 dark:border-white/10 flex justify-between items-center bg-gray-50 dark:bg-[#161616] rounded-t-2xl">
          <h2 className="text-base font-medium text-black dark:text-white">Select Image</h2>
          <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white p-2">✕</button>
        </div>

        <div className="flex border-b border-black/10 dark:border-white/10 px-4 bg-gray-50/50 dark:bg-transparent">
          <button onClick={() => setTab('shopify')} className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${tab === 'shopify' ? 'border-black dark:border-white text-black dark:text-white font-semibold' : 'border-transparent text-gray-500 hover:text-black dark:hover:text-white'}`}>Shopify Products</button>
          <button onClick={() => setTab('manual')} className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${tab === 'manual' ? 'border-black dark:border-white text-black dark:text-white font-semibold' : 'border-transparent text-gray-500 hover:text-black dark:hover:text-white'}`}>Paste URL</button>
        </div>

        <div className="flex-1 overflow-auto p-4 bg-transparent">
          {tab === 'manual' ? (
            <div className="max-w-xl mx-auto mt-8">
              <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Enter any image URL</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={manualUrl}
                  onChange={e => setManualUrl(e.target.value)}
                  placeholder="https://..."
                  className="flex-1 bg-black/[0.02] dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg p-3 text-black dark:text-white text-sm focus:border-black/30 dark:focus:border-white/30 outline-none"
                />
                <button onClick={handleManualApply} className="bg-black dark:bg-white text-white dark:text-black px-6 py-3 rounded-lg font-bold text-sm hover:bg-black/80 dark:hover:bg-gray-200 transition shadow-md">
                  Apply
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 h-full flex flex-col bg-transparent">
              <input
                type="text"
                placeholder="Search products..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-black/[0.02] dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg p-3 text-black dark:text-white text-sm focus:border-black/30 dark:focus:border-white/30 outline-none shadow-sm"
              />
              
              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="grid grid-cols-3 gap-4">
                    {[...Array(6)].map((_, i) => <div key={i} className="h-40 bg-black/5 dark:bg-white/5 animate-pulse rounded-xl" />)}
                  </div>
                ) : expandedProduct ? (
                  <div>
                    <button onClick={() => setExpandedProduct(null)} className="mb-4 text-sm text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white flex items-center gap-1">
                      ← Back to products
                    </button>
                    <h3 className="text-black dark:text-white font-medium mb-4">{expandedProduct.title}</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {expandedProduct.images?.map((img: any, i: number) => (
                        <div key={i} className="group relative aspect-square bg-black/[0.02] dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl overflow-hidden shadow-sm">
                          <img src={img.src} alt="" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                            <button onClick={() => onSelect(img.src, expandedProduct)} className="bg-black dark:bg-white text-white dark:text-black px-4 py-2 rounded font-bold text-xs shadow-md hover:scale-105 transition-transform duration-300">
                              Select
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {filteredProducts.map(p => (
                      <div key={p.id} onClick={() => setExpandedProduct(p)} className="bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl overflow-hidden cursor-pointer hover:border-black/30 dark:hover:border-white/30 shadow-sm hover:shadow-md transition group">
                        <div className="aspect-square bg-gray-50 dark:bg-[#1a1a1a]">
                          {p.images?.[0]?.src ? (
                            <img src={p.images[0].src} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-500 dark:text-gray-600 text-xs">No image</div>
                          )}
                        </div>
                        <div className="p-3">
                          <p className="text-black dark:text-white text-xs font-medium truncate">{p.title}</p>
                        </div>
                      </div>
                    ))}
                    {filteredProducts.length === 0 && !loading && (
                      <div className="col-span-full py-10 text-center text-foreground/50 text-sm">No products found</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
