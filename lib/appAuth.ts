import jwt from 'jsonwebtoken';
import prisma from './db';
import { searchCustomerByEmail, searchCustomerByPhone } from './shopify-admin';

export type AppAuthTokenPayload = {
  customerId: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  tokenVersion?: number;
  type?: 'access' | 'refresh';
};

function getAppJwtSecret() {
  const secret = process.env.APP_JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('Missing APP_JWT_SECRET (or NEXTAUTH_SECRET fallback).');
  }
  return secret;
}

/**
 * Signs an access token for mobile app sessions (30 days).
 */
export function signAccessToken(payload: Omit<AppAuthTokenPayload, 'type'>) {
  return jwt.sign(
    { ...payload, type: 'access' },
    getAppJwtSecret(),
    { expiresIn: '30d' }
  );
}

/**
 * Signs a long-lived refresh token (30 days).
 */
export function signRefreshToken(payload: Omit<AppAuthTokenPayload, 'type'>) {
  return jwt.sign(
    { ...payload, type: 'refresh' },
    getAppJwtSecret(),
    { expiresIn: '30d' }
  );
}

/**
 * Backward-compatible alias — issues an access token (30d).
 * New callers should use signAccessToken + signRefreshToken instead.
 * @deprecated Use signAccessToken + signRefreshToken
 */
export function signAppToken(payload: Omit<AppAuthTokenPayload, 'type'>) {
  return signAccessToken(payload);
}

/**
 * Verifies and decodes a JWT token, extracting all payload fields.
 * Legacy tokens (without tokenVersion/type) default to version 0 and type 'access'.
 */
export function verifyAppToken(token: string): AppAuthTokenPayload {
  const decoded = jwt.verify(token, getAppJwtSecret());
  if (typeof decoded !== 'object' || !decoded) throw new Error('Invalid token');
  const customerId = (decoded as any).customerId;
  if (!customerId || typeof customerId !== 'string') throw new Error('Invalid token');
  return {
    customerId,
    customerEmail: typeof (decoded as any).customerEmail === 'string' ? (decoded as any).customerEmail : null,
    customerPhone: typeof (decoded as any).customerPhone === 'string' ? (decoded as any).customerPhone : null,
    tokenVersion: typeof (decoded as any).tokenVersion === 'number' ? (decoded as any).tokenVersion : 0,
    type: (decoded as any).type === 'refresh' ? 'refresh' : 'access',
  };
}

export function getAppAuthFromRequest(req: Request) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    return verifyAppToken(token);
  } catch {
    return null;
  }
}

/**
 * Strict auth middleware for critical mobile app routes.
 * Validates the JWT AND checks the tokenVersion against the DB.
 * Throws structured errors for 401 responses.
 */
export async function requireAppAuth(req: Request) {
  const auth = getAppAuthFromRequest(req);
  if (!auth) {
    throw Object.assign(new Error('Session expired. Please log in again.'), { statusCode: 401 });
  }

  // Reject refresh tokens used as access tokens
  if (auth.type === 'refresh') {
    throw Object.assign(new Error('Invalid token type'), { statusCode: 401 });
  }

  // DB-backed token version check for revocation
  const customer = await prisma.customer.findUnique({
    where: { id: auth.customerId },
    select: { id: true, tokenVersion: true, name: true, email: true, phone: true },
  });

  if (!customer) {
    throw Object.assign(new Error('Customer not found'), { statusCode: 401 });
  }

  if (auth.tokenVersion !== undefined && auth.tokenVersion < customer.tokenVersion) {
    throw Object.assign(new Error('Token revoked. Please log in again.'), { statusCode: 401 });
  }

  return { auth, customer };
}

/**
 * Standard error handler for requireAppAuth throws.
 */
export function handleAppAuthError(error: any) {
  const { NextResponse } = require('next/server');
  const statusCode = error?.statusCode || 401;
  const rawMessage = error instanceof Error ? error.message : '';
  const message = rawMessage && rawMessage !== 'Unauthorized'
    ? rawMessage
    : 'Session expired. Please log in again.';
  return NextResponse.json({ error: message }, { status: statusCode });
}

/**
 * Resiliently resolves a customer record in the database using the token payload.
 * If the customer CUID in the token is invalid (e.g. from a different database instance),
 * it attempts to self-heal the session by looking up the customer via email or phone,
 * syncing them from Shopify, or creating a guest customer locally as a fallback.
 */
export async function resolveAuthCustomer(auth: AppAuthTokenPayload | null) {
  if (!auth) return null;

  // 1. Try by exact customerId (cuid)
  let customer = await prisma.customer.findUnique({
    where: { id: auth.customerId }
  });
  if (customer) return customer;

  console.log(`[Auth] Customer ID ${auth.customerId} not found in database. Attempting self-healing...`);

  // 2. Try by email if available
  if (auth.customerEmail) {
    customer = await prisma.customer.findFirst({
      where: { email: auth.customerEmail }
    });
    if (customer) {
      console.log(`[Auth] Self-healed customer ID by email match: ${auth.customerEmail} -> ${customer.id}`);
      return customer;
    }
  }

  // 3. Try by phone if available
  if (auth.customerPhone) {
    const phoneDigits = String(auth.customerPhone).replace(/\D/g, '').slice(-10);
    if (phoneDigits.length === 10) {
      customer = await prisma.customer.findFirst({
        where: { phone: { contains: phoneDigits } }
      });
      if (customer) {
        console.log(`[Auth] Self-healed customer ID by phone match: ${auth.customerPhone} -> ${customer.id}`);
        return customer;
      }
    }
  }

  // 4. Try syncing from Shopify if we have email or phone
  let shopifyCustomer = null;
  try {
    if (auth.customerEmail) {
      shopifyCustomer = await searchCustomerByEmail(auth.customerEmail);
    }
    if (!shopifyCustomer && auth.customerPhone) {
      const phoneDigits = String(auth.customerPhone).replace(/\D/g, '').slice(-10);
      const normalizedPhone = auth.customerPhone.startsWith('+') ? auth.customerPhone : `+${auth.customerPhone}`;
      shopifyCustomer = await searchCustomerByPhone(auth.customerPhone) 
        || await searchCustomerByPhone(phoneDigits)
        || await searchCustomerByPhone(normalizedPhone);
    }
  } catch (e) {
    console.error("[Auth] Shopify search failed during customer resolution:", e);
  }

  const shop = await prisma.shop.findFirst();
  if (!shop) {
    console.error("[Auth] No shop configuration found during customer self-healing.");
    return null;
  }

  if (shopifyCustomer) {
    // Create/sync Shopify customer locally
    customer = await prisma.customer.create({
      data: {
        shopifyId: String(shopifyCustomer.id),
        shopId: shop.id,
        email: shopifyCustomer.email || auth.customerEmail || null,
        name: `${shopifyCustomer.first_name || ""} ${shopifyCustomer.last_name || ""}`.trim() || "User",
        phone: shopifyCustomer.phone || auth.customerPhone || null,
        ordersCount: shopifyCustomer.orders_count || 0,
        totalSpent: parseFloat(shopifyCustomer.total_spent || "0"),
      }
    });
    console.log(`[Auth] Created synced customer record from Shopify: ${customer.id}`);
    return customer;
  }

  // 5. Fallback: Create local guest customer if email or phone is present
  if (auth.customerEmail || auth.customerPhone) {
    customer = await prisma.customer.create({
      data: {
        shopId: shop.id,
        shopifyId: `mobile_migrated_${Date.now()}`,
        name: "Guest User",
        email: auth.customerEmail || null,
        phone: auth.customerPhone || null,
      }
    });
    console.log(`[Auth] Created fallback local guest customer record: ${customer.id}`);
    return customer;
  }

  return null;
}
