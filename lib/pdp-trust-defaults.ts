export type PdpTrustBoxVariant = 'default' | 'highlight';

export type PdpTrustBox = {
  id: string;
  icon: string;
  title: string;
  subtitle: string;
  /** highlight = black/white prepaid-style tile; default = grey */
  variant: PdpTrustBoxVariant;
};

export const DEFAULT_PDP_TRUST_BOXES: PdpTrustBox[] = [
  {
    id: 'cod',
    icon: 'cash-outline',
    title: 'COD available',
    subtitle: '₹99 now, rest on delivery',
    variant: 'default',
  },
  {
    id: 'prepaid',
    icon: 'pricetag-outline',
    title: '10% off on prepaid',
    subtitle: '+ 10% cashback as store credit',
    variant: 'highlight',
  },
  {
    id: 'delivery',
    icon: 'bicycle-outline',
    title: 'Delivery in 3–7 days',
    subtitle: 'Dispatched in 24–48 hrs',
    variant: 'default',
  },
  {
    id: 'returns',
    icon: 'refresh-outline',
    title: '15-day easy return/exchange',
    subtitle: 'No questions asked',
    variant: 'default',
  },
];

export const DEFAULT_PDP_INCL_TAXES_TEXT = 'Incl. taxes';
export const DEFAULT_PDP_MODEL_INFO =
  "Model is 6'0\", wearing size 32 · Oversized fit, true to waist";

export function parsePdpTrustBoxes(raw: unknown): PdpTrustBox[] {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return DEFAULT_PDP_TRUST_BOXES;
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return DEFAULT_PDP_TRUST_BOXES;
  }

  const boxes = parsed
    .map((item: any, index: number): PdpTrustBox | null => {
      if (!item || typeof item !== 'object') return null;
      const title = String(item.title || '').trim();
      if (!title) return null;
      const variant: PdpTrustBoxVariant =
        item.variant === 'highlight' || item.highlight === true ? 'highlight' : 'default';
      return {
        id: String(item.id || `box_${index}`),
        icon: String(item.icon || 'information-circle-outline').trim() || 'information-circle-outline',
        title,
        subtitle: String(item.subtitle || '').trim(),
        variant,
      };
    })
    .filter((b): b is PdpTrustBox => Boolean(b));

  return boxes.length > 0 ? boxes : DEFAULT_PDP_TRUST_BOXES;
}
