import crypto from 'crypto';
import prisma from '@/lib/db';

const SAFE_ALPHANUMERIC = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Generates a random alphanumeric string from safe character set
 */
function randomString(length: number): string {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += SAFE_ALPHANUMERIC[bytes[i] % SAFE_ALPHANUMERIC.length];
  }
  return result;
}

const AFFILIATE_CODE_MAX = 99999;

/**
 * Next sequential affiliate code: "ZB" + 5 digits (ZB10001, ZB10002, ...).
 * Numbers come from the zb_affiliate_code_seq Postgres sequence, so concurrent registrations
 * never get the same number; a taken code (e.g. created by hand) is skipped.
 */
export async function generateUniqueAffiliateCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT nextval('zb_affiliate_code_seq') AS seq_val`
    )) as Array<{ seq_val: bigint | number }>;
    const seqVal = Number(rows[0].seq_val);
    if (seqVal > AFFILIATE_CODE_MAX) {
      throw new Error('Affiliate code range ZB10001–ZB99999 is exhausted');
    }
    const candidate = `ZB${seqVal}`;

    const existing = await prisma.affiliate.findUnique({
      where: { code: candidate },
      select: { id: true },
    });
    if (!existing) {
      return candidate;
    }
  }

  throw new Error('Could not allocate a unique affiliate code');
}

/**
 * Generates a unique slug for an affiliate link
 */
export async function generateUniqueLinkSlug(baseCode: string, targetType?: string): Promise<string> {
  const cleanBase = baseCode.toLowerCase().replace(/[^a-z0-9]/g, '');
  const prefix = targetType && targetType !== 'STORE' ? `${targetType.toLowerCase().slice(0, 3)}-` : '';

  for (let attempt = 0; attempt < 10; attempt++) {
    const randomPart = attempt === 0 && (!targetType || targetType === 'STORE')
      ? ''
      : `-${randomString(4).toLowerCase()}`;
    const candidate = `${prefix}${cleanBase}${randomPart}`;

    const existing = await prisma.affiliateLink.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });

    if (!existing) {
      return candidate;
    }
  }

  return `${cleanBase}-${Date.now().toString(36).toLowerCase()}`;
}
